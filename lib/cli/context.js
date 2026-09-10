/**
 * cli/context.js — CLI 层共享上下文（包信息 / reports 目录约定）
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = resolve(__dirname, "..", "..");
export const PKG = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

/** 各命令统一的 test-reports 目录解析（--reports-dir 覆盖，默认 test-reports） */
export function resolveReportsDir(opts = {}) {
  return opts["reports-dir"] || "test-reports";
}
