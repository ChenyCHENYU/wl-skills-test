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
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ── 1. DI 缺陷指数检查 ──────────────────────────
if (defectsArg) {
  if (!existsSync(defectsArg)) {
    inputErrors.push(`缺陷文件不存在: ${defectsArg}`);
  } else {
    let defects;
    try {
      defects = JSON.parse(readFileSync(defectsArg, "utf-8"));
    } catch (e) {
      inputErrors.push(`缺陷 JSON 解析失败: ${e.message}`);
    }
    if (defects !== undefined && !Array.isArray(defects)) {
      inputErrors.push("缺陷文件必须是 JSON 数组: [{ severity, status, module }, ...]");
    }

    if (Array.isArray(defects)) {
      const weights = { fatal: 10, critical: 3, general: 1, minor: 0.1 };
      const counts = { fatal: 0, critical: 0, general: 0, minor: 0 };
      const byModule = {};

      for (const d of defects) {
        if (counts[d.severity] !== undefined) counts[d.severity]++;
        const mod = d.module || "_unknown";
        if (!byModule[mod]) byModule[mod] = { fatal: 0, critical: 0, general: 0, minor: 0, di: 0 };
        if (byModule[mod][d.severity] !== undefined) byModule[mod][d.severity]++;
      }

      const di = counts.fatal * 10 + counts.critical * 3 + counts.general * 1 + counts.minor * 0.1;
      const diDensity = caseCount > 0 ? di / caseCount : di;

      for (const [mod, c] of Object.entries(byModule)) {
        c.di = c.fatal * 10 + c.critical * 3 + c.general * 1 + c.minor * 0.1;
      }

      const openCritical = defects.filter((d) => d.severity === "critical" && d.status !== "closed").length;
      const openFatal = defects.filter((d) => d.severity === "fatal" && d.status !== "closed").length;

      allChecks.push(
        {
          name: "DI 密度 < 0.3",
          pass: diDensity < 0.3,
          detail: `DI=${di.toFixed(1)}, 密度=${diDensity.toFixed(3)}`,
        },
        {
          name: "致命缺陷全部关闭",
          pass: openFatal === 0,
          detail: `未关闭: ${openFatal}`,
        },
        {
          name: "严重缺陷全部关闭",
          pass: openCritical === 0,
          detail: `未关闭: ${openCritical}`,
        },
        {
          name: "最差模块 DI 收敛 ≤20%",
          pass: checkModuleConvergence(byModule, di),
          detail: getWorstModule(byModule),
        },
      );
      void weights;
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
    try {
      const smoke = JSON.parse(readFileSync(smokeArg, "utf-8"));
      if (typeof smoke.passRate !== "number") {
        inputErrors.push("冒烟结果 JSON 必须包含数值字段 passRate（可由 run-api --json 输出）");
      } else {
        allChecks.push({
          name: "冒烟通过率 ≥ 95%",
          pass: smoke.passRate >= 95,
          detail: `通过率: ${smoke.passRate}%`,
        });
      }
    } catch (e) {
      inputErrors.push(`冒烟结果 JSON 解析失败: ${e.message}`);
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

// ── 辅助函数 ────────────────────────────────────
function checkModuleConvergence(byModule, totalDI) {
  if (Object.keys(byModule).length === 0 || totalDI === 0) return true;
  const maxModuleDI = Math.max(...Object.values(byModule).map((m) => m.di));
  return maxModuleDI / totalDI <= 0.2 || maxModuleDI <= 3;
}

function getWorstModule(byModule) {
  if (Object.keys(byModule).length === 0) return "无模块数据";
  const worst = Object.entries(byModule).sort((a, b) => b[1].di - a[1].di)[0];
  return `最差: ${worst[0]} (DI=${worst[1].di.toFixed(1)})`;
}
