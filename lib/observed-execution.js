import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import protocol from './task-observability.cjs';
import { PKG, PKG_ROOT } from './cli/context.js';

export function taskOptions(opts = {}, targets = []) {
  const inputRoot = path.resolve(opts.root || process.cwd());
  const projectRoot = realpathSync(inputRoot);
  return {
    projectRoot, packageName: PKG.name, packageVersion: PKG.version, storageDir: '.wl-skills/state/test/runs',
    runId: opts['run-id'] || opts.runId || undefined,
    ruleFiles: [path.join(PKG_ROOT, "package.json")],
    configFiles: ["package.json", ".wl-skills/config.json", "wl-test.config.json"].filter(relative => existsSync(path.join(projectRoot, relative))),
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
  if (result.error || result.inputErrors?.length) return { exitCode: 1, validationStatus: 'unverified', checks: [], errorCode: result.errorCode || 'INVALID_OR_UNAVAILABLE_INPUT', summary: { error: result.error || '输入无效' } };
  let checks = [], pass;
  if (tool === 'sit-verify') {
    pass = result.passed;
    checks = (result.checks || []).map((c) => ({ id: `sit:${c.id}`, status: c.status === 'passed' ? 'passed' : 'failed', reason: c.detail }));
    checks.push({ id: 'sit-delivery-checks', status: state(pass), reason: '仅校验交付记录、范围与hash引用，不声称本命令观察业务行为或客户签收。' });
  } else if (tool === 'audit') {
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
    if ((result.passed || 0) + (result.failed || 0) > 0) checks.push({ id: 'changed-behavior-tests', status: result.failed > 0 ? 'failed' : state(pass), reason: `passed=${result.passed || 0}, failed=${result.failed || 0}` });
    if (result.skipped > 0) checks.push({ id: 'playwright-skipped', status: 'skipped', reason: `${result.skipped} 个相关用例未执行。` });
    if (result.flaky > 0) checks.push({ id: 'playwright-flaky', status: 'unverified', reason: `${result.flaky} 个不稳定用例。` });
  } else if (tool === 'run-jmeter') {
    pass = result.pass;
    if (result.samples > 0) checks.push({ id: 'performance-samples', status: state(pass), reason: `samples=${result.samples}, errorRate=${result.errorRate}` });
    else checks.push({ id: 'performance-samples', status: 'unverified', reason: '没有实际采样，不证明压测或SLA通过' });
    if (result.baselineComparison) checks.push({ id: 'performance-baseline', status: result.baselineComparison.error || result.baselineComparison.regressed ? 'failed' : 'passed', reason: result.baselineComparison.error || result.baselineComparison.summary?.verdict || '本轮基线已建立' });
  } else {
    pass = result.pass;
    checks = (result.checks || []).map(c => ({ id: c.id || c.name, status: typeof c.pass === 'boolean' ? state(c.pass) : 'unverified', reason: c.detail }));
    if (checks.length && tool === 'gate') checks.push({ id: 'quality-gate', status: state(pass) });
    if (checks.length && tool === 'e2e-check') checks.push({ id: 'e2e-integrity', status: typeof pass === 'boolean' ? state(pass) : 'unverified' });
  }
  // The checker can complete successfully while its assertions fail.
  if (result.profileSourceChanged === true) checks.push({ id: 'api-profile-freshness', status: 'unverified', reason: '本地档案或凭据来源在运行期间变化；本次请求继续使用启动时档案，重连后再验证' });
  return { exitCode: 0, validationStatus: checks.length ? (pass === true ? 'passed' : pass === false ? 'failed' : 'unverified') : 'unverified', checks,
    summary: { pass: typeof pass === 'boolean' ? pass : null, checks: checks.length,
      ...(tool === 'run-jmeter' && result.jtlSha256 ? { jtlPath: result.jtlPath, jtlSha256: result.jtlSha256 } : {}) } };
}
function executionOptions(opts, targets) {
  const options = taskOptions(opts, targets);
  options.runId ||= process.env.WL_TASK_RUN_ID;
  if (options.runId) {
    const status = protocol.readStatus(options);
    const required = status.decision?.requiredFiles || [];
    options.ruleFiles = [...(options.ruleFiles || []), ...required];
  }
  if (existsSync(path.join(options.projectRoot, "wl-test.config.json"))) options.configFiles = [...new Set([...(options.configFiles || []), "wl-test.config.json"])];
  return options;
}
const reportDimensions = { 'run-api': 'api', 'run-playwright': 'playwright', 'run-jmeter': 'perf', audit: 'audit', gate: 'gate', 'e2e-check': 'e2e-check' };

function reportFile(handle, tool, opts) {
  const dimension = reportDimensions[tool];
  if (dimension) return path.resolve(opts['reports-dir'] || opts.reportsDir || path.join(handle.options.projectRoot, 'test-reports'), 'runs', handle.metadata.runId, `${dimension}-result.json`);
}

function finish(handle, tool, opts, result, reportWriter) {
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
  result.execution = { executionStatus: receipt.executionStatus, validationStatus: receipt.validationStatus, recordPath: receipt.recordPath, receiptId: receipt.eventId };
  const file = reportFile(handle, tool, opts);
  if (file) {
    const payload = tool === 'run-jmeter' ? { runId: result.runId, provenance: result.provenance, execution: result.execution, summary: result } : result;
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    try {
      if (reportWriter) reportWriter(file, content);
      else {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      result.correlatedResultFile = file;
    } catch (error) {
      if (!reportWriter) throw error;
      result.error ||= "执行回执已记录，报告无法安全保存；请用同一 runId 查询实际执行结果";
      result.errorCode ||= "MCP_REPORT_WRITE_FAILED";
    }
  }
  return result;
}
export function observeSync(tool, opts, targets, fn, reportBoundary) {
  const handle = protocol.beginExecution({ ...executionOptions(opts, targets), tool, readOnlyVerification: true });
  try {
    if (reportBoundary) reportBoundary.checkOutputFile(reportFile(handle, tool, opts));
    return finish(handle, tool, opts, fn(), reportBoundary?.writeOutputFile);
  }
  catch (error) { protocol.finishExecution(handle, { exitCode: 1, validationStatus: 'unverified', errorCode: error.code || error.name }); throw error; }
}
export async function observe(tool, opts, targets, fn, reportBoundary) {
  const handle = protocol.beginExecution({ ...executionOptions(opts, targets), tool, readOnlyVerification: true });
  let result;
  try {
    if (reportBoundary) reportBoundary.checkOutputFile(reportFile(handle, tool, opts));
    result = await fn();
  }
  catch (error) { protocol.finishExecution(handle, { exitCode: 1, validationStatus: 'unverified', errorCode: error.code || error.name }); throw error; }
  return finish(handle, tool, opts, result, reportBoundary?.writeOutputFile);
}

export function printExecution(result) {
  if (result?.execution) console.log(`[WL 执行=${result.execution.executionStatus} 验证=${result.execution.validationStatus}] runId=${result.runId}；回执=${result.execution.recordPath}`);
}
