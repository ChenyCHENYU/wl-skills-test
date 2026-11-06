import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseEnv } from "../lib/config.js";

const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envRef = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/;
const profileName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const sensitiveKey = /^(?:authorization|cookie|set-cookie|password|passwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|api[_-]?key|client[_-]?secret)$/i;
const privatePath = /^(?:\.env(?:\..*)?|\.git|\.npmrc|\.netrc|env\.local\.json|wl-test\.config\.json)$/i;

export const profileProperty = { type: "string", pattern: profileName.source,
  description: "项目 wl-test.config.json 的已授权档案名；目的地和凭据由本机配置提供" };

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function scopeError() {
  return problem("MCP_PROJECT_SCOPE", "请选择 MCP 启动项目内的文件和目录；配置、环境文件与项目外路径不可作为工具输入或输出");
}

function isInside(root, path) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function entry(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}

export function createMcpNetworkContext(projectRoot = process.cwd()) {
  const root = realpathSync(projectRoot);
  const configPath = join(root, "wl-test.config.json");
  const envPath = join(root, ".env");
  const env = { ...process.env };
  let source;
  let profiles;
  let configError;
  function readSource(path) {
    const file = entry(path);
    if (!file) return null;
    if (!file.isFile()) throw scopeError();
    return readFileSync(path);
  }
  try {
    source = [readSource(configPath), readSource(envPath)];
    if (source[0] !== null) profiles = JSON.parse(source[0].toString("utf8").replace(/^\uFEFF/, "")).profiles;
    for (const [name, value] of Object.entries(parseEnv(source[1]?.toString("utf8") || ""))) {
      if (!Object.hasOwn(env, name)) Object.defineProperty(env, name, { value });
    }
  } catch {
    configError = problem("MCP_PROFILE_CONFIG", "无法加载项目 wl-test.config.json 或 .env；请检查本机文件和 JSON 格式后重连 MCP");
  }

  function requireProjectRoot(input = ".") {
    const invalidRoot = () => problem("MCP_PROJECT_SCOPE", "项目根必须与 MCP 启动时绑定的项目一致；切换项目请重新连接 MCP");
    if (typeof input !== "string" || !input.trim()) throw invalidRoot();
    let actual;
    try { actual = realpathSync(resolve(root, input)); }
    catch { throw invalidRoot(); }
    if (actual !== root) throw invalidRoot();
    return root;
  }

  function pathWithinProject(input, { output = false } = {}) {
    if (typeof input !== "string" || !input.trim()) throw scopeError();
    const path = resolve(root, input);
    if (!isInside(root, path) || relative(root, path).split(sep).some(part => privatePath.test(part))) throw scopeError();
    for (let candidate = path; candidate !== root; candidate = dirname(candidate)) {
      const info = entry(candidate);
      if (info?.isSymbolicLink() || (output && info && !info.isDirectory() && (!info.isFile() || info.nlink > 1))) throw scopeError();
    }
    return path;
  }

  function checkOutputFile(input) {
    const path = pathWithinProject(input, { output: true });
    if (entry(path)?.isDirectory()) throw scopeError();
    return path;
  }

  function writeOutputFile(input, content) {
    const path = checkOutputFile(input);
    mkdirSync(dirname(path), { recursive: true });
    checkOutputFile(path);
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o666);
    try {
      const target = fstatSync(fd);
      if (!target.isFile() || target.nlink !== 1) throw scopeError();
      ftruncateSync(fd, 0);
      writeFileSync(fd, content, "utf8");
    } finally { closeSync(fd); }
  }

  function profileIsFresh() {
    try {
      return [configPath, envPath].every((path, index) => {
        const current = readSource(path);
        return current === null ? source[index] === null : source[index] !== null && current.equals(source[index]);
      });
    } catch { return false; }
  }

  function assertProfileFresh() {
    if (configError) throw configError;
    if (!profileIsFresh()) throw problem("MCP_PROFILE_CHANGED", "项目档案或 .env 已变化；请重连 MCP 后再执行远程工具");
  }

  function resolveProfile(name, { writes = false } = {}) {
    assertProfileFresh();
    const config = profileName.test(name) && profiles && Object.hasOwn(profiles, name) ? profiles[name] : null;
    if (!config || !["api-test", "read-only"].includes(config.mcp) || (writes && config.mcp !== "api-test")) {
      throw problem("MCP_PROFILE_NOT_AUTHORIZED", writes
        ? '请在项目 wl-test.config.json 的 profiles 中配置目标档案，设置 mcp 为 "api-test"，重连后以 profile 指定；此工具会发送真实写入和清理请求'
        : '请在项目 wl-test.config.json 的 profiles 中配置目标档案，设置 mcp 为 "read-only" 或 "api-test"，重连后以 profile 指定');
    }
    return networkProfile(config, env);
  }

  return { root, requireProjectRoot, pathWithinProject, checkOutputFile, writeOutputFile, resolveProfile, assertProfileFresh, profileIsFresh };
}

