/**
 * report-generator 测试 — 多来源聚合与上线判定
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateReport, discoverDimensionResults } from "../lib/report-generator.js";
import { appendHistory } from "../lib/report-dimensions.js";

const TMP = join(process.cwd(), ".tmp-report");

const API_JSON = {
  summary: { entity: "SaleOrder", total: 10, passed: 10, failed: 0, errors: 0, skipped: 2, passRate: 100, decision: "通过（可转测）", cleanup: { created: 2, cleaned: 2 } },
  results: [],
};

const PW_JSON = { summary: { passed: 20, failed: 0, skipped: 1, flaky: 0, total: 21, passRate: 95 } };

const JM_JSON = { summary: { samples: 1000, passed: 995, failed: 5, errorRate: 0.5, p50: 120, p95: 300, p99: 450, sla: "达标", decision: "通过" } };

test("report: 全来源达标 → 具备上线条件", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const api = join(TMP, "api.json");
    const pw = join(TMP, "pw.json");
    const jm = join(TMP, "jm.json");
    const defects = join(TMP, "defects.json");
    writeFileSync(api, JSON.stringify(API_JSON));
    writeFileSync(pw, JSON.stringify(PW_JSON));
    writeFileSync(jm, JSON.stringify(JM_JSON));
    writeFileSync(defects, JSON.stringify([{ severity: "minor", status: "closed", module: "order" }]));

    const result = generateReport({ api, playwright: pw, jmeter: jm, defects, cases: 100 });
    assert.equal(result.error, undefined);
    assert.equal(result.pass, true);
    assert.equal(result.decision, "pass");
    assert.ok(result.report.includes("具备上线条件"));
    assert.ok(result.report.includes("API 接口冒烟"));
    assert.ok(result.report.includes("Playwright"));
    assert.ok(result.report.includes("JMeter"));
    assert.ok(result.report.includes("缺陷质量"));
    assert.ok(result.report.includes("上线判定"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("report: 任一来源不达标 → 不具备上线条件", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const api = join(TMP, "api.json");
    writeFileSync(api, JSON.stringify({ summary: { ...API_JSON.summary, passRate: 60, failed: 4 } }));
    const result = generateReport({ api });
    assert.equal(result.pass, false);
    assert.ok(result.report.includes("不具备上线条件"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("report: DI 密度超标阻断", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const defects = join(TMP, "defects.json");
    // DI = 10*1 + 3*2 = 16，cases=20 → 密度 0.8 > 0.3
    writeFileSync(defects, JSON.stringify([
      { severity: "fatal", status: "closed", module: "a" },
      { severity: "critical", status: "closed", module: "a" },
      { severity: "critical", status: "closed", module: "b" },
    ]));
    const result = generateReport({ defects, cases: 20 });
    assert.equal(result.pass, false);
    assert.ok(result.report.includes("DI 密度"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("report: MCP 内联对象（非文件路径）", () => {
  const result = generateReport({ api: API_JSON });
  assert.equal(result.error, undefined);
  assert.ok(result.report.includes("SaleOrder"));
});

test("report: 无有效来源返回错误", () => {
  const result = generateReport({});
  assert.ok(result.error);
});

// ── v0.11.0: 自动发现 / 趋势 / 快照 ──

test("report: 自动发现 test-reports/ 维度结果", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    writeFileSync(join(TMP, "api-result.json"), JSON.stringify(API_JSON));
    writeFileSync(join(TMP, "playwright-result.json"), JSON.stringify({ summary: { passed: 10, failed: 0, skipped: 0, total: 10 } }));
    writeFileSync(join(TMP, "defects.json"), JSON.stringify([{ severity: "minor", status: "closed", module: "a" }]));
    const found = discoverDimensionResults(TMP);
    assert.ok(found.api.endsWith("api-result.json"));
    assert.ok(found.playwright.endsWith("playwright-result.json"));
    assert.ok(found.defects.endsWith("defects.json"));
    assert.equal(found.jmeter, undefined, "无性能结果不应出现");

    // 端到端：发现的结果直接喂 generateReport
    const result = generateReport({ api: found.api, playwright: found.playwright, defects: found.defects, cases: 100 });
    assert.equal(result.pass, true);
    assert.equal(result.snapshot.api, 100);
    assert.equal(result.snapshot.ui, 100);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("report: --trend 渲染历史趋势", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    // 先写两份历史
    appendHistory(TMP, { kind: "report", pass: true, api: 100, ui: 98 });
    appendHistory(TMP, { kind: "report", pass: false, api: 70, ui: 90 });
    const result = generateReport({ api: API_JSON, trend: true, reportsDir: TMP });
    assert.ok(result.report.includes("运行趋势"), "应含趋势章节");
    assert.ok(result.report.includes("| 70"), "应含历史 API 通过率");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
