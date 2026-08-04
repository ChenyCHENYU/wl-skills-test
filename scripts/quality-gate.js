/**
 * DI 质量门 CI 集成脚本
 * 用法: node scripts/quality-gate.js --defects <缺陷JSON> --cases <用例数>
 * 退出码: 0=通过, 1=阻断
 */
import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const defectsArg = args.find((a) => a.startsWith("--defects"));
const casesArg = args.find((a) => a.startsWith("--cases"));

if (!defectsArg) {
  console.error("用法: node quality-gate.js --defects <缺陷JSON文件> --cases <用例数>");
  process.exit(1);
}

const defectsPath = defectsArg.split("=")[1] || defectsArg.split("=")[0];
const caseCount = casesArg ? parseInt(casesArg.split("=")[1] || casesArg) : 50;

if (!existsSync(defectsPath)) {
  console.error(`缺陷文件不存在: ${defectsPath}`);
  process.exit(1);
}

const defects = JSON.parse(readFileSync(defectsPath, "utf-8"));

const weights = { fatal: 10, critical: 3, general: 1, minor: 0.1 };
const counts = { fatal: 0, critical: 0, general: 0, minor: 0 };
for (const d of defects) {
  if (counts[d.severity] !== undefined) counts[d.severity]++;
}

const di = counts.fatal * 10 + counts.critical * 3 + counts.general * 1 + counts.minor * 0.1;
const diDensity = caseCount > 0 ? di / caseCount : di;

const openCritical = defects.filter((d) => d.severity === "critical" && d.status !== "closed").length;
const openFatal = defects.filter((d) => d.severity === "fatal" && d.status !== "closed").length;

console.log("\n===== DI 质量门 =====\n");
console.log(`缺陷统计: 致命 ${counts.fatal} | 严重 ${counts.critical} | 一般 ${counts.general} | 轻微 ${counts.minor}`);
console.log(`DI 值: ${di.toFixed(1)}`);
console.log(`DI 密度: ${diDensity.toFixed(3)} (阈值 < 0.3)`);
console.log(`未关闭致命: ${openFatal} | 未关闭严重: ${openCritical}`);

const checks = {
  diDensity: diDensity < 0.3,
  fatalClosed: openFatal === 0,
  criticalClosed: openCritical === 0,
};

console.log("\n上线判定:");
console.log(`  DI 密度 < 0.3:    ${checks.diDensity ? "✓" : "✗"} (${diDensity.toFixed(3)})`);
console.log(`  致命全部关闭:    ${checks.fatalClosed ? "✓" : "✗"}`);
console.log(`  严重全部关闭:    ${checks.criticalClosed ? "✓" : "✗"}`);

const pass = Object.values(checks).every(Boolean);
console.log(`\n${pass ? "✅ 质量门通过，允许上线" : "❌ 质量门未通过，阻断上线"}\n`);

process.exit(pass ? 0 : 1);
