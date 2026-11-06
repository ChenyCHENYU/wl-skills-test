import path from 'node:path';
import protocol from '../../task-observability.cjs';
import projectScope from '../../project-scope.cjs';
import { PKG } from '../context.js';
import { routeTask } from '../../task-routing.js';
import { inspectHost, inspectHostReport, inspectInstallation } from '../../host-diagnostics.js';
import { taskOptions } from '../../observed-execution.js';

export function taskInput(parsed) {
  const opts = parsed.opts || {};
  const task = typeof opts.task === 'string' ? opts.task : (parsed.positional || []).join(' ');
  const files = Array.isArray(opts.files) ? opts.files : typeof opts.files === 'string' ? opts.files.split(',').map(p => p.trim()).filter(Boolean) : [];
  return { task, root: opts.root || process.cwd(), skill: opts.skill, context: { files, domain: opts.domain } };
}
export function planTask(input, persist = true, assertProjectRoot) {
  const resolved = projectScope.resolveScope({ projectRoot: input.root || process.cwd(), packageName: PKG.name, targets: input.context?.files || [] });
  assertProjectRoot?.(resolved.projectRoot);
  input = { ...input, root: resolved.projectRoot, context: { ...input.context, files: resolved.targets } };
  if (resolved.scope.status !== 'applicable') return protocol.attachNotice(projectScope.excludedDecision(resolved.scope), taskOptions({ root: input.root }));
  const decision = routeTask(input.task, input);
  decision.scope = resolved.scope;
  if (!persist) return protocol.attachNotice(decision, taskOptions({ root: input.root }));
  return protocol.startTask({ ...taskOptions({ root: input.root, runId: input.runId }, (input.context?.files || []).map(p => path.resolve(input.root || process.cwd(), p))), task: input.task, decision });
}
export function cmdTask(parsed, persist = true) {
  try {
    const input = { ...taskInput(parsed), runId: parsed.opts['run-id'] };
    const result = planTask(input, persist);
    console.log(parsed.opts.json === true ? JSON.stringify(result, null, 2) : protocol.formatDecision(result));
    if (parsed.opts.json !== true) {
      const decision = result.decision || result;
      for (const constraint of decision.constraints || []) console.log(`  约束: ${constraint}`);
      for (const gap of decision.gaps || []) console.log(`  gap: ${gap.reason || decision.reason}；建议: ${gap.suggestion}`);
      if (decision.question) console.log(`  待明确: ${decision.question}`);
    }
    return result;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
export function taskStatus(opts = {}) {
  const options = taskOptions(opts);
  const status = protocol.readStatus(options);
  return { ...status, constraintsFresh: status.decision ? !status.planStale : null,
    installation: inspectInstallation(options.projectRoot), gapSuggestions: protocol.listGaps(options) };
}
export function cmdStatus(parsed) {
  try {
    const result = taskStatus(parsed.opts);
    console.log(parsed.opts.json === true ? JSON.stringify(result, null, 2) : protocol.formatStatus(result));
    return result;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
export function hostDiagnostic(opts = {}) {
  const report = inspectHostReport(opts.root, opts.host);
  const installation = inspectInstallation(report.projectRoot);
  return { ...report, installation, details: inspectHost(report.projectRoot, report.host, report), compliance: 'unverified' };
}
export function cmdDoctorHost(parsed) {
  try {
    const result = hostDiagnostic(parsed.opts);
    console.log(parsed.opts.json === true ? JSON.stringify(result, null, 2) : protocol.formatHostDiagnostic(result));
    if (result.entryReadiness !== 'ready' || result.installation.integrity !== 'verified') process.exitCode = 1;
    return result;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
