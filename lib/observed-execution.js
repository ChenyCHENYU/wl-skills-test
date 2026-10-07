import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import protocol from './task-observability.cjs';
import { PKG } from './cli/context.js';

export function taskOptions(opts = {}, targets = []) {
  const inputRoot = path.resolve(opts.root || process.cwd());
  const projectRoot = realpathSync(inputRoot);
  return {
    projectRoot, packageName: PKG.name, packageVersion: PKG.version, storageDir: '.wl-skills-test/runs',
    runId: opts['run-id'] || opts.runId || undefined,
    targets: targets.filter(p => typeof p === 'string' && p).map(p => path.resolve(projectRoot, path.relative(inputRoot, path.resolve(p)))),
  };
}
export function domainResultHash(value) {
  const raw = { ...value };
  for (const key of ['runId', 'provenance', 'execution', 'correlatedResultFile', 'resultFile']) delete raw[key];
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}
const state = pass => pass ? 'passed' : 'failed';
export function executionSummary(tool, result = {}) {
  if (result.error || result.inputErrors?.length) return { exitCode: 1, validationStatus: 'unverified', checks: [], errorCode: 'INVALID_OR_UNAVAILABLE_INPUT', summary: { error: result.error || '输入无效' } };
  let checks = [], pass;
  if (tool === 'audit') {
    checks = [...(result.executedChecks || [])];
    pass = result.pass;
    if (checks.length) checks.push({ id: 'test-code-audit', status: state(pass), reason: '已执行适用 T 规则；不代表业务测试通过。' });
  } else if (tool === 'run-api') {
    const s = result.summary || {};
    checks = (result.results || []).map(r => ({ id: `api:${r.id || r.name}`, status: r.status === 'error' ? 'failed' : r.status === 'warn' ? 'unverified' : r.status, reason: r.reason }));
    pass = s.pass;
    if (typeof pass !== 'boolean') pass = (s.failed || 0) + (s.errors || 0) === 0 && (s.passed || 0) > 0;
    if (checks.some(c => c.status === 'pass' || c.status === 'fail')) checks.push({ id: 'api-assertions', status: state(pass) });
  } else if (tool === 'run-playwright') {
    pass = result.pass;
    if ((result.passed || 0) + (result.failed || 0) > 0) checks.push({ id: 'changed-behavior-tests', status: state(pass), reason: `passed=${result.passed || 0}, failed=${result.failed || 0}` });
    if (result.skipped > 0) checks.push({ id: 'playwright-skipped', status: 'skipped', reason: `${result.skipped} 个相关用例未执行。` });
    if (result.flaky > 0) checks.push({ id: 'playwright-flaky', status: 'unverified', reason: `${result.flaky} 个不稳定用例。` });
  } else if (tool === 'run-jmeter') {
    pass = result.pass;
    if (result.samples > 0) checks.push({ id: 'performance-samples', status: state(pass), reason: `samples=${result.samples}, errorRate=${result.errorRate}` });
  } else {
    pass = result.pass;
    checks = (result.checks || []).map(c => ({ id: c.id || c.name, status: typeof c.pass === 'boolean' ? state(c.pass) : 'unverified', reason: c.detail }));
    if (checks.length && tool === 'gate') checks.push({ id: 'quality-gate', status: state(pass) });
    if (checks.length && tool === 'e2e-check') checks.push({ id: 'e2e-integrity', status: state(pass) });
  }
  // The checker can complete successfully while its assertions fail.
  return { exitCode: 0, validationStatus: checks.length ? (pass === true ? 'passed' : pass === false ? 'failed' : 'unverified') : 'unverified', checks,
    summary: { pass: typeof pass === 'boolean' ? pass : null, checks: checks.length } };
}
function executionOptions(opts, targets) {
  const options = taskOptions(opts, targets);
  options.runId ||= process.env.WL_TASK_RUN_ID;
  if (options.runId) {
    const status = protocol.readStatus(options);
    const required = status.decision?.requiredFiles || [];
    options.ruleFiles = required.filter(relative => relative.endsWith(".md"));
    options.configFiles = required.filter(relative => relative.endsWith(".json"));
    options.targets = [...new Set([...options.targets, ...required.map(relative => path.resolve(options.projectRoot, relative))])];
  }
  if (existsSync(path.join(options.projectRoot, "wl-test.config.json"))) options.configFiles = [...new Set([...(options.configFiles || []), "wl-test.config.json"])];
  return options;
}
function finish(handle, tool, opts, result) {
  const attributes = executionSummary(tool, result);
  if (!result.error && !result.inputErrors?.length) {
    if (tool === 'audit') attributes.checkedFiles = [...new Set((result.executedChecks || []).flatMap(check => check.evidencePaths || []))];
    else if (Array.isArray(result.checkedFiles)) attributes.checkedFiles = result.checkedFiles;
  }
  attributes.summary = { ...attributes.summary, resultHash: domainResultHash(result) };
  const receipt = protocol.finishExecution(handle, attributes);
  result.runId = receipt.runId;
  result.provenance = { packageName: PKG.name, packageVersion: PKG.version, tool, runId: receipt.runId,
    sourceHash: receipt.inputSnapshot.sha256, sources: receipt.inputSnapshot.files, snapshotComplete: receipt.inputSnapshot.complete };
  result.execution = { executionStatus: receipt.executionStatus, validationStatus: receipt.validationStatus, recordPath: receipt.recordPath };
  const dimensions = { 'run-api': 'api', 'run-playwright': 'playwright', 'run-jmeter': 'perf', audit: 'audit', gate: 'gate', 'e2e-check': 'e2e-check' };
  if (dimensions[tool]) {
    const directory = path.resolve(opts['reports-dir'] || opts.reportsDir || path.join(handle.options.projectRoot, 'test-reports'), 'runs', receipt.runId);
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${dimensions[tool]}-result.json`);
    const payload = tool === 'run-jmeter' ? { runId: result.runId, provenance: result.provenance, execution: result.execution, summary: result } : result;
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    result.correlatedResultFile = file;
  }
  return result;
}
export function observeSync(tool, opts, targets, fn) {
  const handle = protocol.beginExecution({ ...executionOptions(opts, targets), tool, readOnlyVerification: true });
  try { return finish(handle, tool, opts, fn()); }
  catch (error) { protocol.finishExecution(handle, { exitCode: 1, validationStatus: 'unverified', errorCode: error.code || error.name }); throw error; }
}
export async function observe(tool, opts, targets, fn) {
  const handle = protocol.beginExecution({ ...executionOptions(opts, targets), tool, readOnlyVerification: true });
  try { return finish(handle, tool, opts, await fn()); }
  catch (error) { protocol.finishExecution(handle, { exitCode: 1, validationStatus: 'unverified', errorCode: error.code || error.name }); throw error; }
}

export function printExecution(result) {
  if (result?.execution) console.log(`[WL 执行=${result.execution.executionStatus} 验证=${result.execution.validationStatus}] runId=${result.runId}；回执=${result.execution.recordPath}`);
}
