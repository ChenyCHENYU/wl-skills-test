/** Validate actual sample counts before consuming a smoke report's claimed pass rate. */
export function smokeEvidence(data) {
  const summary = data?.summary ?? data;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return { error: "冒烟结果缺少执行摘要" };
  const counts = Object.fromEntries(["total", "passed", "failed", "errors", "skipped"].map(key => [key, summary[key] ?? (key === "errors" || key === "skipped" ? 0 : undefined)]));
  if (Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) return { error: "冒烟结果需要非负整数 total/passed/failed/errors/skipped，不能仅提供通过率" };
  if (counts.total !== counts.passed + counts.failed + counts.errors + counts.skipped) return { error: "冒烟执行计数互相冲突" };
  const executed = counts.total - counts.skipped;
  if (!executed) return { error: "冒烟没有实际执行样本，不能判定通过" };
  const rate = Math.round(counts.passed / executed * 100);
  if (!Number.isFinite(summary.passRate) || summary.passRate < 0 || summary.passRate > 100 || summary.passRate !== rate) return { error: "冒烟通过率与实际执行计数不一致" };
  if (summary.pass !== undefined && typeof summary.pass !== "boolean") return { error: "冒烟 pass 必须为布尔值" };
  if (summary.assertions !== undefined && (!summary.assertions || !Number.isSafeInteger(summary.assertions.total)
    || !Number.isSafeInteger(summary.assertions.failed) || summary.assertions.failed < 0 || summary.assertions.total < summary.assertions.failed
    || summary.assertions.total < 1)) return { error: "冒烟断言计数无效或没有实际断言" };
  if (summary.cleanup !== undefined && (!summary.cleanup || !Number.isSafeInteger(summary.cleanup.created)
    || !Number.isSafeInteger(summary.cleanup.cleaned) || summary.cleanup.cleaned < 0 || summary.cleanup.created < summary.cleanup.cleaned)) return { error: "冒烟清理计数无效" };
  if (data.results !== undefined) {
    if (!Array.isArray(data.results) || data.results.length !== counts.total) return { error: "冒烟执行明细与摘要总数不一致" };
    const actual = { passed: 0, failed: 0, errors: 0, skipped: 0 };
    const statuses = { pass: "passed", warn: "passed", fail: "failed", error: "errors", skip: "skipped" };
    for (const result of data.results) {
      const key = statuses[result?.status];
      if (!key) return { error: "冒烟执行明细包含未知状态" };
      actual[key]++;
    }
    if (Object.entries(actual).some(([key, value]) => value !== counts[key])) return { error: "冒烟执行明细与摘要计数冲突" };
  }
  const failedAssertions = summary.assertions?.failed;
  const cleanup = summary.cleanup;
  const pass = counts.passed > 0 && counts.failed === 0 && counts.errors === 0 && summary.pass !== false
    && !(failedAssertions > 0) && cleanup?.pending !== true && !(cleanup?.created > (cleanup?.cleaned ?? 0))
    && (!cleanup?.created || cleanup.verified === true)
    && (!data.execution || data.execution.validationStatus === "passed");
  return { counts, executed, rate, pass };
}
