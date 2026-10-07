/**
 * report-generator.js — 测试报告聚合（对齐规范 10 测试报告模板）
 *
 * 维度逻辑在 lib/report/dimensions.js 注册表（新增维度只改那个文件），
 * 本模块只负责：来源读取（fail-closed）→ 逐维度渲染 → 上线判定 → 趋势。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { renderTrend, readHistory, renderTrendSvg } from "./report-dimensions.js";
import { REPORT_DIMENSIONS } from "./report/dimensions.js";
import protocol from "./task-observability.cjs";
import { PKG } from "./cli/context.js";
import { domainResultHash } from "./observed-execution.js";
import { computeQualityScore } from "./quality-score.js";

const SECTION_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** Discover one correlated run; never select individual dimensions by mtime. */
export function discoverDimensionResults(reportsDir, { runId, allowLegacy = false } = {}) {
  if (!existsSync(reportsDir)) return {};
  if (runId && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(runId)) return { error: "Invalid report runId" };
  const directories = [reportsDir];
  const runs = join(reportsDir, "runs");
  if (existsSync(runs)) for (const name of readdirSync(runs).sort()) {
    const dir = join(runs, name);
    if (statSync(dir).isDirectory() && (!runId || name === runId)) directories.push(dir);
  }
  const groups = new Map();
  for (const directory of directories) for (const file of readdirSync(directory).sort()) {
    const dimension = REPORT_DIMENSIONS.find(dim => dim.patterns.some(pattern => pattern.test(file)));
    if (!dimension) continue;
    const full = join(directory, file), { data } = asData(full);
    const id = data?.runId || data?.provenance?.runId || null;
    if (runId && id !== runId) continue;
    if (!id && !allowLegacy) continue;
    const key = id || "legacy";
    if (!groups.has(key)) groups.set(key, {});
    const existing = groups.get(key)[dimension.key];
    const previous = existing ? asData(existing).data : null;
    const semanticHash = value => domainResultHash(value?.provenance?.tool === 'run-jmeter' ? value.summary : value || {});
    if (existing && (semanticHash(previous) !== semanticHash(data) || previous?.execution?.recordPath !== data?.execution?.recordPath)) return { error: `同一 runId ${key} 的 ${dimension.key} 结果存在多个不同版本，请显式指定来源。` };
    groups.get(key)[dimension.key] = full;
  }
  if (groups.size > 1) return { error: "存在多个任务 runId，请用 --run-id 明确选择；不能按文件时间拼接维度。" };
  return groups.values().next().value || {};
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
  const sourceIds = [...new Set(REPORT_DIMENSIONS.map(dim => asData(options[dim.key] || {}).data).map(data => data?.runId || data?.provenance?.runId).filter(Boolean))];
  if (sourceIds.length > 1 || (options.runId && sourceIds.some(id => id !== options.runId))) return { error: "报告结果属于不同 runId；拒绝拼接跨任务证据。" };
  const runId = options.runId || sourceIds[0] || null;
  let unverifiedSources = [], partialSources = [];


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
    const sourceId = data?.runId || data?.provenance?.runId;
    if (!sourceId || sourceId !== runId || !data?.execution?.recordPath || !data?.provenance?.sourceHash) {
      unverifiedSources.push(dim.key);
    } else {
      try {
        const projectRoot = resolve(options.projectRoot || process.cwd());
        const receiptPath = resolve(projectRoot, data.execution.recordPath);
        if (!receiptPath.startsWith(projectRoot + sep)) throw new Error('receipt outside project');
        const record = JSON.parse(readFileSync(receiptPath, 'utf8'));
        const payload = data.provenance.tool === 'run-jmeter' ? data.summary : data;
        const same = record.kind === 'tool-finished' && record.packageName === '@agile-team/wl-skills-test' && record.runId === runId && record.tool === data.provenance.tool && record.inputSnapshot.sha256 === data.provenance.sourceHash && record.summary.resultHash === domainResultHash(payload);
        if (!same) throw new Error('result/receipt provenance mismatch');
        const status = protocol.readStatus({ projectRoot, packageName: PKG.name, packageVersion: PKG.version, runId });
        const current = status.tools.some(tool => tool.eventId === record.eventId);
        const fresh = [record.inputSnapshot, record.ruleSnapshot, record.configSnapshot].filter(Boolean).every(snapshot => protocol.captureSnapshot({ projectRoot, targets: snapshot.targets }).sha256 === snapshot.sha256);
        if (!current || !fresh || record.validationStatus !== 'passed' || status.stale || status.outdatedChecker || status.planStale || status.pendingChecks.length || status.unresolvedDecision || status.scopeGaps?.length || status.validationStatus !== 'passed' || status.executionStatus === 'running') partialSources.push(dim.key);
      } catch { unverifiedSources.push(dim.key); }
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
  const domainPass = checks.every((c) => c.pass);
  const correlated = Boolean(runId) && !unverifiedSources.length;
  if (options.strictCorrelation && !correlated && !options.allowLegacy) return { error: "结果缺少同 runId 的执行回执/来源哈希；请重新执行并传 --run-id，旧结果仅可 --allow-legacy 导入诊断。" };
  const validationStatus = !domainPass ? "failed" : !correlated ? "unverified" : partialSources.length ? "partial" : "passed";
  const allPass = domainPass && validationStatus === "passed";
  sections.push(`## ${SECTION_NUMERALS[sectionNo++] ?? sectionNo}、上线判定`, "");
  sections.push("| 检查项 | 判定 | 详情 |", "|--------|------|------|");
  for (const c of checks) {
    sections.push(`| ${c.name} | ${c.pass ? "✅ 通过" : "❌ 未通过"} | ${c.detail} |`);
  }
  sections.push("");
  if (sourceErrors.length > 0) {
    sections.push(`> ⚠️ 部分结果来源不可读（fail-closed，已计入未达标项）: ${sourceErrors.join("；")}`, "");
  }
  if (validationStatus === 'unverified' || validationStatus === 'partial') sections.push(`> 来源检查${domainPass ? '达标' : '存在失败'}，但任务验证为 ${validationStatus}。缺少证据: ${unverifiedSources.join(', ') || partialSources.join(', ')}；本报告不能证明整项任务已通过。`, "");
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
    runId, correlated, validationStatus, domainPass, unverifiedSources, partialSources,
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
