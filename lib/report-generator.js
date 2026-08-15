/**
 * report-generator.js — 测试报告聚合（对齐规范 10 测试报告模板）
 *
 * 汇聚 run-api / run-playwright / run-jmeter / DI 缺陷 各来源的 JSON 结果，
 * 生成统一的测试报告 Markdown，含上线判定。
 *
 * 用法:
 *   wl-skills-test report --api smoke.json --playwright pw.json --jmeter perf.json --defects defects.json --cases 150
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { calculateDI } from "./test-codegen.js";
import { parsePlaywrightResults, renderTrend, readHistory } from "./report-dimensions.js";

/**
 * 自动发现 test-reports/ 下的最新维度结果（v0.11.0）
 * 约定: api-result.json / playwright-result.json | e2e-result.json / perf-result.json / defects.json
 */
export function discoverDimensionResults(reportsDir) {
  if (!existsSync(reportsDir)) return {};
  const found = {};
  const files = readdirSync(reportsDir);
  const pick = (patterns) => {
    const hit = files.filter((f) => patterns.some((p) => p.test(f)));
    return hit.length > 0 ? join(reportsDir, hit.sort().pop()) : null;
  };
  found.api = pick([/^api-result.*\.json$/]);
  found.playwright = pick([/^playwright-result.*\.json$/, /^e2e-result.*\.json$/]);
  found.jmeter = pick([/^perf-result.*\.json$/]);
  found.defects = pick([/^defects\.json$/]);
  return Object.fromEntries(Object.entries(found).filter(([, v]) => v));
}

/**
 * @param {object} options — { api, playwright, jmeter, defects, cases, output, title }
 * @returns {{ report: string, pass: boolean, decision: string }}
 */
