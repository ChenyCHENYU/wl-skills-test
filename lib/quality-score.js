/**
 * quality-score.js — 质量分（v0.19.0）
 *
 * 把多维度门禁结果压缩成"一个数字 + 等级 + 分项"，供管理层看板与趋势追踪。
 * 计分模型（确定性、可解释）：
 *   基础 100 分，每个未达标检查项 -25（不足按比例），四舍五入到整数；
 *   等级 A ≥90 / B ≥75 / C ≥60 / D <60。
 */

export function computeQualityScore(checks = []) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return { score: null, level: null, breakdown: { total: 0, failed: 0 }, hint: "无检查项，无法计分" };
  }
  const failed = checks.filter((c) => !c.pass).length;
  const total = checks.length;
  const penalty = Math.min(100, failed * 25);
  const score = Math.max(0, Math.round(100 - penalty));
  const level = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D";
  return {
    score,
    level,
    breakdown: { total, failed, penaltyPerCheck: 25 },
    hint: failed === 0 ? "全部达标" : `${failed}/${total} 项未达标，每项 -25`,
  };
}
