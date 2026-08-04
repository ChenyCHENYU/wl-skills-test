/**
 * DI 质量门 CI 集成脚本（增强版 v0.5.0）
 *
 * 用法:
 *   node scripts/quality-gate.js --defects <缺陷JSON> --cases <用例数>
 *   node scripts/quality-gate.js --audit-dir ./tests/         # 审计测试代码
 *   node scripts/quality-gate.js --defects <缺陷JSON> --cases <N> --audit-dir ./tests/
 *
 * 退出码: 0=通过, 1=阻断
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);

const defectsArg = args.find((a) => a.startsWith("--defects"));
const casesArg = args.find((a) => a.startsWith("--cases"));
const auditArg = args.find((a) => a.startsWith("--audit-dir"));

// ── 收集所有检查结果 ──────────────────────────────
const allChecks = [];

// ── 1. DI 缺陷指数检查 ──────────────────────────
if (defectsArg) {
  const defectsPath = defectsArg.split("=")[1] || defectsArg;
  const caseCount = casesArg ? parseInt(casesArg.split("=")[1] || casesArg) : 50;

  if (!existsSync(defectsPath)) {
    console.error(`缺陷文件不存在: ${defectsPath}`);
    process.exit(1);
  }

  const defects = JSON.parse(readFileSync(defectsPath, "utf-8"));

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

  // 计算各模块 DI
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
}

// ── 2. 测试代码审计检查 ──────────────────────────
if (auditArg) {
  const auditDir = auditArg.split("=")[1] || auditArg;
  if (existsSync(auditDir)) {
    const { audit } = await import(resolve(process.cwd(), "lib/test-audit.js"));
    const result = audit(auditDir);
    if (!result.error) {
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
const smokeArg = args.find((a) => a.startsWith("--smoke-result"));
if (smokeArg) {
  const smokePath = smokeArg.split("=")[1] || smokeArg;
  if (existsSync(smokePath)) {
    const smoke = JSON.parse(readFileSync(smokePath, "utf-8"));
    allChecks.push({
      name: "冒烟通过率 ≥ 95%",
      pass: smoke.passRate >= 95,
      detail: `通过率: ${smoke.passRate}%`,
    });
  }
}

// ── 汇总判定 ────────────────────────────────────
console.log("\n===== 质量门 CI 检查 =====\n");

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
