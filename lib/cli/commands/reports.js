/**
 * cli/commands/reports.js — report（聚合报告 + 自动发现 + 趋势 + 索引 + webhook）
 */
import { writeFileSync as fsWriteFileSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateReport, discoverDimensionResults } from "../../report-generator.js";
import { renderHtmlReport } from "../../report/html.js";
import { appendHistory, renderIndex } from "../../report-dimensions.js";
import { writeTextFile } from "../../shared/utils.js";
import { resolveReportsDir } from "../context.js";
import { pushWebhook } from "../webhook.js";

export async function cmdReport(parsed) {
  const { opts } = parsed;
  const reportsDir = resolveReportsDir(opts);
  const output = opts.output || join(reportsDir, "测试报告.md");
  const wantTrend = opts.trend === true;
  mkdirSync(reportsDir, { recursive: true });

  let api = opts.api;
  let playwright = opts.playwright;
  let jmeter = opts.jmeter;
  let audit = opts.audit;
  let defects = opts.defects;
  let discovered = false;

  // 自动发现：未显式指定来源时，扫描 test-reports/ 最新维度结果
  if (!api && !playwright && !jmeter && !audit && !defects) {
    const found = discoverDimensionResults(reportsDir);
    if (Object.keys(found).length > 0) {
      api = found.api || undefined;
      playwright = found.playwright || undefined;
      jmeter = found.jmeter || undefined;
      audit = found.audit || undefined;
      defects = found.defects || undefined;
      discovered = true;
    }
  }

  if (!api && !playwright && !jmeter && !audit && !defects) {
    console.log(`
用法: wl-skills-test report [--api <json>] [--playwright <json>] [--jmeter <json>] [--audit <json>] [--defects <json> --cases <N>] [--output <报告>] [--trend] [--reports-dir <目录>]

聚合 run-api / run-playwright / run-jmeter / audit / DI 缺陷结果，生成对齐规范 10 的测试报告，
含上线判定（任一来源不达标 → 结论"不具备上线条件"）。

自动发现（推荐，不传任何来源参数）: 扫描 ${reportsDir}/ 下约定文件——
  api-result.json / playwright-result.json|e2e-result.json / perf-result.json / audit-result.json / defects.json
（各执行命令默认已写入；显式参数优先于自动发现）

--trend 追加最近 5 次汇总报告趋势（读 ${reportsDir}/history.jsonl）
产出: ${reportsDir}/测试报告.md + index.md（报告索引）+ history.jsonl（运行历史）
`);
    process.exitCode = 2; // 用法错误（未提供任何来源）
    return;
  }

  const result = generateReport({
    api,
    playwright,
    jmeter,
    audit,
    defects,
    cases: opts.cases !== undefined ? parseInt(opts.cases, 10) || 50 : 50,
    title: opts.title,
    trend: wantTrend,
    reportsDir,
  });

  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (discovered) {
    const used = [api && "api", playwright && "playwright", jmeter && "jmeter", audit && "audit", defects && "defects"].filter(Boolean).join(", ");
    console.log(`\n[report] 自动发现维度结果: ${used}`);
  }
  writeTextFile(output, result.report);
  console.log(`\n[report] 测试报告已生成 → ${output}`);
  console.log(`结论: ${result.pass ? "✅ 具备上线条件" : "❌ 不具备上线条件"}`);
  if (result.score !== null && result.score !== undefined) {
    console.log(`质量分: ${result.score}（${result.scoreLevel}）`);
  }

  // 单文件 HTML 交互报告（--html，零依赖：数据内嵌 + 原生 JS 筛选，离线可看）
  if (opts.html === true) {
    const htmlOutput = join(reportsDir, "测试报告.html");
    writeTextFile(htmlOutput, renderHtmlReport(result, { title: opts.title }));
    console.log(`HTML 报告: ${htmlOutput}`);
  }

  // 运行历史 + 报告索引（陆续迭代的趋势数据源）
  appendHistory(reportsDir, { kind: "report", pass: result.pass, score: result.score, api: result.snapshot?.api, ui: result.snapshot?.ui, file: output });
  // 测试计划数据侧（v0.24.0 --plan-input）：AI 写测试计划的一次性聚合数据
  // （计划本身是决策文档由 AI 写；数据——历史趋势/本次判定/各维度摘要——由工具一次给全）
  if (opts["plan-input"] === true) {
    const { readHistory } = await import("../../report-dimensions.js");
    const dims = discoverDimensionResults(reportsDir);
    const readDim = (p) => {
      try {
        return JSON.parse(readFileSync(p, "utf-8").replace(/^\uFEFF/, ""));
      } catch {
        return null;
      }
    };
    const apiSummary = dims.api ? readDim(dims.api)?.summary : null;
    const audit = dims.audit ? readDim(dims.audit) : null;
    const perf = dims.jmeter ? readDim(dims.jmeter)?.summary : null;
    const planInput = {
      generatedAt: new Date().toISOString(),
      current: { pass: result.pass, score: result.score, scoreLevel: result.scoreLevel, checks: result.checks, snapshot: result.snapshot },
      apiDimensionCoverage: apiSummary?.dimensionCoverage ?? null,
      apiFailures: apiSummary
        ? null // 全量失败明细在 api-result.json，此处给聚合口径
        : null,
      auditDigest: audit ? { pass: audit.pass, level: audit.level, bySeverity: audit.bySeverity, byRule: audit.byRule } : null,
      perfDigest: perf ? { samples: perf.samples, p99: perf.p99, errorRate: perf.errorRate, decision: perf.decision } : null,
      history: readHistory(reportsDir, "report", 10),
    };
    const planPath = join(reportsDir, "plan-input.json");
    writeTextFile(planPath, JSON.stringify(planInput, null, 2));
    console.log(`测试计划数据: ${planPath}（喂给 AI 按 Skill 写测试计划）`);
  }
  try {
    const files = readdirSync(reportsDir).filter((f) => /\.(md|json)$/.test(f) && f !== "index.md");
    fsWriteFileSync(join(reportsDir, "index.md"), renderIndex(reportsDir, files), "utf-8");
    console.log(`索引与历史: ${join(reportsDir, "index.md")} / history.jsonl`);
  } catch {
    // 索引生成失败不影响报告
  }
  console.log();

  // webhook 推送（wecom/dingtalk/raw markdown；失败仅告警）
  if (opts.webhook) {
    try {
      const pushed = await pushWebhook(
        opts.webhook,
        opts["webhook-type"] || "wecom",
        result.pass ? "✅ 测试报告：具备上线条件" : "❌ 测试报告：不具备上线条件",
        [{ name: "上线判定", pass: result.pass, detail: output }],
      );
      console.log(pushed.ok ? `webhook 已推送: ${pushed.status}` : `webhook 推送失败: ${pushed.detail}`);
    } catch (e) {
      console.log(`webhook 推送异常: ${e.message}`);
    }
  }

  if (!result.pass) {
    process.exitCode = 1;
  }
}
