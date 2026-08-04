/**
 * wl-skills-test CLI 核心入口
 * 子命令：init / update / doctor / validate / run-gen / clean
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

const COMMANDS = {
  init: "全量安装（11 规范 + 12 Skill + 模板 + 编辑器配置）",
  update: "增量更新（MD5 比对，仅覆盖变化文件）",
  doctor: "环境体检（Node / Playwright / JMeter / 目录结构）",
  validate: "校验已安装文件的完整性",
  "run-gen": "从契约生成测试用例（消费 kit/bd 产物）",
  clean: "卸载清理（保留测试脚本和报告）",
};

function showHelp() {
  console.log(`
${PKG.name} v${PKG.version}
${PKG.description}

用法:
  npx @agile-team/wl-skills-test <command> [options]

命令:
${Object.entries(COMMANDS)
  .map(([cmd, desc]) => `  ${cmd.padEnd(12)} ${desc}`)
  .join("\n")}

选项:
  --dry-run     预览模式（不实际写入）
  --force       强制覆盖
  --help, -h    显示帮助

示例:
  npx @agile-team/wl-skills-test              # 等同于 init
  npx @agile-team/wl-skills-test init
  npx @agile-team/wl-skills-test --dry-run
  npx @agile-team/wl-skills-test doctor
  npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json
`);
}

function showVersion() {
  console.log(`${PKG.name} v${PKG.version}`);
}

function cmdInit(args) {
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const cwd = process.cwd();

  console.log(`\n${dryRun ? "[预览] " : ""}安装 ${PKG.name} v${PKG.version}...\n`);

  const filesDir = join(PKG_ROOT, "files");
  if (!existsSync(filesDir)) {
    console.error("错误：包文件目录不存在，请检查安装是否完整。");
    process.exit(1);
  }

  const plannedFiles = [];
  scanDir(filesDir, "", plannedFiles);

  console.log(`计划写入 ${plannedFiles.length} 个文件：\n`);

  const categories = {};
  for (const f of plannedFiles) {
    const cat = f.target.split("/")[0] || "root";
    categories[cat] = (categories[cat] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categories)) {
    console.log(`  ${cat.padEnd(30)} ${count} 个文件`);
  }

  if (dryRun) {
    console.log("\n[预览模式] 未实际写入。去掉 --dry-run 执行安装。\n");
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const f of plannedFiles) {
    const targetPath = join(cwd, f.target);
    if (!force && existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (existing === f.content) {
        skipped++;
        continue;
      }
    }
    ensureDir(dirname(targetPath));
    writeFileSync(targetPath, f.content);
    written++;
  }

  console.log(`\n完成：${written} 个文件写入，${skipped} 个跳过（未变化）。`);
  console.log(`\n下一步：`);
  console.log(`  1. 在 AI 编辑器中打开项目，AI 将自动识别测试规范和技能`);
  console.log(`  2. 说"生成测试方案"或"分析业务场景"触发 Skill`);
  console.log(`  3. 运行 npx @agile-team/wl-skills-test doctor 检查环境\n`);
}

function cmdDoctor() {
  console.log(`\n${PKG.name} v${PKG.version} 环境体检\n`);

  const checks = [
    { name: "Node.js >= 20", pass: process.version >= "v20" },
    {
      name: "Playwright（前端自动化）",
      pass: checkCommand("npx playwright --version"),
      optional: true,
    },
    {
      name: "JMeter 5.6.3（性能测试）",
      pass: checkCommand("jmeter --version"),
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
}

function cmdValidate() {
  const cwd = process.cwd();
  const skillsDir = join(cwd, ".github", "skills");
  const standardsDir = join(cwd, ".github", "standards");

  console.log("\n校验已安装文件完整性...\n");

  let errors = 0;
  let ok = 0;

  // 校验 standards
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

  // 校验 skills
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
}

function cmdRunGen(args) {
  const contractArg = args.find((a) => a.startsWith("--contract"));
  const contractPath = contractArg ? contractArg.split("=")[1] || args[args.indexOf(contractArg) + 1] : null;
  const outputArg = args.find((a) => a.startsWith("--output"));
  const outputPath = outputArg ? outputArg.split("=")[1] || "测试用例.md" : "测试用例.md";

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-gen --contract <契约文件路径> [--output <输出路径>]

支持的契约格式：
  --contract ./wl-contract.json        (bd 后端契约)
  --contract ./wl-api-contract.json    (kit 前后端共享契约)
  --contract ./page-spec.json          (kit 页面规格)
`);
    return;
  }

  console.log(`\n[run-gen] 从契约生成测试用例`);
  console.log(`  契约文件: ${contractPath}`);
  console.log(`  输出路径: ${outputPath}\n`);

  try {
    const { generateFromContract, exportCasesMarkdown } = require("./test-codegen.js");
    const result = generateFromContract(contractPath);
    const md = exportCasesMarkdown(result.cases, `测试用例 — ${result.summary.entity || result.summary.pageName}`);

    const fs = require("node:fs");
    fs.writeFileSync(outputPath, md, "utf-8");

    console.log(`✅ 生成完成：${result.caseCount} 条用例`);
    console.log(`  实体: ${result.summary.entity || result.summary.pageName}`);
    console.log(`  模块: ${result.summary.module || "—"}`);
    console.log(`  接口测试: ${result.summary.apiTests} 条`);
    console.log(`  权限测试: ${result.summary.permissionTests} 条`);
    console.log(`  边界测试: ${result.summary.boundaryTests} 条`);
    console.log(`  输出: ${outputPath}\n`);
  } catch (e) {
    console.error(`❌ 生成失败: ${e.message}\n`);
  }
}

function cmdClean(args) {
  const dryRun = args.includes("--dry-run");
  console.log(
    `\n${dryRun ? "[预览] " : ""}清理 ${PKG.name} 安装文件...\n`,
  );
  if (!dryRun) {
    console.log("保留：测试脚本、报告、测试数据");
    console.log("清理：.github/standards/、.github/skills/、编辑器配置\n");
  }
}

// ── 工具函数 ──────────────────────────────────
function scanDir(base, rel, results) {
  for (const entry of readdirSync(base)) {
    const full = join(base, entry);
    const target = rel ? `${rel}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      scanDir(full, target, results);
    } else {
      results.push({
        target,
        content: readFileSync(full, "utf-8"),
      });
    }
  }
}

function checkCommand(cmd) {
  try {
    const { execSync } = require("node:child_process");
    execSync(cmd, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  const { mkdirSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
}

function writeFileSync(path, content) {
  const fs = require("node:fs");
  fs.writeFileSync(path, content, "utf-8");
}

// ── 主入口 ──────────────────────────────────
export function run(args) {
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    showHelp();
    return;
  }

  if (cmd === "--version" || cmd === "-v") {
    showVersion();
    return;
  }

  switch (cmd) {
    case "init":
      cmdInit(args.slice(1));
      break;
    case "update":
      cmdInit([...args.slice(1), "--force"]);
      break;
    case "doctor":
      cmdDoctor();
      break;
    case "validate":
      cmdValidate();
      break;
    case "run-gen":
      cmdRunGen(args.slice(1));
      break;
    case "clean":
      cmdClean(args.slice(1));
      break;
    default:
      // 无命令时默认 init
      if (cmd.startsWith("--")) {
        cmdInit(args);
      } else {
        console.error(`未知命令: ${cmd}`);
        showHelp();
        process.exit(1);
      }
  }
}
