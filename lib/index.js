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
import { generateE2eScaffold } from "./e2e-generator.js";
import { e2eCheck } from "./e2e-check.js";
import { perfCompare } from "./perf-compare.js";
import { generateReport } from "./report-generator.js";

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
  "perf-compare": "性能基线对比（当前 jtl/json vs 基线，劣化即非零退出）",
  "e2e-check": "E2E 工程强校验（归属闭环/安全标记/隔离声明，CI 卡门）",
  report: "聚合各执行结果生成测试报告（对齐规范 10 模板）",
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
  const incremental = parsed.opts.incremental === true;
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
  let preserved = 0;

  for (const f of plannedFiles) {
    const targetPath = join(cwd, f.target);
    // init 时替换版本占位符为当前包版本
    let content = f.content;
    if (content.includes("__WL_SKILLS_TEST_VERSION__")) {
      content = content.replaceAll("__WL_SKILLS_TEST_VERSION__", PKG.version);
    }
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (existing === content) {
        skipped++;
        continue;
      }
      // 增量更新（update 命令）：本地已被用户修改的文件不强制覆盖，保留并提示
      if (incremental && !force) {
        const original = readPlannedOriginal(filesDir, f.target);
        if (original !== null && original !== existing) {
          preserved++;
          console.log(`  ⚠️ 已保留本地修改: ${f.target}（如需覆盖请使用 --force）`);
          continue;
        }
      }
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    fsWriteFileSync(targetPath, content, "utf-8");
    written++;
  }

  if (incremental) {
    console.log(`\n完成：${written} 个文件更新，${skipped} 个无变化，${preserved} 个本地修改已保留。`);
  } else {
    console.log(`\n完成：${written} 个文件写入，${skipped} 个跳过（未变化）。`);
  }
  console.log(`\n下一步：`);
  console.log(`  1. 在 AI 编辑器中打开项目，AI 将自动识别测试规范和技能`);
  console.log(`  2. 说"生成测试方案"或"分析业务场景"触发 Skill`);
  console.log(`  3. 运行 npx @agile-team/wl-skills-test doctor 检查环境\n`);
}

