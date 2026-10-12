import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSitTemplates, validateSitInput, generateSitDelivery, verifySitDelivery, caseBaseline } from '../lib/sit-delivery.js';
import { unzipWorkbook, zipWorkbook, setSheetCells, sha256, xmlEscape } from '../lib/sit-workbook.js';
import { createServer } from '../mcp/server.js';
import { createInstallPlan, applyInstallPlan } from '../lib/cli/install-state.js';
import { PKG } from '../lib/cli/context.js';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = (v) => structuredClone(v);
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-sit-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ref = (name, contents) => { const bytes = Buffer.from(contents); fs.writeFileSync(path.join(root, name), bytes); return { path: name, sha256: sha256(bytes) }; };
  const receipt = ref('receipt.txt', 'Fixture receipt; not a real customer handoff');
  const report = ref('run1.log', 'Fixture execution log');
  const report2 = ref('run2.log', 'Independent fixture execution log');
  const input = { schemaVersion: 1, project: { name: '测试样板', version: 'v1', environment: 'isolated-fixture', systems: ['PC'], owners: ['fixture'] },
    schedule: { sitStart: '2026-01-10', uatStart: '2026-01-30' }, requirements: [{ id: 'REQ1', description: '查询', source: 'fixture' }],
    cases: [
      { id: 'C1', name: '查询模块A', kind: 'functional', priority: 'P1', module: '模块A', preconditions: '已登录', steps: '查询', expected: '返回授权数据', requirementIds: ['REQ1'], storyId: 'S1', storyStep: '1', systems: ['PC'] },
      { id: 'C2', name: '在模块B回查', kind: 'cross-module', priority: 'P0', module: '模块B', preconditions: 'C1完成', steps: '回查', expected: '数据一致', requirementIds: ['REQ1'], storyId: 'S1', storyStep: '2', systems: ['PC'], dependsOn: ['C1'] },
    ], defects: [], deliveries: Object.fromEntries(['plan', 'cases', 'execution', 'defects', 'report'].map((id) => [id, { deliveredAt: ['plan', 'cases'].includes(id) ? '2026-01-02' : '2026-01-22', receipt }])),
    review: { decision: 'passed', reviewer: 'fixture', at: '2026-01-03', evidence: [receipt] },
  };
  input.rounds = [11, 20].map((day, i) => ({ id: `R${i + 1}`, caseBaselineSha256: caseBaseline(input), startedAt: `2026-01-${day}T10:00:00Z`, finishedAt: `2026-01-${day}T12:00:00Z`,
    executions: input.cases.map((c, index) => ({ caseId: c.id, result: 'passed', executedAt: `2026-01-${day}T10:${index ? '30' : '20'}:00Z`, executedBy: 'fixture', actual: '符合预期', evidence: [i ? report2 : report], writePerformed: false })) }));
  return { root, input, receipt, report, report2 };
}
test('SIT happy path: exact two rounds, same-PC cross modules, deadline and local hashes', (t) => {
  const { root, input } = fixture(t);
  const result = verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root });
  assert.equal(result.passed, true, JSON.stringify(result.gaps));
  assert.equal(result.businessBehaviorObserved, false);
  assert.equal(result.customerReceiptObserved, false);
  assert.equal(result.executionStatus, 'not-executed-by-this-command');
});
for (const [name, mutate, expected] of [
  ['late plan', (i) => { i.deliveries.plan.deliveredAt = '2026-01-04'; }, 'handoff-plan'],
  ['one full round', (i) => { i.rounds.pop(); }, 'two-full-rounds'],
  ['skipped case', (i) => { i.rounds[1].executions[0].result = 'skipped'; }, 'latest-round-passed'],
  ['duplicate round content under new id', (i) => { i.rounds[1] = { ...copy(i.rounds[0]), id: 'R2' }; }, 'rounds-independent-in-time'],
  ['wrong baseline', (i) => { i.rounds[1].caseBaselineSha256 = '0'.repeat(64); }, 'two-full-rounds'],
  ['future actual handoff', (i) => { i.deliveries.report.deliveredAt = '2099-01-01'; }, 'actual-events-not-in-future'],
  ['reversed workflow order', (i) => { i.rounds[1].executions[0].executedAt = '2026-01-20T11:00:00Z'; }, 'two-full-rounds'],
  ['write without cleanup', (i) => { i.rounds[1].executions[0].writePerformed = true; }, 'latest-round-passed'],
  ['unknown fact', (i) => { delete i.project.environment; }, 'project-facts'],
  ['conditional review', (i) => { i.review.decision = 'conditional'; }, 'case-review'],
  ['zero cases', (i) => { i.cases = []; i.rounds = []; }, 'case-inventory-present'],
  ['fake hash', (i) => { i.rounds[1].executions[0].evidence[0].sha256 = '0'.repeat(64); }, 'two-full-rounds'],
  ['outside evidence', (i) => { i.deliveries.plan.receipt.path = '../outside.txt'; }, 'handoff-plan'],
  ['missing customer receipt', (i) => { delete i.deliveries.report; }, 'handoff-report'],
]) test(`SIT rejects ${name}`, (t) => {
  const { root, input } = fixture(t); mutate(input);
  const result = verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root });
  assert.equal(result.passed, false); assert.ok(result.gaps.some((g) => g.id === expected), JSON.stringify(result.gaps));
});
test('Critical defect needs same-case failure, exact retest and closure after retest', (t) => {
  const { root, input, report, report2 } = fixture(t);
  input.rounds[0].executions[1].result = 'failed'; input.rounds[0].executions[1].defectIds = ['D1'];
  const defect = { id: 'D1', domain: '炼钢', severity: 'critical', state: '未修复', module: '模块B', description: '回查错误', caseId: 'C2', roundId: 'R1', discoverer: 'fixture', discoveredAt: '2026-01-11T10:35:00Z', resolver: 'fixture', cause: '数据映射错误', plannedResolveAt: '2026-01-18' };
  input.defects = [defect];
  assert.equal(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).passed, false);
  Object.assign(defect, { state: '已验证', verifier: 'fixture', closedAt: '2026-01-20T11:00:00Z', retests: [{ roundId: 'R2', caseId: 'C2', result: 'passed', executedAt: input.rounds[1].executions[1].executedAt, evidence: [report2] }] });
  assert.equal(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).passed, true);
  defect.closedAt = '2026-01-20T10:00:00Z';
  assert.ok(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).gaps.some((g) => g.id === 'defect-closure:D1'));
  defect.closedAt = '2026-01-20T11:00:00Z';
  input.rounds[0].executions[0].result = 'failed'; input.rounds[0].executions[0].defectIds = ['D1'];
  assert.equal(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).passed, false, 'Another case cannot borrow this defect');
  assert.ok(report.path);
});
test('Case baselines ignore JSON property order but preserve case order and content', (t) => {
  const { input } = fixture(t), reordered = copy(input);
  reordered.cases = reordered.cases.map((c) => Object.fromEntries(Object.entries(c).reverse()));
  assert.equal(caseBaseline(reordered), caseBaseline(input));
  reordered.cases.reverse(); assert.notEqual(caseBaseline(reordered), caseBaseline(input));
});
test('Later rounds reuse the same case defect, but cannot borrow a future origin', (t) => {
  const { root, input } = fixture(t);
  input.rounds[0].executions[1].result = 'failed'; input.rounds[0].executions[1].defectIds = ['D1'];
  const middle = copy(input.rounds[0]); middle.id = 'R-middle'; middle.startedAt = '2026-01-15T10:00:00Z'; middle.finishedAt = '2026-01-15T12:00:00Z';
  middle.executions.forEach((e) => { e.executedAt = e.executedAt.replace('2026-01-11', '2026-01-15'); });
  input.rounds.splice(1, 0, middle);
  input.defects = [{ id: 'D1', domain: '炼钢', severity: 'critical', state: '已验证', module: '模块B', description: '回查错误', caseId: 'C2', roundId: 'R1', discoverer: 'fixture', discoveredAt: '2026-01-11T10:35:00Z', resolver: 'fixture', cause: '映射', plannedResolveAt: '2026-01-18', verifier: 'fixture', closedAt: '2026-01-20T11:00:00Z', retests: [{ roundId: 'R2', caseId: 'C2', result: 'passed', executedAt: input.rounds[2].executions[1].executedAt, evidence: input.rounds[2].executions[1].evidence }] }];
  assert.equal(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).passed, true);
  input.defects[0].roundId = 'R-middle'; input.defects[0].discoveredAt = '2026-01-15T10:35:00Z';
  assert.ok(verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot: root }).rounds.find((r) => r.id === 'R1').reasons.includes('failed-case-without-own-defect'));
});
test('Custom issue domains retain summary references, quotes and Excel date values', (t) => {
  const { root, input } = fixture(t);
  input.defects = [{ id: 'D1', domain: "研发&客'户", severity: 'general', state: '未修复', module: '模块B', description: '映射', caseId: 'C2', roundId: 'R1', discoverer: 'fixture', discoveredAt: '2026-01-11' }];
  const output = path.join(root, 'custom-domain'); generateSitDelivery(input, { outputDir: output, evidenceRoot: root });
  const parts = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试问题记录.xlsx')));
  assert.match(parts.get('xl/workbook.xml').toString(), /name="研发&amp;客&apos;户"/);
  assert.match(parts.get('xl/worksheets/sheet2.xml').toString(), /'研发&amp;客&apos;&apos;户'!/);
  assert.match(parts.get('xl/worksheets/sheet3.xml').toString(), /r="O2"[^>]*><v>\d+(?:\.\d+)?<\/v>/);
  input.defects = [...input.defects, { ...input.defects[0], id: 'D2', domain: 'SALES' }, { ...input.defects[0], id: 'D3', domain: 'sales' }];
  assert.throws(() => validateSitInput(input), /distinct valid Excel/);
});
test('Minor issue level keeps the original summary 提示 category', (t) => {
  const { root, input } = fixture(t);
  input.defects = [{ id: 'D1', domain: '炼钢', severity: 'minor', state: '未修复', module: '模块B', description: '展示', caseId: 'C2', roundId: 'R1', discoverer: 'fixture', discoveredAt: '2026-01-11' }];
  const output = path.join(root, 'minor'); generateSitDelivery(input, { outputDir: output, evidenceRoot: root });
  const parts = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试问题记录.xlsx')));
  assert.match(parts.get('xl/worksheets/sheet6.xml').toString(), /r="D2"[^>]*>.*?<t[^>]*>提示<\/t>/);
  assert.match(parts.get('xl/worksheets/sheet2.xml').toString(), /COUNTIF\([^<]*提示/);
});
test('SIT structural input/date/id/DAG errors never write output', (t) => {
  const { root, input } = fixture(t);
  const mutations = [(i) => { i.schemaVersion = false; }, (i) => { i.schedule.sitStart = '2026-02-30'; }, (i) => { i.cases[1].id = 'C1'; }, (i) => { i.cases[0].kind = 'cross-module'; i.cases[0].dependsOn = ['C2']; }, (i) => { i.cases[0].requirementIds = ['UNKNOWN']; }];
  mutations.forEach((mutate, n) => { const data = copy(input); mutate(data); const output = path.join(root, `invalid-${n}`); assert.throws(() => generateSitDelivery(data, { outputDir: output, evidenceRoot: root })); assert.equal(fs.existsSync(output), false); });
});
test('Generated XLSX uses all original template variants, styles, merges and print geometry', (t) => {
  const { root, input } = fixture(t), described = describeSitTemplates();
  for (const variant of ['worklist', 'worklist-1', 'worklist-2', 'worklist-3']) {
    const output = path.join(root, variant); const generated = generateSitDelivery({ ...input, templateVariant: variant }, { outputDir: output, evidenceRoot: root });
    assert.equal(generated.executionStatus, 'not-executed-by-generator');
    const prof = described.templates.find((p) => p.id === variant), base = unzipWorkbook(fs.readFileSync(path.join(pkg, 'lib/templates/sit', prof.file))), result = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试工作一览表.xlsx')));
    assert.deepEqual(result.get('xl/styles.xml'), base.get('xl/styles.xml'));
    for (const sheet of prof.sheets) {
      const a = base.get(sheet.part).toString(), b = result.get(sheet.part).toString();
      for (const tag of ['cols', 'mergeCells', 'sheetViews', 'pageSetup', 'pageMargins', 'printOptions']) {
        const regex = new RegExp(`<${tag}\\b[^>]*?(?:/>|>.*?</${tag}>)`, 's'); assert.equal(b.match(regex)?.[0], a.match(regex)?.[0], `${variant}/${sheet.name}/${tag}`);
      }
      const rows = (s) => [...s.matchAll(/<row\b[^>]*>/g)].map((m) => m[0]); assert.deepEqual(rows(b), rows(a));
    }
    const problem = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试问题记录.xlsx'))); assert.equal((problem.get('xl/worksheets/sheet2.xml').toString().match(/<f\b/g) || []).length, 135);
    for (const file of generated.files) assert.equal(sha256(fs.readFileSync(path.join(output, file.file))), file.sha256);
  }
});
test('Workbook editing preserves selfclosing neighbours and rejects hidden merged values', () => {
  const parts = new Map([['xl/workbook.xml', Buffer.from('<workbook/>')], ['sheet', Buffer.from('<worksheet><sheetData><row r="2"><c r="A2" s="1"/><c r="B2" s="2"/><c r="C2" t="inlineStr"><is><t>KEEP</t></is></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>')]]);
  setSheetCells(parts, 'sheet', { A2: '=UNTRUSTED()', B2: '<&>' });
  assert.match(parts.get('sheet').toString(), /KEEP/); assert.match(parts.get('sheet').toString(), /s="2"/); assert.match(parts.get('sheet').toString(), /&lt;&amp;&gt;/); assert.doesNotMatch(parts.get('sheet').toString(), /<f>/);
  assert.throws(() => setSheetCells(parts, 'sheet', { B1: 'invisible' }), /hidden/);
  assert.deepEqual(unzipWorkbook(zipWorkbook(parts)).get('sheet'), parts.get('sheet'));
});
test('Bulk table updates preserve first/middle/last rows and Excel cell ordering', () => {
  const cells = Array.from({ length: 1200 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" s="1"/><c r="B${i + 2}" s="2"/><c r="D${i + 2}" t="inlineStr"><is><t>KEEP${i}</t></is></c></row>`).join('');
  const parts = new Map([['sheet', Buffer.from(`<worksheet><sheetData>${cells}</sheetData></worksheet>`)]]);
  const values = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [[`A${i + 2}`, `case-${i}`], [`C${i + 2}`, `value-${i}`]]).flat());
  setSheetCells(parts, 'sheet', values); const xml = parts.get('sheet').toString();
  for (const i of [0, 600, 1199]) {
    const row = xml.match(new RegExp(`<row r="${i + 2}">(.*?)</row>`))[1];
    assert.match(row, new RegExp(`case-${i}`)); assert.match(row, new RegExp(`KEEP${i}`));
    assert.ok(row.indexOf(`r="C${i + 2}"`) < row.indexOf(`r="D${i + 2}"`));
  }
});
test('Issue tables extend beyond original three rows, preserving styles and formula cells', (t) => {
  const { root, input } = fixture(t);
  input.defects = Array.from({ length: 8 }, (_, i) => ({ id: 'D' + i, domain: '炼钢', severity: 'general', state: '未修复', module: '模块B', description: '缺陷' + i, caseId: 'C2', roundId: 'R1', discoverer: 'fixture', discoveredAt: '2026-01-11' }));
  const output = path.join(root, 'many-issues'); generateSitDelivery(input, { outputDir: output, evidenceRoot: root });
  const parts = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试问题记录.xlsx'))), sheet = parts.get('xl/worksheets/sheet6.xml').toString();
  assert.match(sheet, /D7/); assert.match(sheet, /r="X9"/); assert.match(sheet, /dimension ref="A1:AG9"/);
});
test('Workflow exports include prerequisite story members and one recorded round still prepares two sheets', (t) => {
  const { root, input } = fixture(t); input.rounds.pop();
  const output = path.join(root, 'workflow'); const generated = generateSitDelivery(input, { outputDir: output, evidenceRoot: root });
  assert.equal(generated.files.filter((f) => f.file.startsWith('SIT测试用例执行记录')).length, 2);
  const workflow = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT跨模组全流程用例.xlsx')));
  assert.match(workflow.get('xl/worksheets/sheet1.xml').toString(), /查询模块A/);
  assert.match(workflow.get('xl/worksheets/sheet1.xml').toString(), /在模块B回查/);
  const second = unzipWorkbook(fs.readFileSync(path.join(output, 'SIT测试用例执行记录-第2轮.xlsx')));
  assert.match(second.get('xl/worksheets/sheet1.xml').toString(), /未执行/);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'delivery-manifest.json')));
  assert.equal(manifest.evidencePathBase, root); assert.equal(manifest.archivedInputIsNotRelocatedEvidence, true);
});
test('Existing output/customer files and failed publication remain untouched', (t) => {
  const { root, input } = fixture(t), output = path.join(root, 'customer'); fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'custom.txt'), 'CUSTOM');
  assert.throws(() => generateSitDelivery(input, { outputDir: output, evidenceRoot: root }), /already exists/);
  assert.equal(fs.readFileSync(path.join(output, 'custom.txt'), 'utf8'), 'CUSTOM');
  const original = fs.renameSync; fs.renameSync = () => { throw new Error('injected publish failure'); };
  try { assert.throws(() => generateSitDelivery(input, { outputDir: path.join(root, 'failed'), evidenceRoot: root }), /injected/); } finally { fs.renameSync = original; }
  assert.equal(fs.existsSync(path.join(root, 'failed')), false); assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.wl-sit-staging-')), false);
});
test('SIT CLI and MCP reject malformed requests with no writes; MCP shares engine', async (t) => {
  const { root, input } = fixture(t), inputFile = path.join(root, 'input.json'); fs.writeFileSync(inputFile, JSON.stringify(input));
  const cli = (args) => spawnSync(process.execPath, [path.join(pkg, 'bin/wl-skills-test.js'), 'sit', ...args], { cwd: root, encoding: 'utf8' });
  for (const args of [['generate', '--input'], ['generate', '--input=' + inputFile, '--output'], ['verify', '--input', inputFile, '--phase', 'wat'], ['templates', '--force']]) { const run = cli(args); assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).ok, false); }
  const valid = cli(['verify', '--input=' + inputFile, '--phase=pre-uat', '--json']); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).result.passed, true);
  const server = createServer();
  for (const invalid of [false, null, [], { inputFile, phase: true }]) assert.equal((await server.callTool('wls_test_sit_verify', invalid)).isError, true);
  const result = await server.callTool('wls_test_sit_verify', { inputFile, phase: 'pre-uat' }); assert.equal(JSON.parse(result.content[0].text).passed, true);
});
test('Public protocol SIT executor preserves notice/runId and evidence mutations make status stale', (t) => {
  const { root, input } = fixture(t); applyInstallPlan(createInstallPlan(root, { filesDir: path.join(pkg, 'files'), version: PKG.version }));
  const inputFile = path.join(root, 'sit.json'); fs.writeFileSync(inputFile, JSON.stringify(input));
  const bin = path.join(pkg, 'bin/wl-skills-test.js');
  const cli = (args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const plan = cli(['task', '--task', 'SIT交付校验', '--files', 'sit.json', '--run-id', 'sit-executor-check', '--json']);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const planned = JSON.parse(plan.stdout); assert.ok(planned.notice); assert.ok(planned.decision.requiredChecks.includes('sit-delivery-checks'), plan.stdout);
  const request = path.join(root, 'request.json'); fs.writeFileSync(request, JSON.stringify({ operation: 'execute', projectRoot: root, runId: 'sit-executor-check', executorId: 'sit-verify', parameters: { targets: [inputFile], phase: 'pre-uat' } }));
  const executed = cli(['protocol', 'request', '--input-file', request, '--json']); assert.equal(executed.status, 0, executed.stdout + executed.stderr); assert.equal(JSON.parse(executed.stdout).ok, true);
  const status = cli(['status', '--run-id', 'sit-executor-check', '--json']); assert.equal(status.status, 0); const checked = JSON.parse(status.stdout);
  assert.ok(checked.tools.some((tool) => tool.checks?.some((c) => c.id === 'sit-delivery-checks' && c.status === 'passed')), status.stdout);
  assert.equal(checked.stale, false); fs.appendFileSync(path.join(root, 'run2.log'), '\nmutation');
  const stale = JSON.parse(cli(['status', '--run-id', 'sit-executor-check', '--json']).stdout); assert.equal(stale.stale, true);
});


test('SIT module owners remain unconfirmed rather than inferred from project participant order', t => {
  const { root, input } = fixture(t);
  input.project.owners = ['项目协调甲', '项目协调乙'];
  for (const variant of ['worklist', 'worklist-1', 'worklist-2', 'worklist-3']) {
    const current = { ...input, templateVariant: variant };
    const outputDir = path.join(root, variant);
    generateSitDelivery(current, { outputDir, evidenceRoot: root });
    const parts = unzipWorkbook(fs.readFileSync(path.join(outputDir, 'SIT测试工作一览表.xlsx')));
    const profile = describeSitTemplates().templates.find(profile => profile.id === variant);
    for (const name of ['6.功能测试', '11.测试方案', '12.测试报告', '3.测试用例（流程）']) {
      const sheet = profile.sheets.find(sheet => sheet.name === name);
      const xml = parts.get(sheet.part).toString();
      const start = name === '3.测试用例（流程）' ? 4 : 3;
      for (const row of [start, start + 1]) {
        const value = xml.match(new RegExp(`<c\\b[^>]*\\br="C${row}"[^>]*>([\\s\\S]*?)</c>`))?.[1];
        assert.ok(value?.includes('待确认'), `${variant}/${name}/C${row}: ${value}`);
        assert.ok(!value.includes('项目协调'));
      }
    }
    assert.match(fs.readFileSync(path.join(outputDir, 'SIT测试方案.md'), 'utf8'), /项目协调甲、项目协调乙/);
  }
});


test('SIT rejects XML 1.0 forbidden text before output and preserves valid Unicode text', t => {
  const { root, input } = fixture(t);
  for (const [index, text] of ['\u0000', '\u0001', '\ufffe', '\uffff', '\ud800', '\udfff'].entries()) {
    const illegal = text;
    const current = copy(input); current.cases[0].name += illegal;
    const outputDir = path.join(root, `xml-invalid-${index}`);
    const before = fs.readdirSync(root).sort();
    assert.throws(() => generateSitDelivery(current, { outputDir, evidenceRoot: root }), /Invalid XML 1.0 character in \$\.cases\.0\.name/);
    assert.equal(fs.existsSync(outputDir), false);
    assert.deepEqual(fs.readdirSync(root).sort(), before);
    assert.throws(() => xmlEscape(illegal), /Invalid XML 1.0 character/);
  }
  const allowed = "查询😀\t制单\n回查\r&<>\"'";
  assert.equal(xmlEscape(allowed), "查询😀\t制单\n回查\r&amp;&lt;&gt;&quot;&apos;");
  const current = copy(input); current.cases[0].name = allowed;
  const outputDir = path.join(root, 'xml-valid');
  generateSitDelivery(current, { outputDir, evidenceRoot: root });
  const parts = unzipWorkbook(fs.readFileSync(path.join(outputDir, 'SIT功能测试用例.xlsx')));
  assert.ok(parts.get('xl/worksheets/sheet1.xml').toString().includes(xmlEscape(allowed)));
});