function networkProfile(config, env) {
  const secrets = new Set();
  const invalidConfig = () => problem("MCP_PROFILE_CONFIG", "目标档案配置无效；请检查本机 baseUrl、同目标相对接口路径，以及环境变量形式的凭据");
  function envValue(name, secret = false) {
    const value = envName.test(name) && Object.hasOwn(env, name) ? env[name] : null;
    if (!value || !value.trim()) throw invalidConfig();
    if (secret) secrets.add(value);
    return value;
  }
  function configuredValue(value, secret = false) {
    if (typeof value !== "string" || !value.trim()) throw invalidConfig();
    const match = value.match(envRef);
    if (match) return envValue(match[1] || match[2], secret);
    if (secret || value.includes("$")) throw invalidConfig();
    return value;
  }

  let base;
  try { base = new URL(configuredValue(config.baseUrl)); }
  catch { throw invalidConfig(); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw invalidConfig();
  const prefix = base.pathname.replace(/\/+$/, "");
  const baseUrl = base.origin + prefix;
  const destinationError = () => problem("MCP_DESTINATION_OUT_OF_SCOPE", "请求路径必须位于已授权档案的接口范围；未发送超出范围的请求");

  function requireDestination(input) {
    let url;
    try { url = new URL(input); }
    catch { throw destinationError(); }
    if (url.origin !== base.origin || url.username || url.password || url.hash || /%(?:25|2f|5c)/i.test(url.pathname)
      || (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) throw destinationError();
    return url;
  }
  function endpoint(path) {
    if (typeof path !== "string" || !/^\/(?!\/)/.test(path) || /[\\#\u0000-\u0020]/.test(path)
      || /%(?:25|2f|5c)/i.test(path.split("?")[0]) || path.split("?")[0].replace(/%2e/gi, ".").split("/").some(part => part === "." || part === "..")) throw destinationError();
    requireDestination(baseUrl + path);
    return path;
  }

  const token = config.token == null ? undefined : configuredValue(config.token, true);
  const noPermToken = config.noPermToken == null ? undefined : configuredValue(config.noPermToken, true);
  let auth;
  if (config.auth != null) {
    const { loginPath = "/login", usernameEnv, passwordEnv, successCode, timeout } = config.auth;
    if (Object.hasOwn(config.auth, "username") || Object.hasOwn(config.auth, "password")
      || (successCode != null && !Number.isFinite(successCode))
      || (timeout != null && (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000))) throw invalidConfig();
    auth = { loginPath: endpoint(loginPath), username: envValue(usernameEnv, true), password: envValue(passwordEnv, true),
      ...(successCode == null ? {} : { successCode }), ...(timeout == null ? {} : { timeout }) };
  }

  function redactText(value) {
    let text = value;
    for (const secret of secrets) {
      const variants = new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]);
      for (const variant of variants) {
        if (variant.length >= 8) text = text.replaceAll(variant, "[已隐藏]");
        else {
          const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          text = text.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g"), "[已隐藏]");
        }
      }
    }
    return text;
  }
  function redact(value) {
    if (typeof value === "string") return redactText(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.length >= 8 ? redactText(key) : key,
        sensitiveKey.test(key) && typeof item === "string" ? "[已隐藏]" : redact(item)]));
    }
    return value;
  }

  const fetchImpl = (input, init = {}) => {
    const url = requireDestination(input);
    const authorization = new Headers(init.headers).get("authorization")?.replace(/^\s*(?:bearer|basic)\s+/i, "").trim();
    if (authorization) secrets.add(authorization);
    return globalThis.fetch(url, { ...init, redirect: "error" });
  };
  return { baseUrl, token, noPermToken, auth, fetchImpl, redact,
    dictApi: endpoint(config.dictApi ?? "/pl/system/dict/all"),
    swaggerUrl: baseUrl + endpoint(config.swaggerPath ?? "/v3/api-docs"),
    validateDestination: endpoint };
}
