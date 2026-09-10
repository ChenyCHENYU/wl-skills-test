/**
 * write-guard.js — 安全写链
 * preview → confirm(planHash) → 写前重算 → 失败回滚
 * 生产环境默认阻断写入
 *
 * v0.15.0 加固：
 *  - 回滚按字节（Buffer）恢复——二进制/BOM/CRLF/文件模式的保真不再依赖 UTF-8 文本往返
 *  - 回滚失败如实上报（不再吞掉），written/rolledBack 区分"已写入"与"已成功恢复"
 *  - 重复目标拒绝（同一计划写两个相同路径会互相踩备份）
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync, statSync, chmodSync } from "node:fs";
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
    files: files.map((f) => ({ target: f.target, size: typeof f.content === "string" ? f.content.length : f.content?.length ?? 0 })),
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

  // 重复目标拒绝：同一计划写两个相同路径，后写的备份会覆盖先写的备份，回滚到错误状态
  const targets = files.map((f) => String(f.target).replace(/\\/g, "/"));
  if (new Set(targets).size !== targets.length) {
    return { success: false, reason: "计划含重复目标路径，拒绝写入", written: 0 };
  }

  // 执行写入 + 按字节备份用于回滚
  const written = [];
  const errors = [];

  for (const f of files) {
    try {
      const existed = existsSync(f.target);
      // 字节级备份（Buffer）：二进制/BOM/CRLF 与文件模式保真，回滚不因文本往返失真
      const backup = existed ? readFileSync(f.target) : null;
      const mode = existed ? statSync(f.target).mode : null;

      mkdirSync(dirname(f.target), { recursive: true });
      writeFileSync(f.target, f.content);
      written.push({ target: f.target, backup, mode, existed });
    } catch (e) {
      errors.push({ target: f.target, error: e.message });
    }
  }

  // 失败回滚（如实上报：回滚失败的文件单独列出，不吞错）
  if (errors.length > 0) {
    const rollbackErrors = [];
    let rolledBack = 0;
    for (const w of written) {
      try {
        if (w.existed) {
          writeFileSync(w.target, w.backup);
          if (w.mode !== null) {
            try {
              chmodSync(w.target, w.mode);
            } catch {
              // 模式恢复失败不影响内容恢复
            }
          }
        } else {
          unlinkSync(w.target);
        }
        rolledBack++;
      } catch (e) {
        rollbackErrors.push({ target: w.target, error: `回滚失败: ${e.message}` });
      }
    }
    return {
      success: false,
      written: 0,
      errors,
      rolledBack,
      rollbackErrors,
    };
  }

  return { success: true, written: written.length, errors: [] };
}
