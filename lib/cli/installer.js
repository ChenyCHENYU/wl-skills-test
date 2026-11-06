/** Project installation is planned before writing and records ownership per unit. */
import { createInstallPlan, createCleanPlan, applyInstallPlan } from './install-state.js';
import { PKG, PKG_ROOT } from './context.js';
import { join } from 'node:path';

export function cmdInit(parsed) {
  const opts = parsed.opts || {};
  if (opts.mcp !== undefined && opts['no-mcp'] !== undefined) throw new Error('--mcp 与 --no-mcp 不可同时使用');
  if (opts['no-mcp'] !== undefined && typeof opts['no-mcp'] !== 'boolean') throw new Error('--no-mcp 必须是布尔选项');
  return execute(createInstallPlan(process.cwd(), {
    filesDir: join(PKG_ROOT, 'files'), version: PKG.version, force: opts.force === true, hosts: opts.hosts, editor: opts.editor, integration: opts.integration, mcp: opts['no-mcp'] === true ? false : opts.mcp,
  }), opts['dry-run'] === true, opts.incremental ? '更新' : '安装');
}
export function cmdClean(parsed) {
  return execute(createCleanPlan(process.cwd()), parsed.opts?.['dry-run'] === true, '清理');
}
function execute(plan, dryRun, action) {
  console.log(`\n${dryRun ? '[预览] ' : ''}${action} ${PKG.name} v${PKG.version}`);
  for (const item of plan.conflicts) console.log(`  已保留: ${item.path}（${item.reason}）`);
  for (const item of plan.mcpDiagnostics || []) console.log(`  MCP: ${item.message || item.reason || JSON.stringify(item)}`);
  console.log(`计划变更 ${plan.operations.length} 项，保留 ${plan.conflicts.length} 项。`);
  if (plan.conflicts.length && action !== '清理') {
    throw new Error('安装计划存在冲突，未写入任何文件。请先合并；--force 仅可更新本包已登记的单元。');
  }
  if (!dryRun) applyInstallPlan(plan);
  console.log(dryRun ? '[预览模式] 未实际写入。' : `完成：${plan.operations.length} 项变更。`);
  return { changed: plan.operations.length, preserved: plan.conflicts.length, dryRun };
}
