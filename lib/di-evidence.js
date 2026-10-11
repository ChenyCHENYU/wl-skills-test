/** DI release admission uses actual execution counts, never a default denominator. */
import { smokeEvidence } from "./gate-evidence.js";

export function diExecutionEvidence(caseCount, roundResults) {
  const parsed = typeof caseCount === "string" && caseCount.trim() ? Number(caseCount) : caseCount;
  const errors = [];
  const validCount = Number.isSafeInteger(parsed) && parsed > 0;
  if (!validCount) errors.push("DI 需要显式正整数 caseCount/cases，不使用默认分母");
  let executed = 0;
  let failed = 0;
  if (!Array.isArray(roundResults) || roundResults.length === 0) {
    errors.push("DI 没有实际 roundResults 执行样本，不能判定上线通过");
  } else {
    roundResults.forEach((round, index) => {
      const evidence = smokeEvidence(round);
      if (evidence.error) errors.push(`DI 第 ${index + 1} 轮执行证据无效: ${evidence.error}`);
      else {
        executed += evidence.executed;
        failed += evidence.counts.failed + evidence.counts.errors;
        if (!evidence.pass && evidence.counts.failed + evidence.counts.errors === 0) failed++;
      }
    });
    if (validCount && errors.length === 0 && executed !== parsed) {
      errors.push(`DI 分母 ${parsed} 与实际执行样本 ${executed} 不一致`);
    }
  }
  return { status: errors.length ? "unverified" : "verified", caseCount: validCount ? parsed : null, executed, failed, errors };
}
