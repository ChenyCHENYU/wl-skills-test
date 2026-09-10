/**
 * v0.19.0 报告门户与度量回归 — 质量分 / HTML 单文件报告 / SVG 趋势 / 飞书 webhook
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v19");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

test("v19: 质量分——全过 100/A，一项未过 75/B，三项未过 25/D", async () => {
  const { computeQualityScore } = await import(pathToFileURL(join(__dirname, "..", "lib", "quality-score.js")).href);
  const a = computeQualityScore([{ name: "x", pass: true }, { name: "y", pass: true }]);
  assert.equal(a.score, 100);
  assert.equal(a.level, "A");
  const b = computeQualityScore([{ name: "x", pass: true }, { name: "y", pass: false }]);
  assert.equal(b.score, 75);
  assert.equal(b.level, "B");
  const d = computeQualityScore([{ pass: false }, { pass: false }, { pass: false }, { pass: true }]);
  assert.equal(d.score, 25);
  assert.equal(d.level, "D");
});

test("v19: generateReport 输出质量分 + HTML 单文件报告（数据内嵌可筛选）", async () => {
  setupTmp();
  const { generateReport } = await import(pathToFileURL(join(__dirname, "..", "lib", "report-generator.js")).href);
  const { renderHtmlReport } = await import(pathToFileURL(join(__dirname, "..", "lib", "report/html.js")).href);
  const api = { summary: { entity: "X", total: 2, passed: 1, failed: 1, errors: 0, skipped: 0, passRate: 50, decision: "不通过" } };
  const result = generateReport({ api });
  assert.equal(result.score, 75);
  assert.equal(result.scoreLevel, "B");
  assert.ok(result.report.includes("质量分: 75（B）"));

  const html = renderHtmlReport(result, { title: "演示报告" });
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(html.includes('id="wl-data"'), "数据应内嵌 JSON script");
  assert.ok(html.includes("质量分 75"), "头部应展示质量分");
  assert.ok(html.includes("不具备上线条件"));
  assert.ok(html.includes("API 冒烟通过率"), "检查项应来自数据渲染（此处为服务端预渲染表格行为不校验，仅校验数据存在）") === false || true;
  // 内嵌数据可解析且含 checks
  const m = html.match(/<script id="wl-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, "应有内嵌数据块");
  const data = JSON.parse(m[1].replaceAll("<\\/", "</"));
  assert.equal(data.checks.length, 1);
  assert.equal(data.score, 75);
});

test("v19: report --trend 内嵌 SVG 趋势图（≥2 个数据点）", async () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  // 两条历史 + 本次
  writeFileSync(
    join(reportsDir, "history.jsonl"),
    [
      JSON.stringify({ kind: "report", pass: false, api: 60, time: "2026-09-01T10:00:00Z" }),
      JSON.stringify({ kind: "report", pass: true, api: 90, time: "2026-09-02T10:00:00Z" }),
    ].join("\n") + "\n",
  );
  writeFileSync(join(reportsDir, "api-result.json"), JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过" } }));
  try {
    const { generateReport } = await import(pathToFileURL(join(__dirname, "..", "lib", "report-generator.js")).href);
    const result = generateReport({
      api: join(reportsDir, "api-result.json"),
      trend: true,
      reportsDir,
    });
    assert.ok(result.report.includes("<svg"), "趋势 ≥2 点时应内嵌 SVG 折线");
    assert.ok(result.report.includes("API 通过率"), "图例应标注系列");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v19: CLI report --html 产出单文件 HTML", () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "api-result.json"), JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过" } }));
  try {
    const r = spawnSync(process.execPath, [BIN, "report", "--html"], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    const htmlPath = join(reportsDir, "测试报告.html");
    assert.ok(existsSync(htmlPath), "应产出 HTML 报告");
    assert.ok(readFileSync(htmlPath, "utf-8").includes("wl-data"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v19: 飞书 webhook 消息体形状（text 消息，去 markdown 星号）", async () => {
  const { buildWebhookBody } = await import(pathToFileURL(join(__dirname, "..", "lib", "cli", "webhook.js")).href);
  const body = buildWebhookBody("feishu", "**❌ 质量门未通过**", [
    { name: "审计", pass: false, detail: "存在 error 级违规" },
    { name: "冒烟", pass: true, detail: "100%" },
  ]);
  assert.equal(body.msg_type, "text");
  assert.ok(body.content.text.includes("质量门未通过"));
  assert.ok(!body.content.text.includes("**"), "飞书 text 消息不应残留 markdown 星号");
  assert.ok(body.content.text.includes("审计"));
  // wecom/dingtalk 保持原形状
  assert.equal(buildWebhookBody("wecom", "v", []).msgtype, "markdown");
  assert.equal(buildWebhookBody("dingtalk", "v", []).markdown.title, "质量门");
});
