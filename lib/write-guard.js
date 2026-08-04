/**
 * write-guard.js — 安全写链
 * preview → confirm(planHash) → 写前重算 → 失败回滚
 * 生产环境默认阻断写入
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { computePlanHash, verifyPlanHash } from "./plan-hash.js";

const PRODUCTION_ENVS = new Set(["prod", "production", "prd"]);

/**
 * 创建写入计划
 * @param {Array<{target, content}>} files
 * @param {object} options — { env, allowProductionWrites }
 */
export function createWritePlan(files, options = {}) {
  const env = options.env || process.env.NODE_ENV || "dev";

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

  if (!verifyPlanHash(files, expectedHash)) {
    return {
      success: false,
      reason: "计划哈希不匹配，文件列表可能已被篡改，拒绝写入",
      written: 0,
    };
  }

  // 执行写入 + 记录备份用于回滚
  const written = [];
  const errors = [];

  for (const f of files) {
    try {
      // 备份已存在的文件（用于回滚）
      const backup = existsSync(f.target) ? readFileSync(f.target, "utf-8") : null;

      mkdirSync(dirname(f.target), { recursive: true });
      writeFileSync(f.target, f.content, "utf-8");
      written.push({ target: f.target, backup });
    } catch (e) {
      errors.push({ target: f.target, error: e.message });
    }
  }

  // 失败回滚
  if (errors.length > 0) {
    for (const w of written) {
      try {
        if (w.backup !== null) {
          writeFileSync(w.target, w.backup, "utf-8");
        } else {
          unlinkSync(w.target);
        }
      } catch {
        // 回滚失败也忽略，继续尝试其余
      }
    }
    return {
      success: false,
      written: 0,
      errors,
      rolledBack: written.length,
    };
  }

  return { success: true, written: written.length, errors: [] };
}
