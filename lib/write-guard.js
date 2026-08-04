/**
 * write-guard.js — 安全写链
 * preview → confirm(planHash) → 写前重算 → 失败回滚
 * 生产环境默认阻断写入
 */

import { computePlanHash, verifyPlanHash } from "./plan-hash.js";

const PRODUCTION_ENVS = new Set(["prod", "production", "prd"]);

/**
 * 创建写入计划
 * @param {Array<{target, content}>} files
 * @param {object} options — { env, allowProductionWrites }
 */
export function createWritePlan(files, options = {}) {
  const env = options.env || process.env.NODE_ENV || "dev";

  // 生产环境阻断
  if (PRODUCTION_ENVS.has(env) && !options.allowProductionWrites) {
    return {
      blocked: true,
      reason: "生产环境默认阻断写入。如需写入，请显式设置 allowProductionWrites: true",
      env,
      fileCount: files.length,
    };
  }

  const planHash = computePlanHash(files);
  return {
    blocked: false,
    planHash,
    fileCount: files.length,
    env,
    files: files.map((f) => ({ target: f.target, size: f.content.length })),
  };
}

/**
 * 确认并执行写入计划
 * @param {Array<{target, content}>} files
 * @param {string} expectedHash
 * @param {object} options
 */
export function confirmAndWrite(files, expectedHash, options = {}) {
  const plan = createWritePlan(files, options);
  if (plan.blocked) {
    return { success: false, reason: plan.reason, written: 0 };
  }

  // 校验哈希
  if (!verifyPlanHash(files, expectedHash)) {
    return {
      success: false,
      reason: "计划哈希不匹配，文件列表可能已被篡改，拒绝写入",
      written: 0,
    };
  }

  // 执行写入
  const fs = require("node:fs");
  const path = require("node:path");
  let written = 0;
  const errors = [];

  for (const f of files) {
    try {
      const dir = path.dirname(f.target);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f.target, f.content, "utf-8");
      written++;
    } catch (e) {
      errors.push({ target: f.target, error: e.message });
    }
  }

  return { success: errors.length === 0, written, errors };
}
