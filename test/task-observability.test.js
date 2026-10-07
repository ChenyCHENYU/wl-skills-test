import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { routeTask, readRoutes } from '../lib/task-routing.js';
import { inspectInstallation, inspectHost } from '../lib/host-diagnostics.js';
import { createInstallPlan, createCleanPlan, applyInstallPlan } from '../lib/cli/install-state.js';
import { PKG_ROOT, PKG } from '../lib/cli/context.js';
import { planTask, taskStatus } from '../lib/cli/commands/tasks.js';
import { observeSync, observe } from '../lib/observed-execution.js';
import { audit } from '../lib/test-audit.js';
import { generateReport, discoverDimensionResults } from '../lib/report-generator.js';
import { HANDLERS } from '../mcp/tools/handlers.js';

function fixture(installed = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-task-')));
  if (installed) applyInstallPlan(createInstallPlan(root, { filesDir: path.join(PKG_ROOT, 'files'), version: PKG.version }));
  return { root, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function goodFile(root) {
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  const file = path.join(root, 'tests', 'list.spec.js');
  fs.writeFileSync(file, `import { test, expect } from '@playwright/test';\ntest.beforeEach(() => {}); test.afterEach(() => {});\ntest('should display', async ({page}) => { await expect(page.locator('table')).toBeVisible(); });`);
  return file;
}
const bin = path.join(PKG_ROOT, 'bin/wl-skills-test.js');
const cli = (root, args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });

for (const skill of readRoutes().skills) test(`route: real manifest selects ${skill.id}`, () => {
  const result = routeTask(skill.phrases[0], { installed: false });
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.selectedSkills, [skill.id]);
  assert.ok(result.requiredFiles.includes(skill.path));
  assert.ok(result.constraints.length > 0);
});

