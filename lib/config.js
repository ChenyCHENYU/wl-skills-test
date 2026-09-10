/**
 * config.js — 项目级配置 + 环境档案 + .env（v0.16.0）
 *
 * 目标：把「每次敲一长串 --base-url --token --dict-file」变成一次配置、处处生效。
 *
 * 约定:
 *   项目根放 wl-test.config.json：
 *     {
 *       "profiles": {
 *         "default": { "baseUrl": "http://localhost:8080" },
 *         "sit":     { "baseUrl": "http://sit:8080", "token": "$SIT_TOKEN" },
 *         "uat":     { "baseUrl": "http://uat:8080", "token": "$UAT_TOKEN" }
 *       },
 *       "dictFile": "./dict.json",
 *       "auth": { "loginPath": "/login", "usernameEnv": "WL_USER", "passwordEnv": "WL_PASSWORD" }
 *     }
 *   也支持扁平写法（无 profiles，整体视为 default）。
 *   取值优先级: 命令行显式参数 > --profile 指定档案 > profiles.default > 扁平根键。
 *   字符串值支持 $VAR / ${VAR} 环境变量引用（含 .env 注入，token 不落盘明文）。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 解析 .env（KEY=VALUE，忽略 # 注释与空行）。只注入 process.env 中不存在的键。 */
export function loadEnvFile(cwd = process.cwd()) {
  const envPath = join(cwd, ".env");
  const loaded = {};
  if (!existsSync(envPath)) return loaded;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    loaded[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return loaded;
}

function interpolate(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => {
    const name = a || b;
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new Error(`配置引用的环境变量未定义: ${name}（请在 .env 或环境中提供）`);
    }
    return resolved;
  });
}

function deepInterpolate(value) {
  if (typeof value === "string") return interpolate(value);
  if (Array.isArray(value)) return value.map(deepInterpolate);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepInterpolate(v)]));
  }
  return value;
}

/**
 * 加载项目配置（含 .env 注入与档案合并）
 * @param {object} [opts] — { config: 显式配置路径, profile: 档案名, cwd }
 * @returns {{ config: object, profile: string, source: string|null, warning?: string }}
 */
export function loadWlConfig(opts = {}) {
  loadEnvFile(opts.cwd || process.cwd());
  const path = opts.config || join(opts.cwd || process.cwd(), "wl-test.config.json");
  if (!existsSync(path)) {
    return { config: {}, profile: opts.profile || "default", source: null };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
  } catch (e) {
    return { config: {}, profile: opts.profile || "default", source: path, warning: `配置解析失败已忽略: ${e.message}` };
  }
  const profile = opts.profile || "default";
  const profiles = raw.profiles && typeof raw.profiles === "object" ? raw.profiles : null;
  // 根级扁平键（剔除 profiles 段）作为所有档案的公共默认
  const rootKeys = profiles
    ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "profiles"))
    : raw;
  const merged = {
    ...rootKeys,
    ...(profiles?.default ?? {}),
    ...(profiles?.[profile] ?? {}),
  };
  // auth.usernameEnv/passwordEnv → 解析为明文 auth.username/password（不写回文件）
  if (merged.auth?.usernameEnv) merged.auth.username = process.env[merged.auth.usernameEnv];
  if (merged.auth?.passwordEnv) merged.auth.password = process.env[merged.auth.passwordEnv];
  try {
    return { config: deepInterpolate(merged), profile, source: path };
  } catch (e) {
    return { config: {}, profile, source: path, warning: e.message };
  }
}

/** CLI 键 ↔ 配置键映射（命令行显式值优先，配置补缺） */
export const CLI_CONFIG_MAP = {
  "base-url": "baseUrl",
  token: "token",
  "token-no-perm": "noPermToken",
  "dict-file": "dictFile",
  "reports-dir": "reportsDir",
  "api-prefix": "apiPrefix",
};

/**
 * 合并命令行与配置：返回补齐后的 opts（不改写显式 CLI 值）。
 * @param {object} opts — parseArgs 的 opts
 * @param {object} config — loadWlConfig().config
 */
export function withConfig(opts, config) {
  const merged = { ...opts };
  for (const [cliKey, cfgKey] of Object.entries(CLI_CONFIG_MAP)) {
    if ((merged[cliKey] === undefined || merged[cliKey] === true) && config[cfgKey] !== undefined) {
      merged[cliKey] = config[cfgKey];
    }
  }
  return merged;
}

/**
 * 命令入口便捷封装：读 --config/--profile（或项目根 wl-test.config.json），返回补齐后的 opts。
 * 无配置文件时零开销直通。
 */
export function resolveOpts(parsed) {
  const configPath = parsed.opts.config;
  const profile = parsed.opts.profile;
  const defaultPath = join(process.cwd(), "wl-test.config.json");
  if (!configPath && !profile && !existsSync(defaultPath)) {
    return { opts: parsed.opts, config: {}, profile: null };
  }
  const wl = loadWlConfig({ config: configPath, profile });
  if (wl.warning) console.warn(`[config] ${wl.warning}`);
  return { opts: withConfig(parsed.opts, wl.config), config: wl.config, profile: wl.profile };
}
