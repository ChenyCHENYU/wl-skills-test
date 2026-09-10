/**
 * cli/commands/diff.js — 契约变更影响面（wl-skills-test diff --old a.json --new b.json）
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { diffContracts } from "../../contract-diff.js";
import { writeTextFile } from "../../shared/utils.js";
import { resolveReportsDir } from "../context.js";

export function cmdDiff(parsed) {
  const { opts } = parsed;
  const oldPath = opts.old || opts.oldContract;
  const newPath = opts.new || opts.newContract;

  if (!oldPath || !newPath) {
    console.log(`
用法: wl-skills-test diff --old <旧契约.json> --new <新契约.json> [--output <报告.md>]

契约变更影响面分析：
  - 操作级/字段级/传输层变更明细（新增/删除/变更）
  - 用例影响：新增用例、作废用例、变更字段关联需重跑的细粒度用例（内容哈希稳定 ID 精确到条）
  - 产出 Markdown 报告（默认 test-reports/契约变更影响面.md）

示例:
  wl-skills-test diff --old wl-contract.v1.json --new wl-contract.v2.json
`);
    process.exitCode = 2;
    return;
  }
  for (const p of [oldPath, newPath]) {
    if (!existsSync(p)) {
      console.error(`❌ 契约文件不存在: ${p}\n`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n[diff] 契约变更影响面: ${oldPath} → ${newPath}\n`);
  const result = diffContracts(oldPath, newPath);

  const icon = { added: "➕", removed: "➖", changed: "✏️" };
  for (const c of result.changes.slice(0, 30)) {
    console.log(`  ${icon[c.type]} [${c.level}] ${c.target}: ${c.detail}`);
  }
  if (result.changes.length > 30) console.log(`  … 共 ${result.changes.length} 项`);
  if (result.changes.length === 0) console.log("  无差异");

  const a = result.affected;
  console.log(`\n用例影响: 新增 ${a.addedCases.length} / 作废 ${a.removedCases.length} / 需重跑 ${a.rerunCases.length}`);
  if (a.changedFields.length > 0) console.log(`变更字段: ${a.changedFields.join(", ")}`);
  console.log(`建议: 重跑 run-api --contract <新契约>（变更字段的负例/读回/并发链路自动覆盖）\n`);

  const reportsDir = resolveReportsDir(opts);
  const output = opts.output || join(reportsDir, "契约变更影响面.md");
  writeTextFile(output, result.markdown);
  console.log(`报告已写入: ${output}`);
  // 结构化产物（v0.24.0 JSON 化）
  if (opts.json) {
    writeTextFile(opts.json, JSON.stringify({ entity: result.entity, changes: result.changes, affected: result.affected, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`JSON 结果已写入: ${opts.json}`);
  }
  console.log();
}
