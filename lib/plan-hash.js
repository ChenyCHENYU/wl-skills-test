/**
 * plan-hash.js — 写入前计划哈希（防止意外写入）
 *
 * 哈希规范化：
 *  - 对象键序无关（同一计划不同构造顺序产生相同哈希）
 *  - 路径归一（D:\a\b 与 D:/a/b、相对/绝对斜杠差异不产生不同哈希）
 *  - 文件顺序无关（同一组文件不同排列是同一语义计划）
 */
import { createHash } from "node:crypto";

function normalizeTarget(t) {
  return String(t).replace(/\\/g, "/");
}

export function computePlanHash(plan) {
  const canonical = (Array.isArray(plan) ? plan : []).map((f) => {
    const entry = {};
    for (const k of Object.keys(f).sort()) {
      entry[k] = k === "target" ? normalizeTarget(f[k]) : f[k];
    }
    return entry;
  });
  canonical.sort((a, b) => String(a.target).localeCompare(String(b.target)));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function verifyPlanHash(plan, expectedHash) {
  return computePlanHash(plan) === expectedHash;
}
