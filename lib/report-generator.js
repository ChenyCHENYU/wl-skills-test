/**
 * report-generator.js — 测试报告聚合（对齐规范 10 测试报告模板）
 *
 * 汇聚 run-api / run-playwright / run-jmeter / DI 缺陷 各来源的 JSON 结果，
 * 生成统一的测试报告 Markdown，含上线判定。
 *
 * 用法:
 *   wl-skills-test report --api smoke.json --playwright pw.json --jmeter perf.json --defects defects.json --cases 150
 */

import { readFileSync, existsSync } from "node:fs";
import { calculateDI } from "./test-codegen.js";

/**
 * @param {object} options — { api, playwright, jmeter, defects, cases, output, title }
 * @returns {{ report: string, pass: boolean, decision: string }}
 */
export function generateReport(options = {}) {
  const sections = [];
  const checks = [];

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
    }
  }

  // ── Playwright UI 自动化 ──
  if (options.playwright) {
    const data = asData(options.playwright);
    const stats = data?.stats || data?.summary;
    if (stats) {
      const passed = stats.expected ?? stats.passed ?? 0;
      const failed = stats.unexpected ?? stats.failed ?? 0;
      const skipped = stats.skipped ?? 0;
      const flaky = stats.flaky ?? 0;
      const total = passed + failed + skipped;
      const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
      sections.push("## 二、UI 自动化（Playwright）", "");
      sections.push("| 指标 | 数值 |", "|------|------|");
      sections.push(`| 总用例 | ${total} |`);
      sections.push(`| 通过 / 失败 / 跳过 / 不稳定 | ${passed} / ${failed} / ${skipped} / ${flaky} |`);
      sections.push(`| 通过率 | ${passRate}% |`, "");
      checks.push({ name: "UI 自动化通过率 ≥ 95%", pass: failed === 0 && passRate >= 95, detail: `${passRate}%` });
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

  return {
    report: sections.join("\n"),
    pass: allPass,
    decision: allPass ? "pass" : "blocked",
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
