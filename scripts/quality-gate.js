/**
 * DI 质量门 CI 集成脚本（增强版 v0.6.0）
 *
 * 用法:
 *   node scripts/quality-gate.js --defects <缺陷JSON> --cases <用例数>
 *   node scripts/quality-gate.js --audit-dir ./tests/         # 审计测试代码
 *   node scripts/quality-gate.js --smoke-result <冒烟JSON>    # 冒烟通过率卡门
 *   node scripts/quality-gate.js --defects <缺陷JSON> --cases <N> --audit-dir ./tests/
 *
 * 参数风格: --key=value 与 --key value 均支持。
 * 退出码: 0=通过, 1=阻断（含输入无效，fail-closed）
 */
import { runGate } from "../lib/gate.js";

// ── 参数解析（支持 --key=value 与 --key value）────────
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eqIdx = a.indexOf("=");
    if (eqIdx > -1) {
      opts[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[a.slice(2)] = next;
        i++;
      } else {
        opts[a.slice(2)] = true;
      }
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const defectsArg = typeof opts.defects === "string" ? opts.defects : null;
const auditArg = typeof opts["audit-dir"] === "string" ? opts["audit-dir"] : null;
const smokeArg = typeof opts["smoke-result"] === "string" ? opts["smoke-result"] : null;
const caseCount = typeof opts.cases === "string" && opts.cases.trim() ? Number(opts.cases) : opts.cases;

// The standalone CI entry consumes exactly the same evidence checks as CLI/MCP.
console.log("\n===== 质量门 CI 检查 =====\n");
if (!defectsArg && !auditArg && !smokeArg) {
  console.log("未提供任何检查参数。");
  console.log("用法: quality-gate.js --defects <缺陷JSON> --cases <N> [--audit-dir <目录>] [--smoke-result <冒烟结果>]");
  process.exitCode = 1;
} else {
  const result = await runGate({ defects: defectsArg, cases: caseCount, auditDir: auditArg, smokeResult: smokeArg, roundResults: opts["round-results"] });
  if (result.error || result.inputErrors?.length) {
    for (const error of result.inputErrors || [result.error]) console.error(`  ✗ 输入错误: ${error}`);
    console.error("\n❌ 质量门输入无效或未验证，阻断上线（fail-closed）\n");
    process.exitCode = 1;
  } else {
    for (const check of result.checks) console.log(`  ${check.pass ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    console.log(`\n${result.summary.verdict}\n`);
    process.exitCode = result.pass ? 0 : 1;
  }
}
