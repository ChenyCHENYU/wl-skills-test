/**
 * auth.js — 认证适配层（v0.16.0）
 *
 * 解决「token 手工提供、一过期全链路挂掉」：预置 jh4j 风格登录（账号密码 → token），
 * api-executor 在无 token 时自动登录、遇 401 自动重登重试一次。
 * 自定义登录形态通过 auth.adapter(用户提供的函数) 扩展（脚本注入，非 AI 生成）。
 */

import { normalizeAuthHeader } from "./shared/utils.js";

/**
 * jh4j 风格登录换取 token
 * @param {object} opts — { baseUrl, loginPath="/login", username, password, successCode=2000, timeout=15000 }
 * @returns {Promise<string|{error:string}>}
 */
export async function loginForToken(opts = {}) {
  const { baseUrl, loginPath = "/login", username, password, successCode = 2000, timeout = 15000 } = opts;
  if (!baseUrl) return { error: "auth 需要 baseUrl" };
  if (!username || !password) {
    return { error: "auth 需要 username/password（建议经 wl-test.config.json 的 usernameEnv/passwordEnv 引用环境变量，不落盘明文）" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${String(baseUrl).replace(/\/$/, "")}${loginPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.code !== undefined && json.code !== successCode && json.code !== 0 && json.code !== 200)) {
      return { error: `登录失败: HTTP ${res.status} code=${json.code} message=${json.message ?? ""}` };
    }
    const data = json.data ?? json;
    const token = typeof data === "string" ? data : data?.token ?? data?.access_token ?? data?.accessToken;
    if (!token || typeof token !== "string") {
      return { error: `登录响应中未识别到 token（data 类型: ${Array.isArray(data) ? "array" : typeof data}）` };
    }
    return token;
  } catch (e) {
    return { error: `登录请求失败: ${e.name === "AbortError" ? `超时 (${timeout}ms)` : e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** 归一 Authorization 头（Bearer 补全），auth.js 统一入口 */
export function authHeader(token) {
  return normalizeAuthHeader(token);
}
