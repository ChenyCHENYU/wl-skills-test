/**
 * plan-hash.js — 写入前计划哈希（防止意外写入）
 */
import { createHash } from "node:crypto";

export function computePlanHash(plan) {
  const content = JSON.stringify(plan, null, 0);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function verifyPlanHash(plan, expectedHash) {
  return computePlanHash(plan) === expectedHash;
}
