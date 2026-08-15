/**
 * report-dimensions.js — 各维度专业测试报告渲染（v0.11.0）
 *
 * 统一产出到使用项目的 test-reports/ 目录：
 *   audit-报告.md / e2e-报告.md / perf-报告.md / api-报告.md（cmdRunApi 复用 generateSmokeReport）
 * 加 history.jsonl 运行历史与趋势（report 命令消费）。
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── 审计维度报告 ────────────────────────────────
export function renderAuditReport(auditResult, target) {
  const r = auditResult;
  const lines = [
    `# 测试代码审计报告`,
    ``,
    `> 审计目标: ${target} · 时间: ${new Date().toISOString()} · 规则集: T1-T25`,
    ``,
    `## 结论`,
    ``,
    `${r.pass ? "✅ **通过**" : `❌ **未通过**（${r.level} 级违规存在）`} — fatal=${r.bySeverity.fatal} / error=${r.bySeverity.error} / warning=${r.bySeverity.warning}，共 ${r.total} 项`,
    ``,
    `## 规则分布`,
    ``,
    `| 规则 | 级别 | 数量 | 说明 |`,
    `|------|------|:----:|------|`,
  ];
  const ruleDesc = {};
  for (const f of r.findings) ruleDesc[f.rule] = f.message.split("（")[0];
  const byRule = {};
  for (const f of r.findings) byRule[`${f.rule}|${f.severity}`] = (byRule[`${f.rule}|${f.severity}`] || 0) + 1;
  const keys = Object.keys(byRule).sort();
  if (keys.length === 0) lines.push(`| — | — | 0 | 无违规 |`);
  for (const k of keys) {
    const [rule, sev] = k.split("|");
    lines.push(`| ${rule} | ${sev} | ${byRule[k]} | ${ruleDesc[rule] || ""} |`);
  }
  lines.push(``, `## 文件明细`, ``, `| 文件 | 规则 | 级别 | 说明 |`, `|------|------|------|------|`);
  const files = [...new Set(r.findings.map((f) => f.file))];
  for (const f of r.findings.slice(0, 80)) {
    lines.push(`| ${f.file} | ${f.rule} | ${f.severity} | ${f.message} |`);
  }
  if (files.length > 0) lines.push(``, `涉及文件 ${files.length} 个；修复入口：\`wl-skills-test fix --target ${target}\`（默认预览）`);
  lines.push(``);
  return lines.join("\n");
}

// ── E2E 维度报告（兼容 Playwright 原生 results.json 与 run-playwright 汇总 json）──
export function parsePlaywrightResults(data) {
  // 原生格式：{ stats: {expected, unexpected, skipped, flaky, duration}, suites: 嵌套 }
  if (data?.stats?.expected !== undefined) {
    const failures = [];
    const walk = (suites, parents = []) => {
      for (const s of suites || []) {
        const titles = [...parents, s.title].filter(Boolean);
        for (const sp of s.specs || []) {
          for (const t of sp.tests || []) {
            for (const res of t.results || []) {
              if (res.status === "unexpected") {
                failures.push({
                  title: [...titles, sp.title].join(" › "),
                  error: String(res.error?.message || "").split("\n").slice(0, 3).join(" ⏎ "),
                  duration: res.duration,
                });
              }
            }
          }
        }
        walk(s.suites, titles);
      }
    };
    walk(data.suites);
    return {
      format: "playwright-native",
      passed: data.stats.expected,
      failed: data.stats.unexpected,
      skipped: data.stats.skipped,
      flaky: data.stats.flaky,
      total: (data.stats.expected || 0) + (data.stats.unexpected || 0) + (data.stats.skipped || 0),
      duration: data.stats.duration,
      failures,
    };
  }
  // run-playwright 汇总格式：{ summary: {passed, failed, skipped, flaky, total, passRate} }
  const s = data?.summary || data;
  if (s && (s.passed !== undefined || s.total !== undefined)) {
    const total = s.total ?? (s.passed || 0) + (s.failed || 0) + (s.skipped || 0);
    return {
      format: "run-playwright-summary",
      passed: s.passed ?? s.expected ?? 0,
      failed: s.failed ?? s.unexpected ?? 0,
      skipped: s.skipped ?? 0,
      flaky: s.flaky ?? 0,
      total,
      duration: undefined,
      failures: [],
    };
  }
  return null;
}

export function renderE2eReport(parsed, source) {
  const rate = parsed.total > 0 ? Math.round((parsed.passed / parsed.total) * 100) : 0;
  const lines = [
    `# E2E 自动化测试报告`,
    ``,
    `> 数据源: ${source} · 格式: ${parsed.format} · 时间: ${new Date().toISOString()}`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 总用例 | ${parsed.total} |`,
    `| 通过 / 失败 / 跳过 / 不稳定 | ${parsed.passed} / ${parsed.failed} / ${parsed.skipped} / ${parsed.flaky} |`,
    `| 通过率 | ${rate}% |`,
    parsed.duration !== undefined ? `| 总耗时 | ${Math.round(parsed.duration / 1000)}s |` : "",
    ``,
    `## 结论`,
    ``,
    parsed.failed === 0 && rate >= 95 ? `✅ **通过**（≥95% 且无失败）` : `❌ **未通过**（存在 ${parsed.failed} 个失败 / 通过率 ${rate}%）`,
    ``,
  ].filter((l) => l !== "");
  if (parsed.failures.length > 0) {
    lines.push(`## 失败明细（${parsed.failures.length}）`, ``, `| 用例 | 错误（首行） | 耗时 |`, `|------|------|------|`);
    for (const f of parsed.failures.slice(0, 30)) {
      lines.push(`| ${f.title} | ${f.error.replaceAll("\n", " ").replaceAll("|", "\\|").slice(0, 160)} | ${Math.round(f.duration ?? 0)}ms |`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}

// ── 性能维度报告 ────────────────────────────────
export function renderPerfReport(stats, jmxPath) {
  const lines = [
    `# 性能测试报告`,
    ``,
    `> 脚本: ${jmxPath} · 时间: ${new Date().toISOString()}`,
    ``,
    `| 指标 | 数值 | 判定 |`,
    `|------|------|------|`,
    `| 样本数 | ${stats.samples ?? "-"} | — |`,
    `| P50 / P95 / P99 | ${stats.p50 ?? "-"} / ${stats.p95 ?? "-"} / ${stats.p99 ?? "-"} ms | ${stats.p99 !== undefined ? (stats.p99 < 500 ? "✅ P99<500ms" : stats.p99 < 1000 ? "🟡 峰值放宽" : "❌ 超标") : "—"} |`,
    `| 错误率 | ${stats.errorRate ?? "-"}% | ${(stats.errorRate ?? 0) < 1 ? "✅ <1%" : "❌"} |`,
    `| 结论 | ${stats.decision ?? "-"} | — |`,
    ``,
    `> 基线对比请执行 \`wl-skills-test perf-compare --current <jtl> --baseline <jtl>\`（劣化即非零退出）。`,
    ``,
  ];
  return lines.join("\n");
}

// ── 运行历史（test-reports/history.jsonl，report 消费为趋势）──
export function appendHistory(reportsDir, record) {
  mkdirSync(reportsDir, { recursive: true });
  appendFileSync(
    join(reportsDir, "history.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), ...record }) + "\n",
    "utf-8",
  );
}

export function readHistory(reportsDir, kind, limit = 5) {
  const p = join(reportsDir, "history.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => r.kind === kind)
    .slice(-limit);
}

export function renderTrend(history) {
  if (history.length === 0) return "";
  const lines = [
    `## 运行趋势（最近 ${history.length} 次汇总报告）`,
    ``,
    `| 时间 | 结论 | API 通过率 | UI 通过率 | 冒烟判定 |`,
    `|------|------|-----------|----------|---------|`,
  ];
  for (const h of history) {
    lines.push(`| ${String(h.time).replace("T", " ").slice(0, 16)} | ${h.pass ? "✅" : "❌"} | ${h.api ?? "-"}% | ${h.ui ?? "-"}% | ${h.pass ? "通过" : "阻断"} |`);
  }
  lines.push(``);
  return lines.join("\n");
}

export function renderIndex(reportsDir, files) {
  const lines = [
    `# 测试报告索引`,
    ``,
    `> 目录: ${reportsDir} · 生成时间: ${new Date().toISOString()}`,
    ``,
    `| 报告 | 维度 |`,
    `|------|------|`,
  ];
  const dimOf = (f) =>
    /^api/.test(f) ? "接口" : /^e2e|playwright/.test(f) ? "E2E/UI" : /^perf|jmeter/.test(f) ? "性能" : /^audit/.test(f) ? "审计" : /^gate/.test(f) ? "质量门" : /^测试报告/.test(f) ? "汇总" : /^perf-compare/.test(f) ? "基线对比" : "其他";
  for (const f of files.sort()) lines.push(`| [${f}](${f}) | ${dimOf(f)} |`);
  lines.push(``, `历史明细见 history.jsonl；趋势用 \`wl-skills-test report --trend\`。`, ``);
  return lines.join("\n");
}
