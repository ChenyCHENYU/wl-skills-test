/**
 * cli/commands/generation.js — run-gen（用例 / Playwright / JMeter / E2E 脚手架生成）
 */
import { existsSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { consumeContract, generateTestCaseMatrix } from "../../contract-consumer.js";
import { generatePlaywrightScript } from "../../playwright-generator.js";
import { generateJmeterScript } from "../../jmeter-generator.js";
import { generateE2eScaffold } from "../../e2e-generator.js";
import { exportCasesMarkdown } from "../../test-codegen.js";
import { generateFineGrainedCases, exportFineCasesMarkdown } from "../../case-fine-gen.js";
import { writeTextFile } from "../../shared/utils.js";

export function cmdRunGen(parsed) {
  const { opts } = parsed;
  const genType = opts.type || "cases";
  const baseUrl = opts["base-url"] || "http://localhost:8080";
  const threads = opts.threads ? parseInt(opts.threads) : 100;
  const contractPath = opts.contract;
  const granularity = opts.granularity || (opts.fine === true ? "field" : "");

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
  cases      测试用例 Markdown（默认；--granularity field 追加字段级细粒度用例）
  playwright Playwright 测试脚本
  jmeter     JMeter jmx 性能测试脚本
  e2e        成熟 E2E 工程脚手架（三轮策略+网络监控+清理账本，输出为目录）

示例:
  wl-skills-test run-gen --contract ./wl-contract.json
  wl-skills-test run-gen --contract ./wl-contract.json --granularity field   # 基线矩阵 + 字段级细粒度
  wl-skills-test run-gen --contract ./page-spec.json --type playwright
  wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
  wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e
`);
    process.exitCode = 2; // 用法错误（缺必填参数）
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
      writeTextFile(outputPath, generatePlaywrightScript(contractPath, { baseUrl }));
      console.log(`✅ Playwright 脚本生成完成 → ${outputPath}\n`);
    } else if (genType === "jmeter") {
      // scenario: single（默认，逐操作）/ mixed（读写权重混合 80/15/5，ThroughputController）
      const scenario = opts.scenario === "mixed" ? "mixed" : "single";
      writeTextFile(outputPath, generateJmeterScript(contractPath, { threads, scenario }));
      console.log(`✅ JMeter jmx 生成完成（${threads} 线程${scenario === "mixed" ? "，混合场景 读写 80/15/5" : ""}）→ ${outputPath}\n`);
    } else if (genType === "e2e") {
      const result = generateE2eScaffold(contractPath, {
        outputDir: outputPath,
        baseUrl,
        routes: opts.routes,
        ui: opts.ui,
        workstation: opts.workstation === true || opts.workstation === "true",
      });
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
      const entityName = result.summary.entity || result.summary.pageName || "未命名";
      let md = exportCasesMarkdown(cases, `测试用例 — ${entityName}`);
      if (result.summary.apiFactsStatus === "unresolved") md += "\n> API 事实待补：当前用例按页面交互意图设计；接口执行需提供真实 API 契约。\n";

      // 细粒度用例（--granularity field）：字段级边界/非法值/安全/操作级闭环，dimension 与 run-api DAG 映射
      let fine = [];
      if (granularity === "field") {
        fine = generateFineGrainedCases(result.summary);
        // 与基线矩阵去重：基线的「<实体> - <字段> 必填校验」与细粒度的 field-required 双重覆盖同一意图，
        // 保留基线（缺陷追溯引用的既有编号体系），剔除细粒度重复项
        const requiredCovered = new Set(
          cases
            .map((c) => String(c.name || "").match(/(\S+)\s+必填校验/)?.[1])
            .filter(Boolean),
        );
        const before = fine.length;
        fine = fine.filter((c) => !(c.dimension === "field-required" && requiredCovered.has(c.field)));
        const deduped = before - fine.length;
        if (deduped > 0) {
          console.log(`  去重: 细粒度 field-required 与基线必填校验重复 ${deduped} 条已剔除`);
        }
        md += "\n" + exportFineCasesMarkdown(fine, entityName);
      }
        writeTextFile(outputPath, md);
        // 结构化产物（v0.24.0 JSON 化）：平台/AI 消费 JSON 零失真、省 token
        if (opts.json) {
          writeTextFile(opts.json, JSON.stringify({ entity: entityName, module: result.summary.module, generatedAt: new Date().toISOString(), cases, fineCases: fine }, null, 2));
          console.log(`JSON 用例已写入: ${opts.json}`);
        }

      const countBy = (type) => cases.filter((c) => c.type === type).length;

      console.log(`✅ 生成完成：${cases.length + fine.length} 条用例（基线矩阵 ${cases.length}${fine.length > 0 ? ` + 细粒度 ${fine.length}` : ""}）`);
      console.log(`  实体: ${entityName}`);
      console.log(`  模块: ${result.summary.module || "—"}`);
      console.log(`  接口测试: ${countBy("api")} 条`);
      if (countBy("ui")) console.log(`  页面交互测试: ${countBy("ui")} 条（API 事实待补）`);
      console.log(`  权限测试: ${countBy("permission")} 条`);
      console.log(`  边界测试: ${countBy("boundary")} 条`);
      if (fine.length > 0) {
        const auto = fine.filter((c) => c.autoExec).length;
        const p0 = fine.filter((c) => c.priority === "P0").length;
        console.log(`  细粒度: ${fine.length} 条（P0=${p0}，可自动执行 ${auto} 条 → run-api DAG 映射）`);
      }
      console.log(`  输出: ${outputPath}\n`);
    }
  } catch (e) {
    console.error(`❌ 生成失败: ${e.message}\n`);
    process.exitCode = 1; // 生成失败必须阻断 CI（此前退出 0 导致门禁漏判）
  }
}