function cmdDoctor() {
  console.log(`\n${PKG.name} v${PKG.version} 环境体检\n`);

  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  const checks = [
    { name: `Node.js >= 20（当前 ${process.version}）`, pass: nodeMajor >= 20 },
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

  // CI 卡门：审计不通过时非零退出（fatal/error 存在即阻断）
  if (!result.pass) {
    process.exitCode = 1;
  }
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
  const noPermToken = opts["token-no-perm"] || opts.tokenNoPerm;
  const dictFile = opts["dict-file"] || opts.dictFile;
  const lenientCoercion = opts["lenient-coercion"] === true;
  const permWriteProbe = opts["perm-write-probe"] === true;
  const output = opts.output || "接口测试报告.md";
  const jsonOutput = opts.json || output.replace(/\.md$/, "") + ".json";

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-api --contract <契约路径> [选项]

深度接口测试（DAG 编排 + 四层断言：成功码/结构/写后读回/负例与安全）:
  --base-url <URL>        目标基址（默认 http://localhost:8080）
  --token <token>         认证 token（自动补 Bearer）
  --token-no-perm <token> 无权限账号 token（启用权限拒绝验证）
  --dict-file <路径>       字典 JSON（{字段名: [合法值]}，提升枚举字段 payload 通过率）
  --lenient-coercion      类型负例被后端隐式转换时记 warn 而非 fail
  --perm-write-probe      允许对写操作做权限探针（意外成功自动清理）
  --output <报告.md>      Markdown 报告路径（默认 接口测试报告.md）
  --json <结果.json>      JSON 结果路径（供 quality-gate --smoke-result / report 消费）

执行链路: 列表冒烟 → 新增 → 写后读回比对 → 更新 → 详情 → 负例(必填/类型/超长)
          → 重复提交 → 权限拒绝 → 分页边界 → 清理 → 零污染复查
`);
    return;
  }

  if (!existsSync(contractPath)) {
    console.error(`❌ 契约文件不存在: ${contractPath}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[run-api] 执行 API 接口测试`);
  console.log(`  契约: ${contractPath}`);
  console.log(`  目标: ${baseUrl}\n`);

  try {
    const result = await runApiTests({ baseUrl, contractPath, token, noPermToken, dictFile, lenientCoercion, permWriteProbe });
    if (result.error) {
      console.error(`❌ ${result.error}\n`);
      process.exitCode = 1;
      return;
    }

    const s = result.summary;
    console.log(`执行结果：\n`);
    console.log(`  实体:     ${s.entity}`);
    console.log(`  步骤:     ${s.total}（断言 ${s.assertions.total} 条）`);
    console.log(`  ✅ 通过:   ${s.passed}（含 warn ${s.warned}）`);
    console.log(`  ❌ 失败:   ${s.failed}`);
    console.log(`  ⚠️ 错误:   ${s.errors}`);
    console.log(`  ⏭️ 跳过:   ${s.skipped}`);
    if (s.negatives) console.log(`  负例:     ${s.negatives.passed}/${s.negatives.total} 通过（必填缺失/类型错误/超长）`);
    if (s.permissions) console.log(`  权限:     ${s.permissions.total > 0 ? `${s.permissions.passed}/${s.permissions.total} 通过` : "未启用（--token-no-perm）"}`);
    if (s.drift) {
      const d = s.drift.missing.length + s.drift.extra.length + s.drift.typeMismatch.length;
      console.log(`  契约漂移: ${d === 0 ? "无" : `${d} 项（缺失 ${s.drift.missing.length} / 未声明 ${s.drift.extra.length} / 类型 ${s.drift.typeMismatch.length}）`}`);
    }
    console.log(`  清理:     登记 ${s.cleanup.created} / 清理 ${s.cleanup.cleaned} / 复查${s.cleanup.verified ? "无残留" : "未验证"}`);
    console.log(`  通过率:   ${s.passRate}%`);
    console.log(`  结论:     ${s.decision}\n`);

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
    console.log(`冒烟报告已写入: ${output}`);
    fsWriteFileSync(jsonOutput, JSON.stringify(result, null, 2), "utf-8");
    console.log(`JSON 结果已写入: ${jsonOutput}（可供 quality-gate --smoke-result 消费）\n`);

    // CI 卡门：不通过时非零退出
    if (s.decision.startsWith("不通过")) {
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`❌ 执行失败: ${e.message}\n`);
    process.exitCode = 1;
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

  // JSON 结果输出（供 report 子命令 / quality-gate 消费）
  const jsonOutput = opts.json || "playwright-result.json";
  fsWriteFileSync(jsonOutput, JSON.stringify(result, null, 2), "utf-8");
  console.log(`JSON 结果已写入: ${jsonOutput}\n`);

  if (result.output && result.failed > 0) {
    console.log("失败详情（末尾）：\n");
    console.log(result.output.slice(-1000));
    console.log();
  }

  if (result.decision === "不通过") {
    process.exitCode = 1;
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
  const contractPath = opts.contract;

  let outputPath = opts.output;
  if (!outputPath) {
    outputPath =
      genType === "playwright"
        ? "auto-test.spec.js"
        : genType === "jmeter"
          ? "perf-test.jmx"
          : genType === "e2e"
            ? "e2e"
            : "测试用例.md";
  }

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-gen --contract <契约路径> [--type cases|playwright|jmeter|e2e] [--output <路径>]

生成类型 (--type):
  cases      测试用例 Markdown（默认）
  playwright Playwright 测试脚本
  jmeter     JMeter jmx 性能测试脚本
  e2e        成熟 E2E 工程脚手架（三轮策略+网络监控+清理账本，输出为目录）

示例:
  wl-skills-test run-gen --contract ./wl-contract.json
  wl-skills-test run-gen --contract ./page-spec.json --type playwright
  wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
  wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e
`);
    return;
  }

  if (!existsSync(contractPath)) {
    console.error(`❌ 契约文件不存在: ${contractPath}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[run-gen] 从契约生成${genType === "playwright" ? "Playwright 脚本" : genType === "jmeter" ? "JMeter 脚本" : genType === "e2e" ? "E2E 工程脚手架" : "测试用例"}`);
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
    } else if (genType === "e2e") {
      const result = generateE2eScaffold(contractPath, { outputDir: outputPath, baseUrl, routes: opts.routes });
      console.log(`✅ E2E 脚手架生成完成 → ${outputPath}/`);
      console.log(`  测试页面: ${result.pageName}（${result.pages.length} 个）`);
      console.log(`  写入文件: ${result.files.length} 个（7 层 project 编排 + 归属清单强校验）`);
      for (const w of result.warnings || []) console.log(`  ⚠️ ${w}`);
      console.log(`  下一Step:`);
      console.log(`    1. cd ${outputPath} && npm install && npx playwright install chromium`);
      console.log(`    2. 核对 fixtures/pages.js 路由（derived 的务必提供 routes.json 核对）`);
      console.log(`    3. npm run e2e:auth → npm run e2e（只读冒烟）`);
      console.log(`    4. npm run e2e:detail / e2e:ui-contract（深度与拦截契约）`);
      console.log(`    5. E2E_ENABLE_WRITE=1 E2E_WRITE_CONFIRM=<确认串> npm run e2e:round2`);
      console.log(`    6. npx @agile-team/wl-skills-test e2e-check --target ./${outputPath}\n`);
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

function cmdPerfCompare(parsed) {
  const { opts } = parsed;
  const current = opts.current;
  const baseline = opts.baseline;
  const threshold = opts.threshold ? parseFloat(opts.threshold) : 15;

  if (!current || !baseline) {
    console.log(`
用法: wl-skills-test perf-compare --current <jtl或json> --baseline <jtl或json> [--threshold 15] [--output <报告>]

判定:
  P50/P95/P99 相对劣化超过阈值（默认 15%）→ 劣化
  错误率绝对上升超过 1pp → 劣化
  任一劣化 → 退出码 1（CI 卡门）

示例:
  wl-skills-test perf-compare --current ./jmeter-results/result.jtl --baseline ./baseline/result.jtl
  wl-skills-test perf-compare --current result.jtl --baseline baseline.json --threshold 10
`);
    return;
  }

  const result = perfCompare({ currentPath: current, baselinePath: baseline, threshold });
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[perf-compare] 基线对比（阈值 ${threshold}%）\n`);
  for (const m of result.metrics) {
    const unit = m.metric === "errorRate" ? "%" : "ms";
    const deltaText = m.metric === "errorRate" ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}pp` : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`;
    console.log(`  ${m.regressed ? "❌" : "✅"} ${m.metric.padEnd(10)} 基线 ${m.baseline}${unit} → 当前 ${m.current}${unit}（${deltaText}）`);
  }
  console.log(`\n结论: ${result.summary.verdict}\n`);

  const output = opts.output;
  if (output) {
    fsWriteFileSync(output, result.markdown, "utf-8");
    console.log(`报告已写入: ${output}\n`);
  }

  if (result.regressed) {
    process.exitCode = 1;
  }
}

async function cmdE2eCheck(parsed) {
  const { opts } = parsed;
  const target = opts.target || "./e2e";

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

function cmdReport(parsed) {  const { opts } = parsed;
  const output = opts.output || "测试报告.md";

  if (!opts.api && !opts.playwright && !opts.jmeter && !opts.defects) {
    console.log(`
用法: wl-skills-test report [--api <run-api json>] [--playwright <run-playwright json>] [--jmeter <性能json>] [--defects <缺陷json> --cases <N>] [--output <报告>]

聚合 run-api / run-playwright / run-jmeter / DI 缺陷结果，生成对齐规范 10 的测试报告，
含上线判定（任一来源不达标 → 结论"不具备上线条件"）。

示例:
  wl-skills-test report --api smoke.json --defects defects.json --cases 150
  wl-skills-test report --api smoke.json --playwright playwright-result.json --jmeter perf.json
`);
    return;
  }

  const result = generateReport({
    api: opts.api,
    playwright: opts.playwright,
    jmeter: opts.jmeter,
    defects: opts.defects,
    cases: opts.cases ? parseInt(opts.cases) : 50,
    title: opts.title,
  });

  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  fsWriteFileSync(output, result.report, "utf-8");
  console.log(`\n[report] 测试报告已生成 → ${output}`);
  console.log(`结论: ${result.pass ? "✅ 具备上线条件" : "❌ 不具备上线条件"}\n`);

  if (!result.pass) {
    process.exitCode = 1;
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

// 读取包内原始文件内容（用于 update 判断用户是否本地修改过）
function readPlannedOriginal(filesDir, target) {
  try {
    return readFileSync(join(filesDir, target), "utf-8");
  } catch {
    return null;
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
export async function run(argv) {
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
      cmdInit({ opts: { ...parsed.opts, incremental: true } });
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
      await cmdRunApi(parsed);
      break;
    case "run-playwright":
      cmdRunPlaywright(parsed);
      break;
    case "run-jmeter":
      cmdRunJmeter(parsed);
      break;
    case "perf-compare":
      cmdPerfCompare(parsed);
      break;
    case "e2e-check":
      await cmdE2eCheck(parsed);
      break;
    case "report":
      cmdReport(parsed);
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
