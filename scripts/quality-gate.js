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
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readJsonFile } from "../lib/shared/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const caseCount = typeof opts.cases === "string" ? parseInt(opts.cases, 10) : 50;

// ── 收集所有检查结果 ──────────────────────────────
const allChecks = [];
const inputErrors = [];

// ── 1. DI 缺陷指数检查（复用 calculateDI 单一实现，含模块收敛）──
if (defectsArg) {
  if (!existsSync(defectsArg)) {
    inputErrors.push(`缺陷文件不存在: ${defectsArg}`);
  } else {
    const { data: defects, error } = readJsonFile(defectsArg);
    if (error) {
      inputErrors.push(`缺陷 JSON 解析失败: ${error}`);
    } else if (!Array.isArray(defects)) {
      inputErrors.push("缺陷文件必须是 JSON 数组: [{ severity, status, module }, ...]");
    } else {
      const auditModuleUrl = pathToFileURL(resolve(__dirname, "../lib/test-codegen.js")).href;
      const { calculateDI } = await import(auditModuleUrl);
      const di = calculateDI(defects, caseCount);
      const mc = di.releaseChecks.moduleConvergence;
      allChecks.push(
        {
          name: "DI 密度 < 0.3",
          pass: di.releaseChecks.diDensity.pass,
          detail: `DI=${di.di.toFixed(1)}, 密度=${di.diDensity.toFixed(3)}`,
        },
        {
          name: "致命缺陷全部关闭",
          pass: di.releaseChecks.fatalClosed.pass,
          detail: `未关闭: ${defects.filter((d) => d.severity === "fatal" && d.status !== "closed").length}`,
        },
        {
          name: "严重缺陷全部关闭",
          pass: di.releaseChecks.criticalClosed.pass,
          detail: `未关闭: ${defects.filter((d) => d.severity === "critical" && d.status !== "closed").length}`,
        },
        {
          name: "最差模块 DI 收敛 ≤20%",
          pass: mc.pass,
          detail: mc.worstModule ? `最差: ${mc.worstModule.module} (DI=${mc.worstModule.di.toFixed(1)})` : "无模块数据",
        },
      );
    }
  }
}

// ── 2. 测试代码审计检查 ──────────────────────────
if (auditArg) {
  if (!existsSync(auditArg)) {
    // fail-closed：指定了审计目录但目录无效时必须报错，而不是静默跳过
    inputErrors.push(`审计目录不存在: ${auditArg}`);
  } else {
    // 以脚本自身位置为基准解析审计引擎（兼容从任意 cwd 调用 / Windows 盘符路径）
    const auditModuleUrl = pathToFileURL(resolve(__dirname, "../lib/test-audit.js")).href;
    const { audit } = await import(auditModuleUrl);
    const result = audit(auditArg);
    if (result.error) {
      inputErrors.push(`审计失败: ${result.error}`);
    } else {
      allChecks.push({
        name: "测试代码审计（fatal=0）",
        pass: result.bySeverity.fatal === 0,
        detail: `fatal=${result.bySeverity.fatal}, error=${result.bySeverity.error}, warning=${result.bySeverity.warning}`,
      });
      allChecks.push({
        name: "测试代码审计（error=0）",
        pass: result.bySeverity.error === 0,
        detail: `T 规则违规 ${result.total} 项`,
      });
    }
  }
}

// ── 3. 冒烟通过率检查（如果提供冒烟结果）─────────────
if (smokeArg) {
  if (!existsSync(smokeArg)) {
    inputErrors.push(`冒烟结果文件不存在: ${smokeArg}`);
  } else {
    const { data: smoke, error } = readJsonFile(smokeArg);
    if (error) {
      inputErrors.push(`冒烟结果 JSON 解析失败: ${error}`);
    } else if (typeof smoke?.passRate !== "number") {
      inputErrors.push("冒烟结果 JSON 必须包含数值字段 passRate（可由 run-api --json 输出）");
    } else {
      allChecks.push({
        name: "冒烟通过率 ≥ 95%",
        pass: smoke.passRate >= 95,
        detail: `通过率: ${smoke.passRate}%`,
      });
    }
  }
}

// ── 汇总判定 ────────────────────────────────────
console.log("\n===== 质量门 CI 检查 =====\n");

if (inputErrors.length > 0) {
  for (const e of inputErrors) console.error(`  ✗ 输入错误: ${e}`);
  console.error("\n❌ 质量门输入无效，阻断上线（fail-closed）\n");
  process.exit(1);
}

if (allChecks.length === 0) {
  console.log("未提供任何检查参数。");
  console.log("用法: quality-gate.js --defects <缺陷JSON> --cases <N> [--audit-dir <目录>] [--smoke-result <冒烟结果>]");
  process.exit(1);
}

let allPass = true;
for (const c of allChecks) {
  console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  if (!c.pass) allPass = false;
}

console.log(`\n${allPass ? "✅ 质量门通过，允许上线" : "❌ 质量门未通过，阻断上线"}\n`);
process.exit(allPass ? 0 : 1);
