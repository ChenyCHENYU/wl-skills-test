/**
 * report-dimensions 测试 — 审计/E2E/性能维度报告 + 历史/趋势/索引
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderAuditReport,
  parsePlaywrightResults,
  renderE2eReport,
  renderPerfReport,
  appendHistory,
  readHistory,
  renderTrend,
  renderIndex,
} from "../lib/report-dimensions.js";

const TMP = join(process.cwd(), ".tmp-report-dim");

test("audit 报告渲染：结论/规则分布/明细", () => {
  const result = {
    pass: false,
    level: "error",
    total: 2,
    bySeverity: { fatal: 0, error: 1, warning: 1 },
    findings: [
      { rule: "T3", file: "tests/a.spec.js", severity: "error", message: "1/2 个 test 块缺少 expect 断言" },
      { rule: "T12", file: "tests/b.spec.js", severity: "warning", message: "使用 waitForTimeout 硬等待 2 次" },
    ],
  };
  const md = renderAuditReport(result, "./tests");
  assert.ok(md.includes("未通过"));
  assert.ok(md.includes("规则分布"));
  assert.ok(md.includes("| T3 | error | 1 |"));
  assert.ok(md.includes("tests/a.spec.js"));
  assert.ok(md.includes("fix --target"));
});

test("parsePlaywrightResults: 原生 results.json（嵌套 suites + 失败提取）", () => {
  const native = {
    stats: { expected: 30, unexpected: 2, skipped: 1, flaky: 1, duration: 45000 },
    suites: [
      {
        title: "ROUND1",
        suites: [
          {
            title: "PLBD001",
            specs: [
              {
                title: "验证页面渲染 [PLBD001]",
                tests: [{ results: [{ status: "unexpected", duration: 5000, error: { message: "TimeoutError: page.goto: Timeout 45000ms exceeded.\nCall log..." } }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parsePlaywrightResults(native);
  assert.equal(parsed.format, "playwright-native");
  assert.equal(parsed.passed, 30);
  assert.equal(parsed.failed, 2);
  assert.equal(parsed.total, 33);
  assert.equal(parsed.failures.length, 1);
  assert.ok(parsed.failures[0].title.includes("ROUND1 › PLBD001 › 验证页面渲染"));
  assert.ok(parsed.failures[0].error.includes("TimeoutError"));

  const md = renderE2eReport(parsed, "results.json");
  assert.ok(md.includes("E2E 自动化测试报告"));
  assert.ok(md.includes("未通过"));
  assert.ok(md.includes("失败明细"));
  assert.ok(md.includes("PLBD001"));
});

test("parsePlaywrightResults: run-playwright 汇总格式兼容", () => {
  const parsed = parsePlaywrightResults({ summary: { passed: 20, failed: 0, skipped: 1, flaky: 0, total: 21 } });
  assert.equal(parsed.format, "run-playwright-summary");
  assert.equal(parsed.total, 21);
  const md = renderE2eReport(parsed, "playwright-result.json");
  assert.ok(md.includes("通过"));
});

test("perf 报告渲染：SLA 判定与基线对比指引", () => {
  const md = renderPerfReport({ samples: 1000, p50: 120, p95: 300, p99: 450, errorRate: 0.5, decision: "通过" }, "perf.jmx");
  assert.ok(md.includes("P99<500ms"));
  assert.ok(md.includes("perf-compare"));
  assert.ok(md.includes("1000"));
});

test("history/趋势/索引：追加-读取-渲染闭环", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    appendHistory(TMP, { kind: "report", pass: true, api: 100, ui: 98 });
    appendHistory(TMP, { kind: "report", pass: false, api: 60, ui: 90 });
    const h = readHistory(TMP, "report", 5);
    assert.equal(h.length, 2);
    assert.equal(h[1].api, 60);

    const trend = renderTrend(h);
    assert.ok(trend.includes("运行趋势"));
    assert.ok(trend.includes("| 60"));
    assert.ok(trend.includes("❌"));

    const idx = renderIndex(TMP, ["api-报告.md", "e2e-报告.md", "audit-报告.md", "测试报告.md", "api-result.json"]);
    assert.ok(idx.includes("测试报告索引"));
    assert.ok(idx.includes("[api-报告.md](api-报告.md)"));
    assert.ok(idx.includes("| 接口 |"));
    assert.ok(idx.includes("| E2E/UI |"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
