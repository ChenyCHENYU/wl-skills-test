/**
 * cli/system.js — doctor（环境体检）/ validate（安装完整性校验）
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkCommandAvailable } from "../shared/utils.js";
import { PKG } from "./context.js";

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

export function cmdValidate() {
  const cwd = process.cwd();
  const skillsDir = join(cwd, ".github", "skills");
  const standardsDir = join(cwd, ".github", "standards");

  console.log("\n校验已安装文件完整性...\n");

  let errors = 0;
  let ok = 0;

  if (existsSync(standardsDir)) {
    const files = readdirSync(standardsDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(standardsDir, f), "utf-8");
      if (content.trim().length < 50) {
        console.log(`  ✗ ${f} 内容过短`);
        errors++;
      } else {
        ok++;
      }
    }
  }

  if (existsSync(skillsDir)) {
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (e === "SKILL.md") {
          const content = readFileSync(full, "utf-8");
          if (!content.includes("---") || !content.includes("name:")) {
            console.log(`  ✗ ${full} 缺少 frontmatter`);
            errors++;
          } else {
            ok++;
          }
        }
      }
    };
    walk(skillsDir);
  }

  console.log(`\n${errors === 0 ? "✅" : "⚠️"} ${ok} 个文件通过，${errors} 个问题。`);
  if (errors > 0) process.exitCode = 1; // 校验发现问题 → 非零退出
}
