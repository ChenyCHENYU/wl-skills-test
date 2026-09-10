/**
 * utils.js — 跨模块共享的基础工具（单一实现，消灭 10+ 处重复）
 *
 * 覆盖此前分散在各模块的四类逻辑：
 *   1. JSON 读取（BOM 剥离 / fail-open vs fail-closed 策略显式化）
 *   2. 写文件（mkdir + write 一步完成）
 *   3. Markdown 单元格转义（| 与换行）
 *   4. Bearer 头归一 / 布尔归一 / 命令可用性探测
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

/** 剥离 UTF-8 BOM（Windows 记事本/PowerShell 产出文件常见） */
export function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

/**
 * 读 JSON 文件。
 * @param {string} p 路径
 * @param {object} [opts]
 * @param {boolean} [opts.failOpen=false] true: 文件不存在/解析失败返回 null（旧 report 行为）；
 *                                        false: 返回 { error } 由调用方决策（fail-closed）
 * @returns {{ data } | { error } | null}
 */
export function readJsonFile(p, opts = {}) {
  if (!existsSync(p)) {
    return opts.failOpen ? null : { error: `文件不存在: ${p}` };
  }
  try {
    return { data: JSON.parse(stripBom(readFileSync(p, "utf-8"))) };
  } catch (e) {
    return opts.failOpen ? null : { error: `JSON 解析失败（${p}）: ${e.message}` };
  }
}

/** mkdir -p + 写文件（UTF-8） */
export function writeTextFile(p, content) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf-8");
}

/** Markdown 表格单元格转义：竖线与换行 */
export function escapeMdCell(v) {
  return String(v ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", " ")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}

/** Authorization 头归一：已带 Bearer/Basic 方案则原样，否则补 Bearer */
export function normalizeAuthHeader(token) {
  return /^(bearer|basic)\s/i.test(token) ? token : `Bearer ${token}`;
}

/** CLI/参数布尔归一："true"/true → true，"false"/false → false，其余原样 */
export function toBool(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/** 命令可用性探测（doctor / env_check 共用） */
export function checkCommandAvailable(cmd, timeoutMs = 10000) {
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] });
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return { ok: true, version: versionMatch ? versionMatch[1] : "unknown" };
  } catch {
    return { ok: false, version: null };
  }
}