test('route: negative phrases and ASCII boundaries do not select a workflow', () => {
  assert.equal(routeTask('不要生成测试方案', { installed: false }).status, 'not-applicable');
  assert.equal(routeTask('myprefixE2Esuffix', { installed: false }).status, 'needs-context');
  assert.equal(routeTask('仅代码评审，不要评审测试用例', { installed: false }).status, 'baseline');
});
test('route: independent intents are ambiguous; specificity separates performance from generic plan', () => {
  const ambiguous = routeTask('分析业务场景和生成测试用例', { installed: false });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.selectedSkills.length, 0);
  assert.ok(ambiguous.question);
  assert.deepEqual(routeTask('性能测试方案', { installed: false }).selectedSkills, ['perf-plan-generator']);
});
test('route: baseline, unsupported capability and unresolved context remain distinct', () => {
  assert.equal(routeTask('修复订单提交', { installed: false, context: { files: ['src/order.ts'] } }).status, 'baseline');
  assert.equal(routeTask('对这个接口进行模糊测试', { installed: false }).status, 'gap');
  assert.equal(routeTask('检查这个', { installed: false }).status, 'needs-context');
  const unknown = routeTask('帮我处理一下', { installed: false });
  assert.equal(unknown.status, 'needs-context');
  assert.deepEqual(unknown.requiredFiles, []); assert.deepEqual(unknown.requiredChecks, []);
  assert.equal(routeTask('写首诗介绍旅游天气', { installed: false }).status, 'not-applicable');
  assert.equal(routeTask('调整文档', { installed: false, context: { domain: 'documentation' } }).status, 'not-applicable');
});
test('task: missing standard persists a scoped gap and suggestion, without executions', () => {
  const f = fixture();
  try {
    fs.unlinkSync(path.join(f.root, '.github/standards/02-case-design.md'));
    const plan = planTask({ task: '生成测试用例', root: f.root });
    assert.equal(plan.decision.status, 'gap');
    assert.ok(plan.decision.gaps[0].paths.includes('.github/standards/02-case-design.md'));
    const status = taskStatus({ root: f.root, runId: plan.runId });
    assert.equal(status.executionStatus, 'not-executed');
    assert.equal(status.validationStatus, 'unverified');
    assert.equal(status.gapSuggestions.length, 1);
    assert.ok(status.gapSuggestions[0].suggestion);
  } finally { f.dispose(); }
});
test('validate: empty and missing-owned installations fail; a complete installation passes', () => {
  const f = fixture(false);
  try {
    assert.equal(cli(f.root, ['validate', '--json']).status, 1);
    applyInstallPlan(createInstallPlan(f.root, { filesDir: path.join(PKG_ROOT, 'files'), version: PKG.version }));
    assert.equal(cli(f.root, ['validate', '--json']).status, 0);
    fs.unlinkSync(path.join(f.root, '.github/skills/onboarding/test-onboarding/SKILL.md'));
    assert.equal(cli(f.root, ['validate', '--json']).status, 1);
  } finally { f.dispose(); }
});
test('gateway: foreign existing entry blocks installation atomically and clean preserves foreign siblings', () => {
  const f = fixture(false);
  try {
    const gateway = path.join(f.root, '.agents/skills/wl-skills-test/SKILL.md');
    fs.mkdirSync(path.dirname(gateway), { recursive: true }); fs.writeFileSync(gateway, 'project-owned gateway');
    const plan = createInstallPlan(f.root, { filesDir: path.join(PKG_ROOT, 'files'), version: PKG.version });
    assert.ok(plan.conflicts.some(c => c.path === '.agents/skills/wl-skills-test/SKILL.md'));
    assert.equal(fs.readFileSync(gateway, 'utf8'), 'project-owned gateway');
    fs.unlinkSync(gateway);
    applyInstallPlan(createInstallPlan(f.root, { filesDir: path.join(PKG_ROOT, 'files'), version: PKG.version }));
    const foreign = path.join(f.root, '.agents/skills/customer/SKILL.md');
    fs.mkdirSync(path.dirname(foreign), { recursive: true }); fs.writeFileSync(foreign, 'customer-owned');
    applyInstallPlan(createCleanPlan(f.root));
    assert.equal(fs.readFileSync(foreign, 'utf8'), 'customer-owned');
    assert.equal(fs.existsSync(gateway), false);
  } finally { f.dispose(); }
});
test('CLI/MCP: read-only route does not persist; task/status share a run and static host loading stays unknown', () => {
  const f = fixture();
  try {
    const readOnly = cli(f.root, ['route', '接入测试', '--json']);
    assert.equal(readOnly.status, 0); assert.equal(JSON.parse(readOnly.stdout).status, 'matched');
    assert.equal(fs.existsSync(path.join(f.root, '.wl-skills-test/runs')), false);
    const started = cli(f.root, ['task', '接入测试', '--run-id', 'task-shared', '--json']);
    assert.equal(started.status, 0); assert.equal(JSON.parse(started.stdout).runId, 'task-shared');
    const result = HANDLERS.wls_test_task({ action: 'status', root: f.root, runId: 'task-shared' });
    assert.equal(result.runId, 'task-shared'); assert.equal(result.validationStatus, 'unverified');
    const host = JSON.parse(cli(f.root, ['doctor-host', '--json']).stdout);
    assert.equal(host.contentLoaded, 'unverified'); assert.equal(host.details.connection, 'unknown');
    assert.equal(inspectHost(f.root).hostContextLoaded, 'unknown');
  } finally { f.dispose(); }
});
test('receipts: a checker completes with failed validation; zero checks cannot pass; thrown errors are recorded', async () => {
  const f = fixture(false);
  try {
    const target = goodFile(f.root);
    fs.appendFileSync(target, '\ntest.only("broken", async ({page}) => { await page.click("x"); });');
    const result = observeSync('audit', { root: f.root, runId: 'failed-check' }, [target], () => audit(target));
    assert.equal(result.execution.executionStatus, 'completed'); assert.equal(result.execution.validationStatus, 'failed');
    const checkedReceipt = JSON.parse(fs.readFileSync(path.join(f.root, result.execution.recordPath), 'utf8'));
    assert.equal(checkedReceipt.checkedScopeSource, 'executor');
    assert.deepEqual(checkedReceipt.checkedFiles.map(file => file.path), ['tests/list.spec.js']);
    const empty = observeSync('audit', { root: f.root, runId: 'zero-check' }, [target], () => ({ pass: true, executedChecks: [] }));
    assert.equal(empty.execution.validationStatus, 'unverified');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, empty.execution.recordPath), 'utf8')).checkedFiles, []);
    await assert.rejects(observe('run-playwright', { root: f.root, runId: 'error-check' }, [target], () => { throw new Error('runner unavailable'); }));
    assert.equal(taskStatus({ root: f.root, runId: 'error-check' }).executionStatus, 'failed');
  } finally { f.dispose(); }
});
test('status and report: immutable receipts correlate one run, detect stale inputs and reject changed results', () => {
  const f = fixture();
  try {
    const target = goodFile(f.root);
    const config = path.join(f.root, 'wl-test.config.json'); fs.writeFileSync(config, '{"context":1}');
    const first = observeSync('audit', { root: f.root, runId: 'first' }, [target], () => audit(target));
    const second = observeSync('audit', { root: f.root, runId: 'second' }, [target], () => audit(target));
    assert.ok(discoverDimensionResults(path.join(f.root, 'test-reports')).error);
    const found = discoverDimensionResults(path.join(f.root, 'test-reports'), { runId: 'first' });
    assert.equal(found.audit, first.correlatedResultFile);
    const report = generateReport({ audit: found.audit, projectRoot: f.root, runId: 'first', strictCorrelation: true });
    assert.equal(report.pass, true); assert.equal(report.validationStatus, 'passed');
    fs.writeFileSync(config, '{"context":2}');
    assert.equal(generateReport({ audit: first, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'partial');
    assert.equal(taskStatus({ root: f.root, runId: 'first' }).validationStatus, 'stale');
    fs.writeFileSync(config, '{"context":1}');
    assert.ok(generateReport({ audit: first, api: second, projectRoot: f.root }).error);
    const changed = JSON.parse(fs.readFileSync(found.audit, 'utf8')); changed.total = 99;
    assert.ok(generateReport({ audit: changed, projectRoot: f.root, strictCorrelation: true }).error);
    fs.appendFileSync(target, '\n// changed after verification');
    assert.equal(taskStatus({ root: f.root, runId: 'first' }).validationStatus, 'stale');
    const stale = generateReport({ audit: first, projectRoot: f.root, strictCorrelation: true });
    assert.equal(stale.pass, false); assert.equal(stale.validationStatus, 'partial');
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('\n// changed after verification', ''));
    const newest = observeSync('audit', { root: f.root, runId: 'first' }, [target], () => audit(target));
    assert.equal(generateReport({ audit: first, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'partial', 'superseded receipt must not revive an older result');
    const support = path.join(path.dirname(target), 'support.js'); fs.writeFileSync(support, 'export const support = true;');
    planTask({ task: '通用测试规则', root: f.root, runId: 'audit-scope', context: { files: [target] } });
    const scoped = observeSync('audit', { root: f.root, runId: 'audit-scope' }, [path.dirname(target)], () => audit(path.dirname(target)));
    assert.equal(taskStatus({ root: f.root, runId: 'audit-scope' }).validationStatus, 'passed');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, scoped.execution.recordPath), 'utf8')).checkedFiles.map(file => file.path), ['tests/list.spec.js'], 'directory snapshots must not claim unchecked support files');
    planTask({ task: '通用测试规则', root: f.root, runId: 'audit-scope', context: { files: [support] } });
    assert.ok(taskStatus({ root: f.root, runId: 'audit-scope' }).scopeGaps.some(gap => gap.path === 'tests/support.js'));
    const page = path.join(f.root, 'page-spec.json'); fs.writeFileSync(page, '{}');
    const linked = path.join(f.root, 'api.json'); fs.writeFileSync(linked, '{"revision":1}');
    const api = observeSync('run-api', { root: f.root, runId: 'linked-api' }, [page], () => ({ checkedFiles: [page, linked], summary: { pass: true, passRate: 100, total: 1, passed: 1 }, results: [{ id: 'page', status: 'pass' }] }));
    assert.equal(generateReport({ api, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'passed');
    fs.writeFileSync(linked, '{"revision":2}');
    assert.equal(taskStatus({ root: f.root, runId: 'linked-api' }).stale, true);
    assert.equal(generateReport({ api, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'partial', 'linked checked contracts outside the main target invalidate reports');
    const business = path.join(f.root, 'business.js'); fs.writeFileSync(business, 'export const changed = true;');
    planTask({ task: '修复业务', root: f.root, runId: 'first', context: { files: [business] } });
    assert.ok(taskStatus({ root: f.root, runId: 'first' }).scopeGaps.some(gap => gap.path === 'business.js'));
    assert.equal(generateReport({ audit: newest, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'partial');
    planTask({ task: '对接口进行模糊测试', root: f.root, runId: 'first' });
    assert.equal(taskStatus({ root: f.root, runId: 'first' }).unresolvedDecision, true);
    assert.equal(generateReport({ audit: newest, projectRoot: f.root, strictCorrelation: true }).validationStatus, 'partial');
  } finally { f.dispose(); }
});
test('CLI: audit and report use the task run, while absent API facts produce a failed attempt receipt', () => {
  const f = fixture();
  try {
    const file = goodFile(f.root);
    const task = JSON.parse(cli(f.root, ['task', '通用测试规则', '--run-id', 'cli-run', '--json']).stdout);
    assert.equal(task.runId, 'cli-run');
    const checked = cli(f.root, ['audit', '--target', file, '--run-id', task.runId]);
    assert.equal(checked.status, 0, checked.stderr + checked.stdout); assert.match(checked.stdout, /执行=completed 验证=passed/);
    assert.equal(JSON.parse(cli(f.root, ['status', '--run-id', task.runId, '--json']).stdout).validationStatus, 'passed');
    const report = cli(f.root, ['report', '--run-id', task.runId]); assert.equal(report.status, 0, report.stderr);
    const page = path.join(f.root, 'page-spec.json'); fs.writeFileSync(page, JSON.stringify({ pageName: 'Orders', pageType: 'crud', route: '/orders', table: { columns: [] } }));
    const missingApi = cli(f.root, ['run-api', '--contract', page, '--run-id', 'api-unresolved']);
    assert.equal(missingApi.status, 1);
    const status = taskStatus({ root: f.root, runId: 'api-unresolved' });
    assert.equal(status.executionStatus, 'failed'); assert.equal(status.validationStatus, 'unverified');
  } finally { f.dispose(); }
});

test('route evals run the actual router including negative, ambiguous, gap and contextual cases', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'files/.github/skills/_route-evals.test.json'), 'utf8'));
  for (const item of cases) {
    const result = routeTask(item.phrase, { installed: false, context: item.context || {} });
    assert.equal(result.status, item.status || 'matched', item.phrase);
    assert.deepEqual(result.selectedSkills, item.skill ? [item.skill.split('/').at(-1)] : [], item.phrase);
  }
});
test('native gateway is concise with valid quoted frontmatter and project-relative canonical references', () => {
  const body = fs.readFileSync(path.join(PKG_ROOT, 'files/.agents/skills/wl-skills-test/SKILL.md'), 'utf8');
  assert.match(body, /^---\nname: wl-skills-test\ndescription: "/);
  const description = JSON.parse(body.split('\n')[2].slice('description: '.length));
  assert.ok(description.includes('For ordinary code changes'));
  assert.ok(Buffer.byteLength(body) < 4096);
  assert.ok(body.includes('.github/skills/') && body.includes('.github/standards/'));
});
