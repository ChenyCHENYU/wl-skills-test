/**
 * perf-compare.js — 性能基线对比（自动发现劣化）+ 基线自动管理（v0.18.0）
 *
 * 用法:
 *   wl-skills-test perf-compare --current result.jtl --baseline baseline.jtl
 *   wl-skills-test perf-compare --current result.jtl --auto-baseline          # 首次自动存档，此后自动对比
 *   wl-skills-test perf-compare --current result.jtl --auto-baseline --update-baseline  # 对比后人工确认更新基线
 *
 * 判定（任一命中即劣化，退出码 1）:
 *   - P50/P95/P99 相对劣化超过阈值（默认 15%）
 *   - 错误率绝对上升超过 1 个百分点
 * 基线可来自 jtl（实时解析）/ JSON / --auto-baseline 存档（test-reports/perf-baseline.json）。
 * 基线更新必须显式 --update-baseline（防"慢性漂移"被自动吞掉）。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseJtlResults } from "./executors.js";

/**
 * @param {object} options — { currentPath, baselinePath, threshold, autoBaseline, baselineStorePath, updateBaseline }
 * @returns {Promise<{regressed: boolean, metrics: Array, markdown: string, summary: object}>}
 */
export async function perfCompare(options = {}) {
  const { currentPath, threshold = 15, autoBaseline = false, updateBaseline = false } = options;

  if (!currentPath || !existsSync(currentPath)) {
    return { error: `当前结果文件不存在: ${currentPath}` };
  }

  // ── 基线解析（显式路径 > auto-baseline 存档）──
  const baselineStorePath = options.baselineStorePath || join(dirname(currentPath), "perf-baseline.json");
  let baselinePath = options.baselinePath;
  let baselineCreated = false;
  if (autoBaseline && (!baselinePath || !existsSync(baselinePath))) {
    if (!existsSync(baselineStorePath)) {
      baselineCreated = true; // 首次运行：当前结果存档为基线，不做对比
      baselinePath = null;
    } else {
      baselinePath = baselineStorePath;
    }
  }
  if (!baselineCreated && (!baselinePath || !existsSync(baselinePath))) {
    return { error: `基线文件不存在: ${baselinePath}` };
  }

  const current = await loadMetrics(currentPath);
  if (current.error) return current;

  // 首次 auto-baseline：存档并返回"基线已建立"
  if (baselineCreated) {
    writeBaseline(baselineStorePath, current);
    return {
      regressed: false,
      baselineCreated: true,
      baselineStorePath,
      metrics: [],
      summary: { verdict: `首次运行：当前指标已存档为基线（${baselineStorePath}），下次运行自动对比` },
      markdown: `# 性能基线对比\n\n## 基线已建立\n\n首次运行，当前指标已存档为基线：\n\n| 指标 | 数值 |\n|------|------|\n| 样本 | ${current.samples} |\n| P50/P95/P99 | ${current.p50} / ${current.p95} / ${current.p99} ms |\n| 错误率 | ${current.errorRate}% |\n| 吞吐量 | ${current.throughput ?? "-"} req/s |\n\n下次运行将自动对比；劣化需人工 \`--update-baseline\` 才会更新基线（防慢性漂移被吞）。\n`,
    };
  }

  const baseline = await loadMetrics(baselinePath);
  if (baseline.error) return baseline;

  const metrics = [];
  // 基线为 0/缺失时不得静默判"无劣化"（除零返回 0 的假阴性）：
  //   缺失指标 → 报错阻断；基线为 0 且当前 > 0 → 直接判劣化
  for (const key of ["p50", "p95", "p99"]) {
    if (baseline[key] === undefined || baseline[key] === null) {
      return { error: `基线缺少 ${key} 指标（基线文件无效或数据不完整）` };
    }
  }
  const relDelta = (cur, base) => {
    if (base > 0) return Math.round(((cur - base) / base) * 1000) / 10;
    return cur > 0 ? Number.POSITIVE_INFINITY : 0;
  };

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

  // 显式确认后才更新基线存档（--update-baseline；防基线慢性漂移被自动吞掉）
  let baselineUpdated;
  if (updateBaseline && autoBaseline) {
    writeBaseline(baselineStorePath, current);
    baselineUpdated = true;
  }

  return {
    regressed,
    metrics,
    worst,
    baselineUpdated,
    baselineStorePath: autoBaseline ? baselineStorePath : undefined,
    summary: {
      verdict: regressed ? `性能劣化（${worst.join(", ")} 超阈值）` : "无劣化（在基线容差内）",
      threshold,
      current: { samples: current.samples, p50: current.p50, p90: current.p90, p95: current.p95, p99: current.p99, errorRate: current.errorRate, throughput: current.throughput },
      baseline: { samples: baseline.samples, p50: baseline.p50, p95: baseline.p95, p99: baseline.p99, errorRate: baseline.errorRate },
    },
    markdown: renderMarkdown(metrics, regressed, worst),
  };
}

function writeBaseline(storePath, metrics) {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        summary: {
          samples: metrics.samples,
          p50: metrics.p50,
          p90: metrics.p90,
          p95: metrics.p95,
          p99: metrics.p99,
          errorRate: metrics.errorRate,
          throughput: metrics.throughput,
        },
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function loadMetrics(filePath) {
  if (filePath.endsWith(".jtl")) {
    return parseJtlResults(filePath);
  }
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    // 兼容本工具导出的 summary 结构或扁平结构（缺失指标保持 undefined，由调用方校验）
    const src = data.summary || data;
    return {
      samples: src.samples || 0,
      p50: src.p50,
      p95: src.p95,
      p99: src.p99,
      errorRate: src.errorRate ?? 0,
    };
  } catch (e) {
    return { error: `指标 JSON 解析失败（${filePath}）: ${e.message}` };
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
    const deltaText =
      m.deltaPct === Number.POSITIVE_INFINITY
        ? "基线为 0"
        : m.metric === "errorRate"
          ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}pp`
          : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`;
    lines.push(`| ${m.metric} | ${m.baseline}${unit} | ${m.current}${unit} | ${deltaText} | ${m.regressed ? "❌ 劣化" : "✅"} |`);
  }
  return lines.join("\n");
}
