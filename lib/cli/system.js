/**
 * cli/system.js — doctor（环境体检）/ validate（安装完整性校验）
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkCommandAvailable } from "../shared/utils.js";
import { PKG } from "./context.js";
import { inspectInstallation } from "../host-diagnostics.js";

export function cmdDoctor() {
  console.log(`\n${PKG.name} v${PKG.version} 环境体检\n`);

  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  const checks = [
    { name: `Node.js >= 20（当前 ${process.version}）`, pass: nodeMajor >= 20 },
    {
      name: "Playwright（前端自动化）",
      pass: checkCommandAvailable("npx playwright --version").ok,
      optional: true,
    },
    {
      name: "JMeter 5.6.3（性能测试）",
      pass: checkCommandAvailable("jmeter --version").ok,
      optional: true,
    },
    {
      name: ".github/standards/ 目录",
      pass: existsSync(join(process.cwd(), ".github", "standards")),
    },
    {
      name: ".github/skills/ 目录",
      pass: existsSync(join(process.cwd(), ".github", "skills")),
    },
  ];

  let allPass = true;
  for (const c of checks) {
    const icon = c.pass ? "✓" : c.optional ? "○" : "✗";
    const suffix = c.pass ? "" : c.optional ? "（可选）" : "（必需）";
    console.log(`  ${icon} ${c.name}${suffix}`);
    if (!c.pass && !c.optional) allPass = false;
  }

  console.log(
    allPass
      ? "\n✅ 环境就绪，可以开始使用测试技能。"
      : "\n⚠️ 部分必需项未通过，请先安装。",
  );
  // 必需项未通过 → 非零退出（CI 可感知）
  if (!allPass) process.exitCode = 1;
}

export function cmdValidate(parsed = { opts: {} }) {
  const result = inspectInstallation(parsed.opts.root || process.cwd());
  if (parsed.opts.json === true) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\n安装完整性: ${result.integrity}（检查 ${result.filesChecked} 个文件）`);
    for (const problem of result.problems) console.log(`  ✗ ${problem.path || "安装清单"}: ${problem.reason}`);
    console.log("宿主实际加载与行为遵循: unknown / unverified；文件校验不能证明模型使用了技能。\n");
  }
  if (result.integrity !== "verified" || result.filesChecked === 0) process.exitCode = 1;
  return result;
}
