/**
 * report/dimensions.js — 报告维度注册表（新增维度只改本文件）
 *
 * 每个维度声明:
 *   key       — generateReport 的 options 键（也是 CLI --key 参数名）
 *   label     — 报告章节标题
 *   patterns  — test-reports/ 自动发现文件名匹配（按 mtime 取最新）
 *   render(data) — 解析维度结果 → { sections, checks, snapshot } 或 { invalid: "原因" }
 *                 （fail-closed：结构无效时返回 invalid，由聚合层计为未达标项）
 */
import { calculateDI, smokeRatePass } from "../test-codegen.js";
import { parsePlaywrightResults } from "../report-dimensions.js";
import { SMOKE_PASS_RATE, DI_MAX_DENSITY, PERF_P99_SLA, PERF_ERROR_RATE_MAX } from "../shared/thresholds.js";

export const REPORT_DIMENSIONS = [
  {
    key: "api",
    label: "API 接口冒烟",
    patterns: [/^api-result.*\.json$/],
    render(data) {
      const s = data?.summary;
      if (!s) return { invalid: "结果结构无效（缺少 summary）" };
      const sections = [
        `| 指标 | 数值 |`,
        `|------|------|`,
        `| 实体 | ${s.entity || "-"} |`,
        `| 总用例 | ${s.total} |`,
        `| 通过 / 失败 / 错误 / 跳过 | ${s.passed} / ${s.failed} / ${s.errors} / ${s.skipped} |`,
        `| 通过率 | ${s.passRate}% |`,
      ];
      if (s.cleanup) sections.push(`| 数据清理 | 新增 ${s.cleanup.created} 条 / 清理 ${s.cleanup.cleaned} 条${s.cleanup.pending ? "（存在未清理写入）" : ""} |`);
      sections.push(`| 结论 | ${s.decision} |`);
      return {
        sections,
        checks: [{ name: `API 冒烟通过率 ≥ ${SMOKE_PASS_RATE}%`, pass: smokeRatePass(s.passRate), detail: `${s.passRate}%` }],
        snapshot: { api: s.passRate },
      };
    },
  },
  {
    key: "playwright",
    label: "UI 自动化（Playwright）",
    patterns: [/^playwright-result.*\.json$/, /^e2e-result.*\.json$/],
    render(data) {
      const parsed = data ? parsePlaywrightResults(data) : null;
      if (!parsed) return { invalid: "结果结构无效（非 Playwright 原生/汇总格式）" };
      const total = parsed.total;
      const passRate = total > 0 ? Math.round((parsed.passed / total) * 100) : 0;
      const sections = [
        `| 指标 | 数值 |`,
        `|------|------|`,
        `| 总用例 | ${total} |`,
        `| 通过 / 失败 / 跳过 / 不稳定 | ${parsed.passed} / ${parsed.failed} / ${parsed.skipped} / ${parsed.flaky} |`,
        `| 通过率 | ${passRate}% |`,
      ];
      if (parsed.failures.length > 0) {
        sections.push(``, `失败明细（前 10）:`, ``);
        for (const f of parsed.failures.slice(0, 10)) {
          sections.push(`- ✗ ${f.title}: ${String(f.error).replaceAll("\n", " ").slice(0, 120)}`);
        }
      }
      return {
        sections,
        checks: [{ name: `UI 自动化通过率 ≥ ${SMOKE_PASS_RATE}%`, pass: parsed.failed === 0 && smokeRatePass(passRate), detail: `${passRate}%` }],
        snapshot: { ui: passRate },
      };
    },
  },
  {
    key: "jmeter",
    label: "性能测试（JMeter）",
    patterns: [/^perf-result.*\.json$/],
    render(data) {
      const s = data?.summary || data;
      if (!(s && (s.p99 !== undefined || s.samples !== undefined))) {
        return { invalid: "结果结构无效（缺少 samples/p99）" };
      }
      const sections = [
        `| 指标 | 数值 |`,
        `|------|------|`,
        `| 样本数 | ${s.samples ?? "-"} |`,
        `| P50 / P90 / P95 / P99 | ${s.p50 ?? "-"} / ${s.p90 ?? "-"} / ${s.p95 ?? "-"} / ${s.p99 ?? "-"} ms |`,
        `| 吞吐量 | ${s.throughput ?? "-"} req/s |`,
        `| 错误率 | ${s.errorRate ?? "-"}% |`,
        `| SLA | ${s.sla ?? "-"} |`,
        `| 结论 | ${s.decision ?? "-"} |`,
      ];
      return {
        sections,
        checks: [
          { name: `P99 < ${PERF_P99_SLA}ms`, pass: (s.p99 ?? 0) < PERF_P99_SLA, detail: `${s.p99 ?? "-"}ms` },
          { name: `错误率 < ${PERF_ERROR_RATE_MAX}%`, pass: (s.errorRate ?? 0) < PERF_ERROR_RATE_MAX, detail: `${s.errorRate ?? "-"}%` },
        ],
        snapshot: {},
      };
    },
  },
  {
    key: "audit",
    label: "测试代码审计（T1-T25）",
    patterns: [/^audit-result.*\.json$/],
    render(data) {
      if (!(data && data.pass !== undefined)) return { invalid: "结果结构无效（缺少 pass 字段）" };
      const sections = [
        `| 指标 | 数值 |`,
        `|------|------|`,
        `| 致命 / 错误 / 警告 | ${data.bySeverity?.fatal ?? 0} / ${data.bySeverity?.error ?? 0} / ${data.bySeverity?.warning ?? 0} |`,
        `| 违规总数 | ${data.total ?? 0} |`,
        `| 结论 | ${data.pass ? "通过" : `未通过（${data.level ?? "-"}）`} |`,
      ];
      return {
        sections,
        checks: [{ name: "测试代码审计通过", pass: data.pass === true, detail: `fatal=${data.bySeverity?.fatal ?? 0} error=${data.bySeverity?.error ?? 0}` }],
        snapshot: {},
      };
    },
  },
  {
    key: "defects",
    label: "缺陷质量（DI）",
    patterns: [/^defects\.json$/],
    render(data, options) {
      if (!Array.isArray(data)) return { invalid: "数据结构无效（应为缺陷数组）" };
      const di = calculateDI(data, options.cases || 50);
      const sections = [
        `| 指标 | 数值 | 判定 |`,
        `|------|------|------|`,
        `| DI / 密度 | ${di.di} / ${di.diDensity} | ${di.releaseChecks.diDensity.pass ? "✅" : "❌"} |`,
        `| 致命缺陷关闭 | ${di.releaseChecks.fatalClosed.value}/${di.releaseChecks.fatalClosed.required} | ${di.releaseChecks.fatalClosed.pass ? "✅" : "❌"} |`,
        `| 严重缺陷关闭 | ${di.releaseChecks.criticalClosed.value}/${di.releaseChecks.criticalClosed.required} | ${di.releaseChecks.criticalClosed.pass ? "✅" : "❌"} |`,
      ];
      return {
        sections,
        checks: [
          { name: `DI 密度 < ${DI_MAX_DENSITY}`, pass: di.releaseChecks.diDensity.pass, detail: String(di.diDensity) },
          { name: "致命/严重缺陷全部关闭", pass: di.releaseChecks.fatalClosed.pass && di.releaseChecks.criticalClosed.pass, detail: "" },
        ],
        snapshot: {},
      };
    },
  },
];
