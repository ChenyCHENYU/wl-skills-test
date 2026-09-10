/**
 * cli/commands/quality.js — audit / fix / e2e-check / gate
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { join } from "node:path";
import { audit, autoFix } from "../../test-audit.js";
import { e2eCheck } from "../../e2e-check.js";
import { runGate } from "../../gate.js";
import { appendHistory, renderAuditReport } from "../../report-dimensions.js";
import { computePlanHash } from "../../plan-hash.js";
import { confirmAndWrite } from "../../write-guard.js";
import { resolveReportsDir } from "../context.js";
import { pushWebhook } from "../webhook.js";

export function cmdAudit(parsed) {
  const target = parsed.opts.target || parsed.positional[0] || ".";
  console.log(`\n[audit] 审计测试代码: ${target}\n`);

  const result = audit(target);
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`规则 T1-T12，扫描结果：\n`);
  console.log(`  致命(fatal):   ${result.bySeverity.fatal}`);
  console.log(`  错误(error):   ${result.bySeverity.error}`);
  console.log(`  警告(warning): ${result.bySeverity.warning}`);
  console.log(`  总计:          ${result.total}\n`);

  if (result.findings.length > 0) {
    console.log("问题明细：\n");
    for (const f of result.findings) {
      const icon = f.severity === "fatal" ? "🔴" : f.severity === "error" ? "❌" : "⚠️";
      console.log(`  ${icon} [${f.rule}] ${f.file.replace(process.cwd(), ".")}: ${f.message}`);
    }
  }

  console.log(`\n${result.pass ? "✅" : "⚠️"} 审计${result.pass ? "通过" : "未通过"}（${result.level}）`);

  const fmt = parsed.opts.format || parsed.opts.f;
  const reportsDir = resolveReportsDir(parsed.opts);
  mkdirSync(reportsDir, { recursive: true });
  const auditMd = join(reportsDir, "audit-报告.md");
  fsWriteFileSync(auditMd, renderAuditReport(result, target), "utf-8");
  const auditJson = join(reportsDir, "audit-result.json");
  fsWriteFileSync(auditJson, JSON.stringify(result, null, 2), "utf-8");
  appendHistory(reportsDir, { kind: "audit", pass: result.pass, level: result.level, file: auditMd });
  console.log(`审计维度报告已写入: ${auditMd}`);
  if (fmt === "json") {
    console.log(`JSON 结果: ${auditJson}`);
  }
  console.log();

  // CI 卡门：审计不通过时非零退出（fatal/error 存在即阻断）
  if (!result.pass) {
    process.exitCode = 1;
  }
}

export function cmdFix(parsed) {
  const target = parsed.opts.target || parsed.positional[0] || ".";
  const dryRun = parsed.opts["dry-run"] === true;

  console.log(`\n[fix] ${dryRun ? "[预览] " : ""}修复测试代码反模式: ${target}\n`);

  if (!existsSync(target)) {
    console.error(`❌ 路径不存在: ${target}\n`);
    process.exitCode = 1;
    return;
  }

  const files = collectFixFiles(target);

  let fixed = 0;
  let total = 0;
  const pendingWrites = [];
  for (const file of files) {
    const result = autoFix(file);
    total++;
    if (result.changed && result.fixes.length > 0) {
      fixed++;
      console.log(`  ✓ ${file.replace(process.cwd(), ".")}: ${result.fixes.map((f) => f.desc).join(", ")}`);
      if (!dryRun) {
        pendingWrites.push({ target: file, content: result.content });
      }
    }
  }

  // 实际写入走 write-guard 安全链（哈希确认 + 字节级备份回滚）——
  // 此前直接 writeFileSync，写坏多个文件中途失败会留下半完成状态且无法恢复
  if (pendingWrites.length > 0) {
    const planHash = computePlanHash(pendingWrites);
    const writeResult = confirmAndWrite(pendingWrites, planHash);
    if (!writeResult.success) {
      console.error(`❌ 写入失败已回滚: ${JSON.stringify(writeResult.errors)}${writeResult.rollbackErrors?.length ? ` 回滚失败: ${JSON.stringify(writeResult.rollbackErrors)}` : ""}\n`);
      process.exitCode = 1;
      return;
    }
    // 修复闭环：对修改过的文件 re-audit，确认违规消除（此前修完是死胡同）
    let remainingFatal = 0;
    let remainingError = 0;
    for (const w of pendingWrites) {
      const recheck = audit(w.target);
      remainingFatal += recheck.bySeverity?.fatal ?? 0;
      remainingError += recheck.bySeverity?.error ?? 0;
    }
    console.log(`\n复验（修复后 re-audit 修改文件）: 剩余致命 ${remainingFatal} / 错误 ${remainingError}`);
    if (remainingFatal > 0 || remainingError > 0) {
      console.log(`自动修复覆盖有限（F1-F6），剩余违规需人工处理（明细: wl-skills-test audit --target ${target}）`);
    }
  }

  console.log(`\n${dryRun ? "[预览] " : ""}${fixed}/${total} 个文件${dryRun ? "待" : "已"}修复。\n`);
}

// 与 MCP wls_test_fix 共用的文件收集（跳过 node_modules/点目录，仅 .js/.ts）
export function collectFixFiles(target) {
  const stat = statSync(target);
  const files = [];
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        const s = statSync(full);
        if (s.isDirectory() && !e.startsWith("node_modules") && !e.startsWith(".")) {
          walk(full);
        } else if (s.isFile() && (e.endsWith(".js") || e.endsWith(".ts"))) {
          files.push(full);
        }
      }
    };
    walk(target);
  } else {
    files.push(target);
  }
  return files;
}

export async function cmdE2eCheck(parsed) {
  const target = parsed.opts.target || "./e2e";

  const result = await e2eCheck(target);
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[e2e-check] E2E 工程强校验 — ${target}（${result.totalSpecs} 个 spec）\n`);
  for (const c of result.checks) {
    console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}: ${c.detail}`);
  }

  if (result.findings.length > 0) {
    console.log(`\n违规明细（${result.findings.length}）:\n`);
    for (const f of result.findings) {
      console.log(`  ${f.severity === "fatal" ? "🔴" : f.severity === "error" ? "❌" : "⚠️"} [${f.severity}] ${f.file}: ${f.message}`);
    }
  }

  console.log(`\n结论: ${result.pass ? "✅ 通过" : "❌ 未通过"}\n`);
  if (!result.pass) {
    process.exitCode = 1;
  }
}

export async function cmdGate(parsed) {
  const { opts } = parsed;

  if (!opts["audit-dir"] && !opts["e2e-dir"] && !opts["smoke-result"] && !opts.defects && !opts["perf-current"]) {
    console.log(`
用法: wl-skills-test gate [检查项...]

一条命令聚合全部质量门（提供哪项查哪项，任一失败 exit 1）:
  --audit-dir <目录>        测试代码审计（T1-T25，fatal/error=0）
  --e2e-dir <目录>          E2E 工程强校验（归属闭环/安全标记/隔离声明）
  --smoke-result <json>     冒烟通过率 ≥95%（run-api --json 产物）
  --defects <json> --cases <N>  DI 质量门（密度/致命严重关闭/模块收敛）
  --perf-current <jtl> --perf-baseline <jtl> [--perf-threshold 15]  性能基线
  --webhook <url> [--webhook-type wecom|dingtalk|raw]  结论推送

示例:
  wl-skills-test gate --audit-dir ./tests --e2e-dir ./e2e --smoke-result smoke.json --defects defects.json --cases 150
`);
    process.exitCode = 2; // 用法错误（未提供任何检查项）
    return;
  }

  const result = await runGate({
    auditDir: opts["audit-dir"],
    e2eDir: opts["e2e-dir"],
    smokeResult: opts["smoke-result"],
    defects: opts.defects,
    cases: opts.cases !== undefined ? parseInt(opts.cases, 10) || 50 : 50,
    perfCurrent: opts["perf-current"],
    perfBaseline: opts["perf-baseline"],
    perfThreshold: opts["perf-threshold"] !== undefined ? parseFloat(opts["perf-threshold"]) : 15,
  });

  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n===== 质量门（聚合）=====\n`);
  if (result.inputErrors?.length) {
    for (const e of result.inputErrors) console.error(`  ✗ 输入错误: ${e}`);
    console.error("\n❌ 输入无效，阻断（fail-closed）\n");
    process.exitCode = 1;
    return;
  }
  for (const c of result.checks) {
    console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  console.log(`\n${result.summary.verdict}（${result.summary.passed}/${result.summary.total} 通过）\n`);
  appendHistory(resolveReportsDir(opts), { kind: "gate", pass: result.pass, failed: result.summary.failed });

  // webhook 推送（失败仅告警，不改变门禁结论）
  if (opts.webhook) {
    try {
      const pushed = await pushWebhook(opts.webhook, opts["webhook-type"] || "wecom", result.summary.verdict, result.checks);
      console.log(pushed.ok ? `webhook 已推送: ${pushed.status}` : `webhook 推送失败: ${pushed.detail}`);
    } catch (e) {
      console.log(`webhook 推送异常: ${e.message}`);
    }
  }

  if (!result.pass) process.exitCode = 1;
}
