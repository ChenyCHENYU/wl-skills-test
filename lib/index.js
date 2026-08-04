/**
 * wl-skills-test CLI 核心入口
 * 子命令：init / update / doctor / validate / run-gen / clean
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { consumeContract, generateTestCaseMatrix } from "./contract-consumer.js";
import { exportCasesMarkdown } from "./test-codegen.js";
import { generatePlaywrightScript } from "./playwright-generator.js";
import { generateJmeterScript } from "./jmeter-generator.js";
import { audit, autoFix } from "./test-audit.js";
import { runApiTests, generateSmokeReport } from "./api-executor.js";
import { runPlaywright, runJmeter } from "./executors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const PKG = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

const COMMANDS = {
  init: "全量安装（11 规范 + 12 Skill + 模板 + 编辑器配置）",
  update: "增量更新（内容比对，仅覆盖变化文件）",
  doctor: "环境体检（Node / Playwright / JMeter / 目录结构）",
  validate: "校验已安装文件的完整性",
  "run-gen": "从契约生成测试用例/Playwright/JMeter 脚本",
  audit: "审计测试代码（T1-T20 确定性规则扫描）",
  fix: "自动修复测试代码反模式（F1-F6）",
  "run-api": "执行 API 接口测试（从契约自动发请求验证）",
  "run-playwright": "执行 Playwright 自动化测试",
  "run-jmeter": "执行 JMeter 性能测试",
  clean: "卸载清理（保留测试脚本和报告）",
};

// ── 参数解析器（防止 flag 误吞）────────────────
function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > -1) {
        opts[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          opts[key] = next;
          i++;
        } else {
          opts[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}

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
  npx @agile-team/wl-skills-test                          # 安装
  npx @agile-team/wl-skills-test --dry-run                # 预览
  npx @agile-team/wl-skills-test doctor                   # 体检
  npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json
  npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type playwright
  npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
`);
}

function showVersion() {
  console.log(`${PKG.name} v${PKG.version}`);
}

function cmdInit(parsed) {
  const dryRun = parsed.opts["dry-run"] === true;
  const force = parsed.opts.force === true;
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
    // init 时替换版本占位符为当前包版本
    let content = f.content;
    if (content.includes("__WL_SKILLS_TEST_VERSION__")) {
      content = content.replaceAll("__WL_SKILLS_TEST_VERSION__", PKG.version);
    }
    if (!force && existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (existing === content) {
        skipped++;
        continue;
      }
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    fsWriteFileSync(targetPath, content, "utf-8");
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
}

function cmdAudit(parsed) {
  const target = parsed.opts.target || parsed.positional[0] || ".";
  console.log(`\n[audit] 审计测试代码: ${target}\n`);

  const result = audit(target);
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
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
  if (fmt === "json") {
    fsWriteFileSync("test-audit-report.json", JSON.stringify(result, null, 2), "utf-8");
    console.log("报告已写入: test-audit-report.json");
  }
  console.log();
}

function cmdFix(parsed) {
  const target = parsed.opts.target || parsed.positional[0] || ".";
  const dryRun = parsed.opts["dry-run"] === true;

  console.log(`\n[fix] ${dryRun ? "[预览] " : ""}修复测试代码反模式: ${target}\n`);

  if (!existsSync(target)) {
    console.error(`❌ 路径不存在: ${target}\n`);
    return;
  }

  const stat = statSync(target);
  const files = [];
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        const s = statSync(full);
        if (s.isDirectory() && !e.startsWith("node_modules") && !e.startsWith(".")) {
          walk(full);
        } else if (s.isFile() && (e.endsWith(".js") || e.endsWith(".ts") || e.endsWith(".spec.js"))) {
          files.push(full);
        }
      }
    };
    walk(target);
  } else {
    files.push(target);
  }

  let fixed = 0;
  let total = 0;
  for (const file of files) {
    const result = autoFix(file);
    total++;
    if (result.changed && result.fixes.length > 0) {
      fixed++;
      console.log(`  ✓ ${file.replace(process.cwd(), ".")}: ${result.fixes.map((f) => f.desc).join(", ")}`);
      if (!dryRun) {
        fsWriteFileSync(file, result.content, "utf-8");
      }
    }
  }

  console.log(`\n${dryRun ? "[预览] " : ""}${fixed}/${total} 个文件${dryRun ? "待" : "已"}修复。\n`);
}

async function cmdRunApi(parsed) {
  const { opts } = parsed;
  const contractPath = opts.contract;
  const baseUrl = opts["base-url"] || "http://localhost:8080";
  const token = opts.token;
  const output = opts.output || "冒烟测试报告.md";

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-api --contract <契约路径> [--base-url <URL>] [--token <token>] [--output <报告>]

示例:
  wl-skills-test run-api --contract ./wl-contract.json --base-url http://sit.example.com
  wl-skills-test run-api --contract ./wl-api-contract.json --token "Bearer xxx" --output smoke.md
`);
    return;
  }

  console.log(`\n[run-api] 执行 API 接口测试`);
  console.log(`  契约: ${contractPath}`);
  console.log(`  目标: ${baseUrl}\n`);

  try {
    const result = await runApiTests({ baseUrl, contractPath, token });
    if (result.error) {
      console.error(`❌ ${result.error}\n`);
      return;
    }

    const s = result.summary;
    console.log(`执行结果：\n`);
    console.log(`  实体:   ${s.entity}`);
    console.log(`  总用例: ${s.total}`);
    console.log(`  ✅ 通过: ${s.passed}`);
    console.log(`  ❌ 失败: ${s.failed}`);
    console.log(`  ⚠️ 错误: ${s.errors}`);
    console.log(`  ⏭️ 跳过: ${s.skipped}`);
    console.log(`  通过率: ${s.passRate}%`);
    console.log(`  结论:   ${s.decision}\n`);

    if (s.failed > 0 || s.errors > 0) {
      console.log("失败/错误详情：\n");
      for (const r of result.results) {
        if (r.status === "fail" || r.status === "error") {
          console.log(`  ❌ ${r.name}: ${r.reason}`);
        }
      }
      console.log();
    }

    const report = generateSmokeReport(result);
    fsWriteFileSync(output, report, "utf-8");
    console.log(`冒烟报告已写入: ${output}\n`);
  } catch (e) {
    console.error(`❌ 执行失败: ${e.message}\n`);
  }
}

function cmdRunPlaywright(parsed) {
  const { opts } = parsed;
  const testDir = opts["test-dir"] || opts.target || "./tests";
  const reporter = opts.reporter || "list";
  const headed = opts.headed === true;

  console.log(`\n[run-playwright] 执行自动化测试: ${testDir}\n`);

  const result = runPlaywright({ testDir, reporter, headed });

  if (result.error) {
    console.error(`❌ ${result.error}`);
    if (result.hint) console.error(`   ${result.hint}\n`);
    return;
  }

  console.log(`结果：\n`);
  console.log(`  ✅ 通过: ${result.passed}`);
  console.log(`  ❌ 失败: ${result.failed}`);
  console.log(`  ⏭️ 跳过: ${result.skipped}`);
  if (result.flaky) console.log(`  🟡 不稳定: ${result.flaky}`);
  console.log(`  通过率: ${result.passRate}%`);
  console.log(`  结论:   ${result.decision}\n`);

  if (result.output && result.failed > 0) {
    console.log("失败详情（末尾）：\n");
    console.log(result.output.slice(-1000));
    console.log();
  }
}

function cmdRunJmeter(parsed) {
  const { opts } = parsed;
  const jmxPath = opts.jmx || opts.target;
  const threads = opts.threads ? parseInt(opts.threads) : 100;
  const resultDir = opts["result-dir"] || "./jmeter-results";

  if (!jmxPath) {
    console.log(`
用法: wl-skills-test run-jmeter --jmx <jmx路径> [--threads <并发数>] [--result-dir <结果目录>]
`);
    return;
  }

  console.log(`\n[run-jmeter] 执行性能测试: ${jmxPath} (${threads} 线程)\n`);

  const result = runJmeter({ jmxPath, threads, resultDir });

  if (result.error) {
    console.error(`❌ ${result.error}`);
    if (result.hint) console.error(`   ${result.hint}\n`);
    return;
  }

  console.log(`结果：\n`);
  console.log(`  样本数: ${result.samples || 0}`);
  console.log(`  ✅ 成功: ${result.passed || 0}`);
  console.log(`  ❌ 失败: ${result.failed || 0}`);
  console.log(`  错误率: ${result.errorRate || 0}%`);
  console.log(`  P50:    ${result.p50 || 0}ms`);
  console.log(`  P95:    ${result.p95 || 0}ms`);
  console.log(`  P99:    ${result.p99 || 0}ms`);
  console.log(`  SLA:    ${result.sla || "-"}`);
  console.log(`  结论:   ${result.decision || "-"}\n`);

  if (result.reportPath) {
    console.log(`HTML 报告: ${result.reportPath}\n`);
  }
}

function cmdRunGen(parsed) {
  const { opts } = parsed;
  const genType = opts.type || "cases";
  const baseUrl = opts["base-url"] || "http://localhost:8080";
  const threads = opts.threads ? parseInt(opts.threads) : 100;

  let outputPath = opts.output;
  if (!outputPath) {
    outputPath = genType === "playwright" ? "auto-test.spec.js" : genType === "jmeter" ? "perf-test.jmx" : "测试用例.md";
  }

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-gen --contract <契约路径> [--type cases|playwright|jmeter] [--output <路径>]

生成类型 (--type):
  cases      测试用例 Markdown（默认）
  playwright Playwright 测试脚本
  jmeter     JMeter jmx 性能测试脚本

示例:
  wl-skills-test run-gen --contract ./wl-contract.json
  wl-skills-test run-gen --contract ./page-spec.json --type playwright
  wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
`);
    return;
  }

  console.log(`\n[run-gen] 从契约生成${genType === "playwright" ? "Playwright 脚本" : genType === "jmeter" ? "JMeter 脚本" : "测试用例"}`);
  console.log(`  契约文件: ${contractPath}`);
  console.log(`  输出路径: ${outputPath}\n`);

  try {
    if (genType === "playwright") {
      const script = generatePlaywrightScript(contractPath, { baseUrl });
      fsWriteFileSync(outputPath, script, "utf-8");
      console.log(`✅ Playwright 脚本生成完成 → ${outputPath}\n`);
    } else if (genType === "jmeter") {
      const script = generateJmeterScript(contractPath, { threads });
      fsWriteFileSync(outputPath, script, "utf-8");
      console.log(`✅ JMeter jmx 生成完成（${threads} 线程）→ ${outputPath}\n`);
    } else {
      const result = consumeContract(contractPath);
      const cases = generateTestCaseMatrix(result.summary);
      const md = exportCasesMarkdown(cases, `测试用例 — ${result.summary.entity || result.summary.pageName || "未命名"}`);
      fsWriteFileSync(outputPath, md, "utf-8");

      const apiTests = cases.filter((c) => c.type === "api").length;
      const permTests = cases.filter((c) => c.type === "permission").length;
      const boundTests = cases.filter((c) => c.type === "boundary").length;

      console.log(`✅ 生成完成：${cases.length} 条用例`);
      console.log(`  实体: ${result.summary.entity || result.summary.pageName || "—"}`);
      console.log(`  模块: ${result.summary.module || "—"}`);
      console.log(`  接口测试: ${apiTests} 条`);
      console.log(`  权限测试: ${permTests} 条`);
      console.log(`  边界测试: ${boundTests} 条`);
      console.log(`  输出: ${outputPath}\n`);
    }
  } catch (e) {
    console.error(`❌ 生成失败: ${e.message}\n`);
  }
}

function cmdClean(parsed) {
  const dryRun = parsed.opts["dry-run"] === true;
  const cwd = process.cwd();

  const targets = [
    join(cwd, ".github", "standards"),
    join(cwd, ".github", "skills"),
    join(cwd, ".github", "_route-evals.json"),
    join(cwd, "copilot-instructions.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, "CLAUDE.md"),
    join(cwd, ".cursor"),
    join(cwd, ".windsurf"),
    join(cwd, ".kiro"),
    join(cwd, ".trae"),
    join(cwd, ".clinerules"),
    join(cwd, ".qoder"),
    join(cwd, ".mcp.json"),
  ];

  console.log(`\n${dryRun ? "[预览] " : ""}清理 ${PKG.name} 安装文件...\n`);
  console.log("保留：测试脚本、报告、测试数据");
  console.log("清理：\n");

  let removed = 0;
  for (const target of targets) {
    if (existsSync(target)) {
      const name = target.replace(cwd, ".");
      console.log(`  ${dryRun ? "将删除" : "已删除"}: ${name}`);
      if (!dryRun) {
        rmSync(target, { recursive: true, force: true });
      }
      removed++;
    }
  }

  console.log(`\n${removed} 个目标${dryRun ? "待清理" : "已清理"}。\n`);
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
    execSync(cmd, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── 主入口 ──────────────────────────────────
export function run(argv) {
  const cmd = argv[0];
  const args = argv.slice(1);
  const parsed = parseArgs(args);

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
      cmdInit(parsed);
      break;
    case "update":
      cmdInit({ opts: { ...parsed.opts, force: true } });
      break;
    case "doctor":
      cmdDoctor();
      break;
    case "validate":
      cmdValidate();
      break;
    case "run-gen":
      cmdRunGen(parsed);
      break;
    case "audit":
      cmdAudit(parsed);
      break;
    case "fix":
      cmdFix(parsed);
      break;
    case "run-api":
      cmdRunApi(parsed);
      break;
    case "run-playwright":
      cmdRunPlaywright(parsed);
      break;
    case "run-jmeter":
      cmdRunJmeter(parsed);
      break;
    case "clean":
      cmdClean(parsed);
      break;
    default:
      if (cmd.startsWith("--")) {
        cmdInit(parseArgs(argv));
      } else {
        console.error(`未知命令: ${cmd}`);
        showHelp();
        process.exit(1);
      }
  }
}
