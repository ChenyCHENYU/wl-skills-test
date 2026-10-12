/** SIT delivery engine. Generation designs documents; verification consumes actual, hashed evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipWorkbook, zipWorkbook, fillSheetTable, setSheetCells, extendSheetColumns, sha256, xmlEscape, assertXmlText } from './sit-workbook.js';
import Ajv from 'ajv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, 'templates/sit');
const PROFILES = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'profiles.json'), 'utf8'));
const text = { type: 'string', minLength: 1, maxLength: 10000, pattern: '\\S' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const instant = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2}))?$' };
const strings = { type: 'array', items: text, maxItems: 10000, uniqueItems: true };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const evidence = obj({ path: text, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['path', 'sha256']);
const evidenceList = { type: 'array', items: evidence, maxItems: 100 };
const result = { enum: ['passed', 'failed', 'blocked', 'skipped'] };
const handoff = obj({ deliveredAt: instant, receipt: evidence }, ['deliveredAt', 'receipt']);
const states = ['未修复', '修复中', '已修复', '已验证', '非问题', '挂起', '验证未通过'];
const domains = ['营销', '品质', '计划', '炼钢', '轧钢', '精整', '冷精', '仓储'];
export const SIT_SCHEMA = obj({
  schemaVersion: { const: 1 },
  templateVariant: { enum: ['worklist', 'worklist-1', 'worklist-2', 'worklist-3'] },
  project: obj({ name: text, version: text, environment: text, systems: strings, owners: strings, outOfScope: strings }, ['name']),
  schedule: obj({ sitStart: date, uatStart: date }, ['sitStart', 'uatStart']),
  requirements: { type: 'array', maxItems: 10000, items: obj({ id: text, description: text, source: text }, ['id', 'description', 'source']) },
  cases: { type: 'array', maxItems: 10000, items: obj({
    id: text, name: text, kind: { enum: ['functional', 'cross-module'] }, priority: { enum: ['P0', 'P1', 'P2'] }, module: text,
    storyId: text, storyStep: text, preconditions: text, steps: text, expected: text, requirementIds: strings,
    systems: strings, dependsOn: strings, author: text, createdAt: date,
  }, ['id', 'name', 'kind', 'priority', 'module', 'preconditions', 'steps', 'expected', 'requirementIds']) },
  rounds: { type: 'array', maxItems: 100, items: obj({
    id: text, caseBaselineSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, startedAt: instant, finishedAt: instant,
    executions: { type: 'array', maxItems: 10000, items: obj({
      caseId: text, result, executedAt: instant, executedBy: text, actual: text, evidence: evidenceList,
      defectIds: strings, writePerformed: { type: 'boolean' },
      cleanup: obj({ status: { enum: ['completed', 'pending', 'failed', 'not-applicable'] }, evidence: evidenceList }, ['status']),
    }, ['caseId', 'result', 'executedAt', 'executedBy', 'actual', 'evidence', 'writePerformed']) },
  }, ['id', 'caseBaselineSha256', 'startedAt', 'finishedAt', 'executions']) },
  defects: { type: 'array', maxItems: 10000, items: obj({
    id: text, domain: { type: 'string', minLength: 1, maxLength: 31, pattern: '^[^\\\\/\\[\\]:*?]+$' }, severity: { enum: ['fatal', 'critical', 'general', 'minor'] }, state: { enum: states },
    type: text, module: text, menu: { type: 'array', items: text, maxItems: 3 }, description: text,
    caseId: text, roundId: text, screenshots: strings, discoverer: text, discoveredAt: instant, resolver: text, cause: text,
    plannedResolveAt: date, resolvedAt: instant, verifier: text, closedAt: instant, introducedVersion: text, resolvedVersion: text, remarks: text,
    dispositionEvidence: evidenceList,
    retests: { type: 'array', maxItems: 100, items: obj({ roundId: text, caseId: text, result, executedAt: instant, evidence: evidenceList }, ['roundId', 'caseId', 'result', 'executedAt', 'evidence']) },
  }, ['id', 'domain', 'severity', 'state', 'module', 'description', 'caseId', 'roundId', 'discoverer', 'discoveredAt']) },
  deliveries: obj(Object.fromEntries(['plan', 'cases', 'execution', 'defects', 'report'].map((name) => [name, handoff]))),
  review: obj({ decision: { enum: ['passed', 'conditional', 'rejected'] }, reviewer: text, at: instant, evidence: evidenceList, risks: strings }, ['decision', 'reviewer', 'at', 'evidence']),
}, ['schemaVersion', 'project', 'schedule', 'requirements', 'cases']);
const validate = new Ajv({ allErrors: true, strict: true }).compile(SIT_SCHEMA);
function calendar(value) {
  if (!value || Number.isNaN(Date.parse(value)) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error(`Invalid calendar date: ${value}`);
  return Date.parse(value);
}
function unique(items, label) {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} id`);
}
export function validateSitInput(input) {
  if (!validate(input)) throw new Error(`SIT invalid-input: ${JSON.stringify(validate.errors)}`);
  const walkText = (value, field = '$') => {
    if (typeof value === 'string') assertXmlText(value, field);
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walkText(child, `${field}.${key}`);
    }
  };
  walkText(input);
  const walkDates = (value, key = '') => {
    if (typeof value === 'string' && /^(?:sitStart|uatStart|createdAt|startedAt|finishedAt|executedAt|discoveredAt|plannedResolveAt|resolvedAt|closedAt|deliveredAt|at)$/.test(key)) calendar(value);
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkDates(v, k);
  };
  walkDates(input);
  if (calendar(input.schedule.sitStart) >= calendar(input.schedule.uatStart)) throw new Error('UAT must start after SIT');
  for (const key of ['requirements', 'cases', 'rounds', 'defects']) unique(input[key] || [], key);
  const issueDomains = new Set((input.defects || []).map((d) => d.domain));
  if (issueDomains.size > 8 || new Set([...issueDomains].map((name) => name.toLowerCase())).size !== issueDomains.size || [...issueDomains].some((name) => name.trim() !== name || !name.trim() || /[\u0000-\u001f]/.test(name) || name === '总览' || name.startsWith("'") || name.endsWith("'"))) throw new Error('Issue template supports up to eight distinct valid Excel domain names; 总览 is reserved');
  const requirements = new Set(input.requirements.map((r) => r.id)), cases = new Map(input.cases.map((c) => [c.id, c]));
  for (const item of input.cases) {
    if (item.requirementIds.some((id) => !requirements.has(id))) throw new Error(`Unknown requirement in case ${item.id}`);
    if ((item.dependsOn || []).some((id) => id === item.id || !cases.has(id))) throw new Error(`Invalid dependency in case ${item.id}`);
    if (item.kind === 'functional' && item.dependsOn?.length) throw new Error(`Functional case ${item.id} must be independent; declare workflow dependencies on cross-module cases`);
  }
  // Iterative DAG check avoids recursion depth failures for large workflow sets.
  const pending = new Map(input.cases.map((c) => [c.id, new Set(c.dependsOn || [])]));
  const outgoing = new Map();
  for (const [id, deps] of pending) for (const dep of deps) { if (!outgoing.has(dep)) outgoing.set(dep, []); outgoing.get(dep).push(id); }
  const queue = [...pending].filter(([, deps]) => !deps.size).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) for (const child of outgoing.get(queue[i]) || []) { const deps = pending.get(child); deps.delete(queue[i]); if (!deps.size) queue.push(child); }
  if (queue.length !== pending.size) throw new Error('Case dependency cycle');
  return input;
}
export function caseBaseline(input) {
  // JSON property order is transport formatting; the ordered case inventory is business data.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return sha256(Buffer.from(JSON.stringify(canonical(input.cases))));
}
export function describeSitTemplates() {
  return { schemaVersion: 1, templates: PROFILES.templates, inputSchema: SIT_SCHEMA,
    preservation: ['styles', 'column-widths', 'original-row-heights', 'merged-cells', 'print-settings', 'summary-formulas'],
    changed: ['sanitized-sample-values', 'old-external-links', 'cached-formula-results', 'used-range-dimension', 'appended-data-rows'],
    sourceDataIncluded: false, officeRenderVerified: false, generatedDocumentsAreExecutionEvidence: false };
}
function loadTemplate(id) {
  const profile = PROFILES.templates.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown SIT template: ${id}`);
  const bytes = fs.readFileSync(path.join(TEMPLATE_DIR, profile.file));
  if (sha256(bytes) !== profile.sha256) throw new Error(`SIT template integrity mismatch: ${id}`);
  return { profile, parts: unzipWorkbook(bytes) };
}
function evidenceCheck(ref, root) {
  try {
    if (path.isAbsolute(ref.path)) return false;
    const resolved = fs.realpathSync(path.resolve(root, ref.path));
    const rel = path.relative(fs.realpathSync(root), resolved);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !fs.statSync(resolved).isFile()) return false;
    return sha256(fs.readFileSync(resolved)) === ref.sha256;
  } catch { return false; }
}
export function sitEvidencePaths(input, root) {
  const result = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string' && typeof value.sha256 === 'string' && evidenceCheck(value, root)) result.add(fs.realpathSync(path.resolve(root, value.path)));
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  }
  walk(input);
  return [...result];
}
/** Read-only gate: validates records and local evidence bytes, never claims it ran tests or witnessed customer receipt. */
export function verifySitDelivery(input, { phase, evidenceRoot = process.cwd(), now = Date.now() } = {}) {
  validateSitInput(input);
  if (!['pre-sit', 'pre-uat'].includes(phase)) throw new Error('phase must be pre-sit or pre-uat');
  const gaps = [], checks = [];
  const check = (id, ok, detail) => { checks.push({ id, status: ok ? 'passed' : 'blocked', detail }); if (!ok) gaps.push({ id, detail }); };
  const refsValid = (refs) => Boolean(refs?.length && refs.every((ref) => evidenceCheck(ref, evidenceRoot)));
  const baseline = caseBaseline(input), deadline = calendar(input.schedule.sitStart) - 7 * 86400000;
  const futureEvents = [];
  function inspectActualDates(value, key = '', location = '') {
    if (typeof value === 'string' && /^(?:createdAt|startedAt|finishedAt|executedAt|discoveredAt|resolvedAt|closedAt|deliveredAt|at)$/.test(key) && calendar(value) > now) futureEvents.push(location);
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) inspectActualDates(v, k, `${location}/${k}`);
  }
  inspectActualDates(input);
  check('actual-events-not-in-future', !futureEvents.length, `实际执行、评审和交付不能填写未来日期${futureEvents.length ? '：' + futureEvents.join('、') : ''}`);
  check('requirements-present', input.requirements.length > 0, '至少一项有来源的真实需求');
  check('case-inventory-present', input.cases.length > 0, '零用例不能视为全量通过');
  check('case-traceability', input.cases.every((c) => c.requirementIds.length), '每条用例关联真实需求');
  const storyModules = new Map();
  for (const c of input.cases) if (c.storyId) {
    if (!storyModules.has(c.storyId)) storyModules.set(c.storyId, new Set());
    storyModules.get(c.storyId).add(c.module);
  }
  check('workflow-facts', input.cases.filter((c) => c.kind === 'cross-module').every((c) => {
    return c.storyId && c.storyStep && c.systems?.length && storyModules.get(c.storyId)?.size >= 2;
  }), '跨模组流程须有故事线、步骤和真实系统，故事线覆盖两个模组；同一系统内跨模组也适用');
  const covered = new Set(input.cases.flatMap((c) => c.requirementIds));
  check('requirements-covered', input.requirements.every((r) => covered.has(r.id)), '所有纳入范围的需求都有用例覆盖');
  check('project-facts', Boolean(input.project.version && input.project.environment && input.project.systems?.length && input.project.owners?.length), '确认版本、环境、系统与责任人；不填默认生产配置');
  for (const id of ['plan', 'cases']) {
    const record = input.deliveries?.[id];
    check(`handoff-${id}`, Boolean(record && calendar(record.deliveredAt) <= deadline && evidenceCheck(record.receipt, evidenceRoot)), '在SIT开始前至少7个日历日交付，附客户交付回执文件及hash');
  }
  check('case-review', Boolean(input.review?.decision === 'passed' && !input.review.risks?.length && refsValid(input.review.evidence) && calendar(input.review.at) < calendar(input.schedule.sitStart)), '用例评审通过且无未关闭风险，附真实评审证据');
  const roundDetails = [];
  if (phase === 'pre-uat') {
    const caseMap = new Map(input.cases.map((c) => [c.id, c]));
    const ids = new Set(caseMap.keys()), defectMap = new Map((input.defects || []).map((d) => [d.id, d]));
    const roundMap = new Map((input.rounds || []).map((r) => [r.id, r]));
    const ordered = [...(input.rounds || [])].sort((a, b) => calendar(a.startedAt) - calendar(b.startedAt));
    check('rounds-independent-in-time', ordered.every((r, i) => !i || calendar(r.startedAt) > calendar(ordered[i - 1].finishedAt)), '各轮按顺序独立执行，不能改roundId重用同一组执行时间');
    for (const round of input.rounds || []) {
      const seen = new Set(), reasons = [];
      const executionMap = new Map(round.executions.map((e) => [e.caseId, e]));
      if (round.caseBaselineSha256 !== baseline) reasons.push('case-baseline-mismatch');
      if (calendar(round.startedAt) < calendar(input.schedule.sitStart) || calendar(round.finishedAt) < calendar(round.startedAt) || calendar(round.finishedAt) >= calendar(input.schedule.uatStart)) reasons.push('round-outside-SIT-window');
      for (const e of round.executions) {
        if (!ids.has(e.caseId) || seen.has(e.caseId)) reasons.push('unknown-or-duplicate-case');
        seen.add(e.caseId);
        if (!['passed', 'failed'].includes(e.result)) reasons.push('case-not-executed');
        if (!refsValid(e.evidence)) reasons.push('execution-evidence-missing-or-mismatched');
        if (calendar(e.executedAt) < calendar(round.startedAt) || calendar(e.executedAt) > calendar(round.finishedAt)) reasons.push('execution-outside-round');
        const plannedCase = caseMap.get(e.caseId);
        for (const dependency of plannedCase?.dependsOn || []) {
          const previous = executionMap.get(dependency);
          if (!previous || previous.result !== 'passed' || calendar(previous.executedAt) >= calendar(e.executedAt)) reasons.push('dependency-not-passed-before-execution');
        }
        if (e.result === 'failed' && !(e.defectIds?.length && e.defectIds.some((id) => {
          const defect = defectMap.get(id), origin = roundMap.get(defect?.roundId);
          return defect?.caseId === e.caseId && origin && calendar(origin.startedAt) <= calendar(round.startedAt);
        }))) reasons.push('failed-case-without-own-defect');
        if ((e.defectIds || []).some((id) => !defectMap.has(id))) reasons.push('unknown-defect');
        if ((e.defectIds || []).some((id) => defectMap.has(id) && defectMap.get(id).caseId !== e.caseId)) reasons.push('defect-case-identity-mismatch');
        if (e.writePerformed && !(e.cleanup?.status === 'completed' && refsValid(e.cleanup.evidence))) reasons.push('write-cleanup-not-evidenced');
      }
      if (!ids.size || seen.size !== ids.size || [...ids].some((id) => !seen.has(id))) reasons.push('not-full-round');
      roundDetails.push({ id: round.id, full: !reasons.length, reasons: [...new Set(reasons)], passed: round.executions.filter((e) => e.result === 'passed').length, failed: round.executions.filter((e) => e.result === 'failed').length });
    }
    check('two-full-rounds', roundDetails.filter((r) => r.full).length >= 2, '至少两轮不同roundId、相同用例基线、逐用例真实执行和hash证据；失败执行可计入全量，但必须关联问题');
    const latest = [...(input.rounds || [])].sort((a, b) => calendar(b.finishedAt) - calendar(a.finishedAt))[0];
    check('latest-round-passed', Boolean(latest && roundDetails.find((r) => r.id === latest.id)?.full && latest.executions.every((e) => e.result === 'passed')), '最后一轮全量通过；不以较早通过记录掩盖最近失败');
    for (const defect of input.defects || []) {
      const source = roundMap.get(defect.roundId)?.executions.find((e) => e.caseId === defect.caseId);
      check(`defect-source:${defect.id}`, Boolean(source?.result === 'failed' && source.defectIds?.includes(defect.id) && calendar(defect.discoveredAt) >= calendar(source.executedAt)), '问题必须关联原轮次失败用例，发现时间不早于该次执行');
      check(`defect-assignment:${defect.id}`, Boolean(defect.resolver && defect.cause && defect.plannedResolveAt), '问题负责人、原因和计划解决日期需明确，不能由空单元格推断按时解决');
      const closed = ['已验证', '非问题'].includes(defect.state);
      const retested = (defect.retests || []).some((r) => r.caseId === defect.caseId && r.result === 'passed' && refsValid(r.evidence) && roundMap.get(r.roundId)?.executions.some((e) => e.caseId === r.caseId && e.result === 'passed' && e.executedAt === r.executedAt) && calendar(r.executedAt) >= calendar(defect.discoveredAt));
      const latestRetest = Math.max(0, ...(defect.retests || []).filter((r) => r.result === 'passed').map((r) => calendar(r.executedAt)));
      check(`defect-closure:${defect.id}`, !closed || Boolean(defect.verifier && defect.closedAt && calendar(defect.closedAt) >= Math.max(calendar(defect.discoveredAt), latestRetest) && (defect.state === '非问题' ? refsValid(defect.dispositionEvidence) : retested)), '关闭问题需验证人、重测后关闭时间和对应重测证据；非问题需复核依据');
      check(`critical-defect:${defect.id}`, !['fatal', 'critical'].includes(defect.severity) || closed, '致命/严重问题未闭环禁止转UAT');
    }
    for (const id of ['execution', 'defects', 'report']) {
      const handoffRecord = input.deliveries?.[id];
      check(`handoff-${id}`, Boolean(handoffRecord && calendar(handoffRecord.deliveredAt) < calendar(input.schedule.uatStart) && (!latest || calendar(handoffRecord.deliveredAt) >= calendar(latest.finishedAt)) && evidenceCheck(handoffRecord.receipt, evidenceRoot)), '最后一轮完成后、转UAT前交付并附客户回执；问题为空也需交付问题记录');
    }
  }
  return { schemaVersion: 1, phase, passed: !gaps.length, validationStatus: gaps.length ? 'blocked' : 'completed', caseBaselineSha256: baseline,
    checks, gaps, rounds: roundDetails, executionStatus: 'not-executed-by-this-command', businessBehaviorObserved: false,
    evidenceLevel: 'caller-records-and-local-sha256-references', customerReceiptObserved: false, hostDiscovery: 'unverified' };
}
const pending = (value) => value || '待确认';
function caseRows(cases) {
  return cases.map((c) => [pending(c.storyId), pending(c.storyStep), c.id, c.name, c.priority, c.module, c.module,
    c.preconditions, c.steps, c.expected, c.kind === 'cross-module' ? '跨模组全流程' : '功能', pending(c.systems?.join(' → ')), pending(c.author), pending(c.createdAt)]);
}
function casesWorkbook(cases) {
  const { parts, profile } = loadTemplate('cases');
  fillSheetTable(parts, profile.sheets[0].part, 2, caseRows(cases));
  const stories = [...new Set(cases.map((c) => c.storyId).filter(Boolean))];
  fillSheetTable(parts, profile.sheets[1].part, 2, stories.map((id) => {
    const members = cases.filter((c) => c.storyId === id);
    return [id, members.map((c) => c.name).join(' → '), members.some((c) => c.priority === 'P0') ? 'P0' : 'P1', members.length, new Set(members.map((c) => c.module)).size, members.map((c) => c.storyStep || c.name).join(' → ')];
  }));
  return zipWorkbook(parts);
}
function issuesWorkbook(input) {
  const { parts, profile } = loadTemplate('issues');
  // The original summary formulas count 提示; changing that label would drop minor issues.
  const levels = { fatal: '致命', critical: '严重', general: '一般', minor: '提示' };
  const excelDate = (value) => value ? (calendar(value) - Date.UTC(1899, 11, 30)) / 86400000 : '';
  const observed = [...new Set((input.defects || []).map((d) => d.domain))], unused = domains.filter((d) => !observed.includes(d));
  const renamed = new Map(observed.filter((d) => !domains.includes(d)).map((name, i) => [unused[i], name]));
  let workbook = parts.get('xl/workbook.xml').toString(), summary = parts.get(profile.sheets[0].part).toString();
  for (const [oldName, name] of renamed) {
    const escapedName = name.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    workbook = workbook.replace(`name="${oldName}"`, `name="${escapedName}"`);
    const formulaName = xmlEscape(name.replaceAll("'", "''"));
    // Feishu exports encode quote characters as numeric XML entities in formulas.
    summary = summary.replace(new RegExp(`(?:'|&#39;|&#x27;|&apos;)${oldName}(?:'|&#39;|&#x27;|&apos;)!`, 'g'), () => `'${formulaName}'!`)
      .replaceAll(`<t xml:space="preserve">${oldName}</t>`, `<t xml:space="preserve">${escapedName}</t>`);
  }
  parts.set('xl/workbook.xml', Buffer.from(workbook)); parts.set(profile.sheets[0].part, Buffer.from(summary));
  for (const sheet of profile.sheets.slice(1)) {
    const domain = renamed.get(sheet.name) || sheet.name;
    const rows = (input.defects || []).filter((d) => d.domain === domain).map((d) => [d.id, 'SIT', d.domain, levels[d.severity], pending(d.type), d.state, d.module,
      ...(d.menu || []).concat(['', '', '']).slice(0, 3), d.description, d.screenshots?.[0] || '', d.screenshots?.[1] || '', d.discoverer, excelDate(d.discoveredAt), pending(d.resolver), pending(d.cause), excelDate(d.plannedResolveAt), excelDate(d.resolvedAt), d.verifier || '', excelDate(d.closedAt), d.introducedVersion || '', d.resolvedVersion || '', `${d.remarks || ''}\n用例=${d.caseId}；轮次=${d.roundId}`]);
    fillSheetTable(parts, sheet.part, 2, rows);
  }
  // Preserve the customer's 135 summary formulas, with no forged cached calculation.
  return zipWorkbook(parts);
}
function worklistWorkbook(input) {
  const { parts, profile } = loadTemplate(input.templateVariant || 'worklist');
  const modules = [...new Set(input.cases.map((c) => c.module))];
  if (modules.length > 22) throw new Error('Worklist template supports 22 module slots; use an explicitly reviewed larger profile rather than truncate');
  const links = { '6.功能测试': ['SIT功能测试用例.xlsx'], '11.测试方案': ['SIT测试方案.md'], '12.测试报告': ['SIT测试报告.md'], '3.测试用例（流程）': ['SIT跨模组全流程用例.xlsx'] };
  for (const [name, files] of Object.entries(links)) {
    const sheet = profile.sheets.find((s) => s.name === name), values = {};
    const start = name === '3.测试用例（流程）' ? 4 : 3;
    modules.forEach((module, i) => {
      // Project participants do not establish a module-to-owner assignment.
      const row = start + i; values[`B${row}`] = module; values[`C${row}`] = '待确认';
      if (name === '3.测试用例（流程）') { values[`J${row}`] = files[0]; values[`K${row}`] = input.cases.filter((c) => c.kind === 'cross-module' && c.module === module).length; values[`L${row}`] = '已生成，待评审'; values[`M${row}`] = input.deliveries?.cases ? '交付记录待核验' : '未交付'; }
      else if (name === '6.功能测试') values[`E${row}`] = files[0];
      else values[`D${row}`] = files[0];
    });
    setSheetCells(parts, sheet.part, values);
  }
  return zipWorkbook(parts);
}
function markdown(input, phase, verification) {
  const lines = [`# ${input.project.name} · SIT${phase === 'plan' ? '测试方案' : '测试报告'}`, '', '> 内容由事实输入生成。生成文件不代表已执行测试、已交付客户或已通过验收。', '',
    `- 项目版本：${pending(input.project.version)}`, `- 测试环境：${pending(input.project.environment)}`, `- 系统：${pending(input.project.systems?.join('、'))}`, `- 责任人：${pending(input.project.owners?.join('、'))}`,
    `- SIT开始：${input.schedule.sitStart}；转UAT：${input.schedule.uatStart}`, `- 方案和用例交付截止：${new Date(calendar(input.schedule.sitStart) - 7 * 86400000).toISOString().slice(0, 10)}`, '',
    '## 需求和范围', '', ...input.requirements.map((r) => `- ${r.id}：${r.description}（来源：${r.source}）`), '', '## 用例与故事线', '',
    `功能用例 ${input.cases.filter((c) => c.kind === 'functional').length} 条；跨模组用例 ${input.cases.filter((c) => c.kind === 'cross-module').length} 条。`,
    ...input.cases.map((c) => `- ${c.id} ${c.name} → ${c.requirementIds.join('、')}；依赖：${c.dependsOn?.join('、') || '无'}`), '',
    '## 执行与数据安全', '', '至少两轮全量，逐用例记录实际结果、时间、执行人、证据hash和关联问题。业务写入只在明确授权环境进行，写入后记录清理证据；未执行/阻塞不记通过。', '',
    '## 评审、交付与进入UAT条件', '', 'SIT前7日交付方案和用例；转UAT前交付两轮全量执行记录、问题清单、测试报告。最后一轮全量通过，致命/严重问题闭环；生成器不会代填客户签收。', '',
    '## 范围外与待确认', '', ...(input.project.outOfScope || []).map((s) => `- 范围外：${s}`), ...verification.gaps.map((g) => `- ${g.id}：${g.detail}`), ''];
  if (phase === 'report') lines.push('## 本次记录校验', '', `交付记录校验：${verification.passed ? '通过' : '未满足'}；本命令未观察真实业务测试行为。`, '', ...verification.rounds.map((r) => `- ${r.id}：全量证据${r.full ? '齐全' : '不齐全'}，通过${r.passed}，失败${r.failed}；${r.reasons.join('、')}`), '', '详细判定见 delivery-verification.json。');
  return lines.join('\n');
}
function canonicalMissing(target) {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  const parent = path.dirname(target);
  if (parent === target) throw new Error('No existing output ancestor');
  return path.join(canonicalMissing(parent), path.basename(target));
}
/** Require an entirely new output directory. Never overwrite customer work or leave a partial delivery. */
export function generateSitDelivery(input, { outputDir, evidenceRoot = process.cwd() } = {}) {
  validateSitInput(input);
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('outputDir required');
  const requested = path.resolve(outputDir), output = canonicalMissing(requested);
  if (requested !== output) throw new Error('Output symlink paths are not supported');
  if (fs.existsSync(output)) throw new Error('Output already exists; preserve customer edits and choose a new directory');
  const parent = path.dirname(output);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('Output parent directory must exist');
  const verification = verifySitDelivery(input, { phase: 'pre-uat', evidenceRoot });
  const workflowStories = new Set(input.cases.filter((c) => c.kind === 'cross-module').map((c) => c.storyId).filter(Boolean));
  const workflowCases = input.cases.filter((c) => c.kind === 'cross-module' || workflowStories.has(c.storyId));
  const files = new Map([
    ['SIT测试工作一览表.xlsx', worklistWorkbook(input)], ['SIT功能测试用例.xlsx', casesWorkbook(input.cases.filter((c) => c.kind === 'functional'))],
    ['SIT跨模组全流程用例.xlsx', casesWorkbook(workflowCases)], ['SIT测试问题记录.xlsx', issuesWorkbook(input)],
    ['SIT测试方案.md', Buffer.from(markdown(input, 'plan', verification))], ['SIT测试报告.md', Buffer.from(markdown(input, 'report', verification))],
    ['sit-input.json', Buffer.from(JSON.stringify(input, null, 2) + '\n')], ['delivery-verification.json', Buffer.from(JSON.stringify(verification, null, 2) + '\n')],
  ]);
  const rounds = [...(input.rounds || [])];
  while (rounds.length < 2) rounds.push({ id: `pending-round-${rounds.length + 1}`, executions: [] });
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index], { parts, profile } = loadTemplate('cases'), sheet = profile.sheets[0].part;
    const headers = ['轮次ID', '实际结果', '执行人', '执行时间', '实际结果说明', '问题编号', '证据文件与sha256', '清理状态'];
    const extra = Object.fromEntries(headers.map((header, i) => [String.fromCharCode(79 + i) + '1', header]));
    setSheetCells(parts, sheet, extra);
    extendSheetColumns(parts, sheet, 15, 22);
    const executionMap = new Map(round.executions.map((record) => [record.caseId, record]));
    const rows = caseRows(input.cases).map((row, i) => {
      const e = executionMap.get(input.cases[i].id);
      return [...row, round.id, e?.result || '未执行', e?.executedBy || '', e?.executedAt || '', e?.actual || '', e?.defectIds?.join('、') || '', e?.evidence?.map((ref) => `${ref.path}#sha256=${ref.sha256}`).join('\n') || '', e?.cleanup?.status || (e?.writePerformed ? '待清理' : '未执行/未声明写入')];
    });
    fillSheetTable(parts, sheet, 2, rows);
    files.set(`SIT测试用例执行记录-第${index + 1}轮.xlsx`, zipWorkbook(parts));
  }
  const manifest = { schemaVersion: 1, templateVariant: input.templateVariant || 'worklist', caseBaselineSha256: caseBaseline(input),
    generatedAt: new Date().toISOString(), executionStatus: 'not-executed-by-generator', officeRenderVerified: false,
    evidencePathBase: path.resolve(evidenceRoot), archivedInputIsNotRelocatedEvidence: true,
    files: [...files].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha256(bytes) })), templateProfiles: PROFILES.templates.map(({ id, sha256: hash, stylesSha256 }) => ({ id, sha256: hash, stylesSha256 })) };
  files.set('delivery-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  const staging = fs.mkdtempSync(path.join(parent, '.wl-sit-staging-'));
  try {
    for (const [file, bytes] of files) fs.writeFileSync(path.join(staging, file), bytes, { flag: 'wx' });
    // mkdir is exclusive, so even a concurrently-created directory cannot be replaced by rename.
    fs.mkdirSync(output);
    try { fs.renameSync(staging, output); }
    catch (error) { try { fs.rmdirSync(output); } catch { /* Preserve any foreign files created concurrently. */ } throw error; }
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  return { outputDir: output, files: manifest.files, manifest: 'delivery-manifest.json', caseBaselineSha256: manifest.caseBaselineSha256,
    validationStatus: verification.validationStatus, gaps: verification.gaps, executionStatus: 'not-executed-by-generator', officeRenderVerified: false };
}