export function generateReport(options = {}) {
  const sections = [];
  const checks = [];
  let apiRateSnapshot;
  let uiRateSnapshot;

  sections.push(`# ${options.title || "测试报告"}`);
  sections.push("");
  sections.push(`> 生成时间: ${new Date().toISOString()}`);
  sections.push("");

  // ── API 冒烟 ──
  if (options.api) {
    const data = asData(options.api);
    if (data?.summary) {
      const s = data.summary;
      sections.push("## 一、API 接口冒烟", "");
      sections.push("| 指标 | 数值 |", "|------|------|");
      sections.push(`| 实体 | ${s.entity || "-"} |`);
      sections.push(`| 总用例 | ${s.total} |`);
      sections.push(`| 通过 / 失败 / 错误 / 跳过 | ${s.passed} / ${s.failed} / ${s.errors} / ${s.skipped} |`);
      sections.push(`| 通过率 | ${s.passRate}% |`);
      if (s.cleanup) sections.push(`| 数据清理 | 新增 ${s.cleanup.created} 条 / 清理 ${s.cleanup.cleaned} 条 |`);
      sections.push(`| 结论 | ${s.decision} |`, "");
      checks.push({ name: "API 冒烟通过率 ≥ 95%", pass: s.passRate >= 95, detail: `${s.passRate}%` });
      apiRateSnapshot = s.passRate;
    }
  }

  // ── Playwright UI 自动化（兼容原生 results.json 与汇总 json）──
  if (options.playwright) {
    const data = asData(options.playwright);
    const parsed = data ? parsePlaywrightResults(data) : null;
    if (parsed) {
      const passed = parsed.passed;
      const failed = parsed.failed;
      const skipped = parsed.skipped;
      const flaky = parsed.flaky;
      const total = parsed.total;
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
      sections.push("## 二、UI 自动化（Playwright）", "");
      sections.push("| 指标 | 数值 |", "|------|------|");
      sections.push(`| 总用例 | ${total} |`);
      sections.push(`| 通过 / 失败 / 跳过 / 不稳定 | ${passed} / ${failed} / ${skipped} / ${flaky} |`);
      sections.push(`| 通过率 | ${passRate}% |`, "");
      checks.push({ name: "UI 自动化通过率 ≥ 95%", pass: failed === 0 && passRate >= 95, detail: `${passRate}%` });
      uiRateSnapshot = passRate;
      if (parsed.failures.length > 0) {
        sections.push(`失败明细（前 10）:`, "");
        for (const f of parsed.failures.slice(0, 10)) {
          sections.push(`- ✗ ${f.title}: ${f.error.replaceAll("\n", " ").slice(0, 120)}`);
        }
        sections.push("");
      }
    }
  }

  // ── JMeter 性能 ──
  if (options.jmeter) {
    const data = asData(options.jmeter);
    const s = data?.summary || data;
    if (s && (s.p99 !== undefined || s.samples !== undefined)) {
      sections.push("## 三、性能测试（JMeter）", "");
      sections.push("| 指标 | 数值 |", "|------|------|");
      sections.push(`| 样本数 | ${s.samples ?? "-"} |`);
      sections.push(`| P50 / P95 / P99 | ${s.p50 ?? "-"} / ${s.p95 ?? "-"} / ${s.p99 ?? "-"} ms |`);
      sections.push(`| 错误率 | ${s.errorRate ?? "-"}% |`);
      sections.push(`| SLA | ${s.sla ?? "-"} |`);
      sections.push(`| 结论 | ${s.decision ?? "-"} |`, "");
      checks.push({ name: "P99 < 500ms", pass: (s.p99 ?? 0) < 500, detail: `${s.p99 ?? "-"}ms` });
      checks.push({ name: "错误率 < 1%", pass: (s.errorRate ?? 0) < 1, detail: `${s.errorRate ?? "-"}%` });
    }
  }

  // ── DI 缺陷质量 ──
  if (options.defects) {
    const defects = asData(options.defects);
    if (Array.isArray(defects)) {
      const di = calculateDI(defects, options.cases || 50);
      sections.push("## 四、缺陷质量（DI）", "");
      sections.push("| 指标 | 数值 | 判定 |", "|------|------|------|");
      sections.push(`| DI / 密度 | ${di.di} / ${di.diDensity} | ${di.releaseChecks.diDensity.pass ? "✅" : "❌"} |`);
      sections.push(`| 致命缺陷关闭 | ${di.releaseChecks.fatalClosed.value}/${di.releaseChecks.fatalClosed.required} | ${di.releaseChecks.fatalClosed.pass ? "✅" : "❌"} |`);
      sections.push(`| 严重缺陷关闭 | ${di.releaseChecks.criticalClosed.value}/${di.releaseChecks.criticalClosed.required} | ${di.releaseChecks.criticalClosed.pass ? "✅" : "❌"} |`, "");
      checks.push({ name: "DI 密度 < 0.3", pass: di.releaseChecks.diDensity.pass, detail: String(di.diDensity) });
      checks.push({ name: "致命/严重缺陷全部关闭", pass: di.releaseChecks.fatalClosed.pass && di.releaseChecks.criticalClosed.pass, detail: "" });
    }
  }

  if (checks.length === 0) {
    return { error: "未提供任何有效结果来源（--api/--playwright/--jmeter/--defects）" };
  }

  // ── 汇总判定 ──
  const allPass = checks.every((c) => c.pass);
  sections.push("## 五、上线判定", "");
  sections.push("| 检查项 | 判定 | 详情 |", "|--------|------|------|");
  for (const c of checks) {
    sections.push(`| ${c.name} | ${c.pass ? "✅ 通过" : "❌ 未通过"} | ${c.detail} |`);
  }
  sections.push("");
  sections.push(`**结论: ${allPass ? "✅ 具备上线条件" : "❌ 不具备上线条件（存在未达标项）"}**`, "");

  // 历史趋势（--trend，读 reportsDir/history.jsonl 中既往汇总记录，不含本次）
  if (options.trend && options.reportsDir) {
    const history = readHistory(options.reportsDir, "report", 5);
    if (history.length > 0) sections.push(renderTrend(history));
  }

  return {
    report: sections.join("\n"),
    pass: allPass,
    decision: allPass ? "pass" : "blocked",
    snapshot: { api: apiRateSnapshot, ui: uiRateSnapshot },
  };
}

// 值可能是文件路径（CLI）或内联对象/数组（MCP）
function asData(value) {
  if (value && typeof value === "object") return value;
  return readJson(String(value));
}

function readJson(p) {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}
