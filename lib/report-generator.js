/**
 * report-generator.js — 测试报告聚合（对齐规范 10 测试报告模板）
 *
 * 维度逻辑在 lib/report/dimensions.js 注册表（新增维度只改那个文件），
 * 本模块只负责：来源读取（fail-closed）→ 逐维度渲染 → 上线判定 → 趋势。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderTrend, readHistory, renderTrendSvg } from "./report-dimensions.js";
import { REPORT_DIMENSIONS } from "./report/dimensions.js";
import { computeQualityScore } from "./quality-score.js";

const SECTION_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

/**
 * 自动发现 test-reports/ 下的最新维度结果
 * 约定见 REPORT_DIMENSIONS[].patterns；"最新"按 mtime 判定（字典序会让 result-10 排在 result-2 之前）
 */
export function discoverDimensionResults(reportsDir) {
  if (!existsSync(reportsDir)) return {};
  const files = readdirSync(reportsDir);
  const mtimeOf = (f) => {
    try {
      return statSync(join(reportsDir, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const pick = (patterns) => {
    const hit = files.filter((f) => patterns.some((p) => p.test(f)));
    return hit.length > 0 ? join(reportsDir, hit.reduce((a, b) => (mtimeOf(b) >= mtimeOf(a) ? b : a))) : null;
  };
  const found = {};
  for (const dim of REPORT_DIMENSIONS) {
    const hit = pick(dim.patterns);
    if (hit) found[dim.key] = hit;
  }
  return found;
}

/**
 * @param {object} options — { api, playwright, jmeter, audit, defects, cases, title, trend, reportsDir }
 * @returns {{ report: string, pass: boolean, decision: string }}
 */
export function generateReport(options = {}) {
  const sections = [];
  const checks = [];
  const snapshot = {};
  const sourceErrors = [];
  let sectionNo = 0;

  sections.push(`# ${options.title || "测试报告"}`);
  sections.push("");
  sections.push(`> 生成时间: ${new Date().toISOString()}`);
  sections.push("");

  // fail-closed：任一来源文件存在但不可读/不可解析 → 记失败检查项，绝不静默丢弃维度
  for (const dim of REPORT_DIMENSIONS) {
    const source = options[dim.key];
    if (!source) continue;
    const { data, error } = asData(source);
    if (error) {
      sourceErrors.push(`${dim.key}: ${error}`);
      checks.push({ name: `${dim.label} 结果可读`, pass: false, detail: error });
      continue;
    }
    const rendered = dim.render(data, options);
    if (rendered.invalid) {
      sourceErrors.push(`${dim.key}: ${rendered.invalid}`);
      checks.push({ name: `${dim.label} 结果可读`, pass: false, detail: rendered.invalid });
      continue;
    }
    sections.push(`## ${SECTION_NUMERALS[sectionNo++] ?? sectionNo}、${dim.label}`, "");
    sections.push(...rendered.sections, "");
    checks.push(...rendered.checks);
    Object.assign(snapshot, rendered.snapshot);
  }

  if (checks.length === 0) {
    return { error: "未提供任何有效结果来源（--api/--playwright/--jmeter/--audit/--defects）" };
  }

  // ── 汇总判定 ──
  const allPass = checks.every((c) => c.pass);
  sections.push(`## ${SECTION_NUMERALS[sectionNo++] ?? sectionNo}、上线判定`, "");
  sections.push("| 检查项 | 判定 | 详情 |", "|--------|------|------|");
  for (const c of checks) {
    sections.push(`| ${c.name} | ${c.pass ? "✅ 通过" : "❌ 未通过"} | ${c.detail} |`);
  }
  sections.push("");
  if (sourceErrors.length > 0) {
    sections.push(`> ⚠️ 部分结果来源不可读（fail-closed，已计入未达标项）: ${sourceErrors.join("；")}`, "");
  }
  sections.push(`**结论: ${allPass ? "✅ 具备上线条件" : "❌ 不具备上线条件（存在未达标项）"}**`, "");

  // 质量分（单一数字 + 等级，管理层/趋势用）
  const score = computeQualityScore(checks);
  if (score.score !== null) {
    sections.push(``, `**质量分: ${score.score}（${score.level}）** — ${score.hint}`, "");
  }

  // 历史趋势（--trend，读 reportsDir/history.jsonl 中既往汇总记录，不含本次）
  if (options.trend && options.reportsDir) {
    const history = readHistory(options.reportsDir, "report", 5);
    if (history.length > 0) {
      sections.push(renderTrend(history));
      // SVG 趋势图（≥2 个数据点才有折线意义；本次点一并绘入）
      const series = [...history, { time: new Date().toISOString(), api: snapshot.api, ui: snapshot.ui }].filter(
        (h) => h.api !== undefined || h.ui !== undefined,
      );
      if (series.length >= 2) {
        const svg = renderTrendSvg(series);
        if (svg) sections.push(svg);
      }
    }
  }

  return {
    report: sections.join("\n"),
    pass: allPass,
    decision: allPass ? "pass" : "blocked",
    checks,
    snapshot,
    score: score.score,
    scoreLevel: score.level,
    sourceErrors,
  };
}

// 值可能是文件路径（CLI）或内联对象/数组（MCP）；文件存在但不可解析时返回错误（fail-closed）
function asData(value) {
  if (value && typeof value === "object") return { data: value };
  const p = String(value);
  if (!existsSync(p)) return { error: `文件不存在: ${p}` };
  try {
    // 剥离 UTF-8 BOM（Windows 记事本/PowerShell 常见）
    const text = readFileSync(p, "utf-8").replace(/^\uFEFF/, "");
    return { data: JSON.parse(text) };
  } catch (e) {
    return { error: `JSON 解析失败: ${e.message}` };
  }
}
