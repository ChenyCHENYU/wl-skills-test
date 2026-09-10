/**
 * compact.js — 大结果的紧凑摘要（v0.16.0 token 经济学）
 *
 * 原则：AI/MCP 消费「摘要 + 失败 TopN + 诊断指引」即可决策；
 * 全量数据（快照/全部用例/完整报告）一律落文件，按需 detail:"full" 或读文件。
 * 一个典型 run-api 全量结果含逐步骤报文快照（数十 KB 起），摘要控制在 ~1-2KB。
 */

/** run-api 结果 → 紧凑摘要 */
export function compactApiResult(result, { topN = 5 } = {}) {
  if (!result || result.error) return result;
  const s = result.summary || {};
  const failures = (result.results || [])
    .filter((r) => r.status === "fail" || r.status === "error")
    .slice(0, topN)
    .map((r) => ({ id: r.id, name: r.name, kind: r.kind, status: r.status, reason: r.reason, hint: r.hint ?? null }));
  return {
    pass: s.pass,
    decision: s.decision,
    entity: s.entity,
    steps: { total: s.total, passed: s.passed, failed: s.failed, errors: s.errors, skipped: s.skipped, warned: s.warned },
    assertions: s.assertions,
    negatives: s.negatives,
    permissions: s.permissions,
    driftCounts: s.drift ? { missing: s.drift.missing.length, extra: s.drift.extra.length, typeMismatch: s.drift.typeMismatch.length } : undefined,
    cleanup: s.cleanup,
    dimensionCoverage: s.dimensionCoverage,
    auth: s.auth,
    failures,
    failureTotal: (s.failed ?? 0) + (s.errors ?? 0),
    fullResultFile: result.resultFile,
    hint: failures.length > 0 ? "失败诊断见 failures[].hint；全量步骤与报文快照见 fullResultFile（或传 detail:'full'）" : null,
  };
}

/** audit 结果 → 紧凑摘要 */
export function compactAuditResult(result, { topN = 10 } = {}) {
  if (!result || result.error) return result;
  return {
    pass: result.pass,
    level: result.level,
    total: result.total,
    bySeverity: result.bySeverity,
    byRule: result.byRule,
    topFindings: (result.findings || []).slice(0, topN).map((f) => ({
      rule: f.rule,
      severity: f.severity,
      file: f.file,
      message: String(f.message).slice(0, 160),
    })),
    findingTotal: result.total,
    hint: result.total > 0 ? "修复入口: wl-skills-test fix --target <目录>（默认预览）；全量明细见 audit-result.json" : null,
  };
}

/** report 结果 → 紧凑摘要 */
export function compactReportResult(result, { reportFile } = {}) {
  if (!result || result.error) return result;
  const failing = (result.checks || []).filter((c) => !c.pass);
  return {
    pass: result.pass,
    decision: result.decision,
    score: result.score,
    failingChecks: failing.map((c) => ({ name: c.name, detail: c.detail })),
    snapshot: result.snapshot,
    reportFile,
    hint: failing.length > 0 ? `存在 ${failing.length} 个未达标项（见 failingChecks）；完整报告: ${reportFile ?? "report 命令产物"}` : "全部达标",
  };
}
