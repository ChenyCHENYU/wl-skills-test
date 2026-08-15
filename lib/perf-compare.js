/**
 * perf-compare.js — 性能基线对比（自动发现劣化）
 *
 * 用法:
 *   wl-skills-test perf-compare --current result.jtl --baseline baseline.jtl
 *   wl-skills-test perf-compare --current result.jtl --baseline baseline.json [--threshold 15]
 *
 * 判定（任一命中即劣化，退出码 1）:
 *   - P50/P95/P99 相对劣化超过阈值（默认 15%）
 *   - 错误率绝对上升超过 1 个百分点
 * 基线可来自 jtl（实时解析）或上次对比导出的 JSON（含 p50/p95/p99/errorRate）。
 */

import { readFileSync, existsSync } from "node:fs";
import { parseJtlResults } from "./executors.js";

/**
 * @param {object} options — { currentPath, baselinePath, threshold }
 * @returns {{regressed: boolean, metrics: Array, markdown: string, summary: object}}
 */
export function perfCompare(options = {}) {
  const { currentPath, baselinePath, threshold = 15 } = options;

  if (!currentPath || !existsSync(currentPath)) {
    return { error: `当前结果文件不存在: ${currentPath}` };
  }
  if (!baselinePath || !existsSync(baselinePath)) {
    return { error: `基线文件不存在: ${baselinePath}` };
  }

  const current = loadMetrics(currentPath);
  const baseline = loadMetrics(baselinePath);

  if (current.error) return current;
  if (baseline.error) return baseline;

  const metrics = [];
  const relDelta = (cur, base) => (base > 0 ? Math.round(((cur - base) / base) * 1000) / 10 : 0);

  for (const key of ["p50", "p95", "p99"]) {
    const delta = relDelta(current[key], baseline[key]);
    metrics.push({
      metric: key,
      baseline: baseline[key],
      current: current[key],
      deltaPct: delta,
      regressed: delta > threshold,
    });
  }

  const errDelta = Math.round((current.errorRate - baseline.errorRate) * 100) / 100;
  metrics.push({
    metric: "errorRate",
    baseline: baseline.errorRate,
    current: current.errorRate,
    deltaPct: errDelta,
    regressed: errDelta > 1,
  });

  const regressed = metrics.some((m) => m.regressed);
  const worst = metrics.filter((m) => m.regressed).map((m) => m.metric);

  return {
    regressed,
    metrics,
    worst,
    summary: {
      verdict: regressed ? `性能劣化（${worst.join(", ")} 超阈值）` : "无劣化（在基线容差内）",
      threshold,
      current: { samples: current.samples, p50: current.p50, p95: current.p95, p99: current.p99, errorRate: current.errorRate },
      baseline: { samples: baseline.samples, p50: baseline.p50, p95: baseline.p95, p99: baseline.p99, errorRate: baseline.errorRate },
    },
    markdown: renderMarkdown(metrics, regressed, worst),
  };
}

function loadMetrics(filePath) {
  if (filePath.endsWith(".jtl")) {
    return parseJtlResults(filePath);
  }
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    // 兼容本工具导出的 summary 结构或扁平结构
    const src = data.summary || data;
    return {
      samples: src.samples || 0,
      p50: src.p50 || 0,
      p95: src.p95 || 0,
      p99: src.p99 || 0,
      errorRate: src.errorRate ?? 0,
    };
  } catch (e) {
    return { error: `基线 JSON 解析失败: ${e.message}` };
  }
}

function renderMarkdown(metrics, regressed, worst) {
  const lines = [
    `# 性能基线对比`,
    ``,
    `## 判定: ${regressed ? "❌ 劣化（" + worst.join(", ") + "）" : "✅ 无劣化"}`,
    ``,
    `| 指标 | 基线 | 当前 | 变化 | 判定 |`,
    `|------|------|------|------|------|`,
  ];
  for (const m of metrics) {
    const unit = m.metric === "errorRate" ? "%" : "ms";
    const deltaText = m.metric === "errorRate" ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}pp` : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`;
    lines.push(`| ${m.metric} | ${m.baseline}${unit} | ${m.current}${unit} | ${deltaText} | ${m.regressed ? "❌ 劣化" : "✅"} |`);
  }
  return lines.join("\n");
}
