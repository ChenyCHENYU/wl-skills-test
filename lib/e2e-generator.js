/**
 * e2e-generator.js — 成熟 E2E 工程脚手架生成器
 *
 * 把 wl-ui-produce（炼钢生产平台）e2e 的实战模式固化为可复用资产：
 *
 * 1. 三轮测试策略
 *    - ROUND1 只读冒烟：打开页面 → 表格/空态断言 → 网络监控（HTTP≥400 / 业务码≠成功码 / console error / pageerror 任一即失败）
 *    - ROUND2 受控写入：契约必填字段构造 payload → 新增 → 真实落库校验（queryPage 查询确认）→ 账本登记 → 精确主键清理 → 清理后复查
 *    - CLEANUP 恢复清理：按账本文件恢复未完成的清理任务
 * 2. 网络监控（network-monitor）：必须观察到至少一个业务响应，防止"只看元素不看接口"的假通过；只读模式下观察到写请求即失败
 * 3. 清理账本（run-ledger）：真实主键 + 业务键必须含 runId（禁止把共享业务数据写入账本）、清理请求必须携带本条主键、原子落盘
 * 4. 写入门禁（environment）：E2E_ENABLE_WRITE + E2E_WRITE_CONFIRM + 主机白名单三重确认，默认禁止写入
 *
 * 生成物通过本包 audit() 自审计（见 test/self-consistency.test.js）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { consumeContract } from "./contract-consumer.js";

/**
 * 生成 E2E 工程脚手架
 * @param {string} contractPath — page-spec.json 或契约文件
 * @param {object} options — { outputDir, baseUrl, apiPrefix, writeConfirm }
 * @returns {{ pageName: string, files: string[] }}
 */
export function generateE2eScaffold(contractPath, options = {}) {
  const result = consumeContract(contractPath);
  const summary = result.summary;
  const outputDir = options.outputDir || "./e2e";
  const baseUrl = options.baseUrl || "http://localhost:8080";
  const apiPrefix = options.apiPrefix || defaultApiPrefix(summary);
  const writeConfirm = options.writeConfirm || "WL_E2E_SIT_CONFIRM";

  const pageName = summary.pageName || summary.entity || "被测系统";
  const route = summary.dir || "/";

  // 从契约提取受控写入所需信息
  const pageOp = (summary.operations || []).find((o) => o.key === "page");
  const createOp = (summary.operations || []).find((o) => o.key === "create");
  const removeOp = (summary.operations || []).find((o) => o.key === "remove");
  const requiredFields = extractWritableFields(summary);

  const files = [];
  const write = (rel, content) => {
    const full = join(outputDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
    files.push(rel);
  };

  write("support/environment.js", tplEnvironment(baseUrl, apiPrefix, writeConfirm));
  write("support/network-monitor.js", tplNetworkMonitor());
  write("support/run-ledger.js", tplRunLedger());
  write("support/api-probe.js", tplApiProbe());
  write("support/cleanup.js", tplCleanup());
  write("playwright.config.js", tplPlaywrightConfig());
  write("tests/round1-readonly.spec.js", tplRound1(pageName, route, apiPrefix));
  write("tests/round2-write.spec.js", tplRound2(pageName, apiPrefix, pageOp, createOp, removeOp, requiredFields));
  write("tests/cleanup.spec.js", tplCleanupSpec(pageName));
  write("README.md", tplReadme(pageName, writeConfirm));

  return { pageName, files };
}

function defaultApiPrefix(summary) {
  const path = summary.operations?.[0]?.externalPath || "";
  const m = path.match(/^(\/[^/]+)/);
  return m ? m[1] : "/api";
}

function extractWritableFields(summary) {
  const fields = [];
  if (Array.isArray(summary.fields)) {
    for (const f of summary.fields) {
      if (f.requiredOnCreate) fields.push({ name: f.name, type: f.javaType || "String", comment: f.comment || f.name });
    }
  } else if (summary.fields?.createRequest) {
    for (const f of summary.fields.createRequest) {
      if (f.required) fields.push({ name: f.name, type: f.type || "string", comment: f.description || f.name });
    }
  }
  if (fields.length === 0 && Array.isArray(summary.fields)) {
    for (const f of summary.fields.slice(0, 3)) {
      fields.push({ name: f.name, type: f.javaType || "String", comment: f.comment || f.name });
    }
  }
  return fields.slice(0, 5);
}

// ── 模板：环境与门禁 ─────────────────────────────
function tplEnvironment(baseUrl, apiPrefix, writeConfirm) {
  return `/**
 * environment.js — E2E 环境配置与安全门禁
 *
 * 环境变量:
 *   E2E_BASE_URL      被测系统基址（默认 ${baseUrl}）
 *   E2E_API_BASE      API 网关基址（默认 \\\$E2E_BASE_URL，可与前端同域）
 *   E2E_API_PREFIX    业务接口路径前缀（默认 ${apiPrefix}）
 *   E2E_TOKEN         API 认证 token（ROUND2 API 级写入使用）
 *   E2E_ENABLE_WRITE  =1 才允许执行写入套件
 *   E2E_WRITE_CONFIRM 必须等于 ${writeConfirm}（防止误触）
 *   E2E_ALLOWED_WRITE_HOSTS 写入目标主机白名单（逗号分隔）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_FILE = path.resolve(__dirname, "../.auth/user.json");
export const E2E_BASE_URL = process.env.E2E_BASE_URL || "${baseUrl}";
export const E2E_API_BASE = process.env.E2E_API_BASE || E2E_BASE_URL;
export const E2E_API_PREFIX = process.env.E2E_API_PREFIX || "${apiPrefix}";
export const SUCCESS_CODE = Number(process.env.E2E_SUCCESS_CODE || 2000);
export const WRITE_CONFIRM = "${writeConfirm}";

export function requireStoredAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      "缺少登录态 " + AUTH_FILE + "。请先执行 playwright test --project=auth-setup（或手动登录生成 storageState）。",
    );
  }
}

export function requireWriteApproval() {
  if (process.env.E2E_ENABLE_WRITE !== "1") {
    throw new Error("写入套件会写入并清理测试环境数据。确认目标环境后显式设置 E2E_ENABLE_WRITE=1。默认禁止写入。");
  }
  if (process.env.E2E_WRITE_CONFIRM !== WRITE_CONFIRM) {
    throw new Error("写入套件还必须显式设置 E2E_WRITE_CONFIRM=" + WRITE_CONFIRM + "，防止误触。");
  }
  const url = new URL(E2E_API_BASE);
  const allowedHosts = (process.env.E2E_ALLOWED_WRITE_HOSTS || "localhost,127.0.0.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error("写入目标 " + url.hostname + " 不在 E2E_ALLOWED_WRITE_HOSTS 白名单中。");
  }
}

export async function assertAuthenticated(page) {
  const current = page.url().toLowerCase();
  if (/login|oauth/.test(current)) {
    throw new Error("登录态失效（当前在登录页），禁止把跳转登录页当成通过。请重新生成登录态。");
  }
}

export function isBusinessApi(url) {
  return url.includes(E2E_API_PREFIX + "/");
}
`;
}

// ── 模板：网络监控 ──────────────────────────────
function tplNetworkMonitor() {
  return `/**
 * network-monitor.js — 页面级网络/控制台监控
 *
 * 硬门（源自 wl-ui-produce 实战）：
 * 1. 必须观察到至少一个业务接口响应 —— 只看页面元素不看接口 = 假通过
 * 2. HTTP >= 400 或 业务 code != 成功码 → 失败
 * 3. console error / pageerror → 失败（忽略 favicon / sourcemap 噪音）
 * 4. 只读模式下观察到写请求（POST 写路径 / PUT / DELETE / PATCH）→ 失败
 */
const IGNORED_CONSOLE = ["favicon", "DevTools failed to load source map"];

const MUTATION_PATHS = [
  /\\/save(?:[/?]|$)/i,
  /\\/updateById(?:[/?]|$)/i,
  /\\/deleteById(?:[/?]|$)/i,
  /\\/(?:submit|confirm|release|cancel|batch)(?:[/?]|$)/i,
];

function isMutationRequest(method, url) {
  const m = method.toUpperCase();
  if (["DELETE", "PUT", "PATCH"].includes(m)) return true;
  if (m !== "POST") return false;
  try {
    const pathname = new URL(url).pathname;
    return MUTATION_PATHS.some((p) => p.test(pathname));
  } catch {
    return false;
  }
}

export function monitorPage(page, opts = {}) {
  const readonly = opts.readonly !== false;
  const successCode = opts.successCode ?? 2000;
  const isBusinessApi = opts.isBusinessApi || ((url) => true);
  const failures = [];
  const observed = [];
  const pending = [];

  page.on("console", (event) => {
    if (event.type() !== "error") return;
    const message = event.text();
    if (!IGNORED_CONSOLE.some((frag) => message.includes(frag))) {
      failures.push({ source: "console", message });
    }
  });

  page.on("pageerror", (error) => {
    failures.push({ source: "page", message: error.message });
  });

  page.on("response", async (response) => {
    if (!isBusinessApi(response.url())) return;
    const check = (async () => {
      const status = response.status();
      const contentType = response.headers()["content-type"] || "";
      let code;
      let message;
      if (contentType.includes("json")) {
        try {
          const body = await response.json();
          code = body?.code;
          message = body?.message;
        } catch {
          // 非 JSON 由 HTTP 状态兜底
        }
      }
      observed.push({ method: response.request().method(), url: response.url(), httpStatus: status, code, message });
      if (readonly && isMutationRequest(response.request().method(), response.url())) {
        failures.push({
          source: "response",
          message: "只读套件观察到写请求: " + response.request().method() + " " + response.url(),
        });
        return;
      }
      if (status >= 400 || (code !== undefined && Number(code) !== successCode)) {
        failures.push({
          source: "response",
          message:
            response.request().method() +
            " " +
            response.url() +
            " HTTP=" + status +
            " code=" + String(code ?? "-") +
            " message=" + String(message ?? "-"),
        });
      }
    })();
    pending.push(check);
  });

  return {
    get observedCount() {
      return observed.length;
    },
    observed,
    async assertClean(label) {
      await Promise.allSettled(pending);
      if (observed.length === 0) {
        throw new Error(
          "[" + (label || "network-monitor") + "] 未观察到任何业务接口响应，不能仅凭页面元素判定链路通过。",
        );
      }
      if (failures.length > 0) {
        throw new Error(failures.map((f) => "[" + f.source + "] " + f.message).join("\\n"));
      }
    },
  };
}
`;
}

// ── 模板：清理账本 ──────────────────────────────
function tplRunLedger() {
  return `/**
 * run-ledger.js — 测试数据清理账本
 *
 * 安全约束（源自 wl-ui-produce 实战）：
 * 1. 每次写入必须登记：真实业务主键 + 清理动作
 * 2. 业务键必须包含本次 runId —— 禁止把共享业务数据写入清理账本
 * 3. 清理请求必须携带本条记录的真实主键 —— 拒绝扩大范围的清理
 * 4. 清理路径必须是相对路径（禁止 .. 和 ://）
 * 5. 原子落盘（tmp + rename），失败可按账本恢复清理
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { E2E_API_BASE } from "./environment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_DIR = path.resolve(__dirname, "../reports/ledgers");

function assertCleanupDescriptor(cleanup) {
  if (!cleanup.path.startsWith("/") || cleanup.path.includes("..") || cleanup.path.includes("://")) {
    throw new Error("清理路径必须是当前网关下的相对路径: " + cleanup.path);
  }
  if (cleanup.method !== "DELETE" && cleanup.method !== "POST") {
    throw new Error("不允许的清理方法: " + String(cleanup.method));
  }
}

function assertCleanupOwnsRecord(cleanup, recordId) {
  const identityValues = [cleanup.path, ...Object.values(cleanup.query || {}), JSON.stringify(cleanup.body || {})];
  if (!identityValues.some((v) => String(v).includes(recordId))) {
    throw new Error("清理请求没有携带本条真实主键 " + recordId + "，拒绝登记可能扩大范围的清理动作。");
  }
}

function createRunId() {
  const explicit = process.env.E2E_RUN_ID?.trim();
  if (explicit) {
    if (!/^TS[A-Z0-9_-]{4,40}$/.test(explicit)) {
      throw new Error("E2E_RUN_ID 必须以 TS 开头，且只含 4-40 位大写字母/数字/下划线/短横线。");
    }
    return explicit;
  }
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return "TS" + ts + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
}

export class RunLedger {
  constructor(runId = createRunId()) {
    fs.mkdirSync(LEDGER_DIR, { recursive: true });
    this.filePath = path.join(LEDGER_DIR, "ledger-" + runId + ".json");
    if (fs.existsSync(this.filePath)) {
      throw new Error("runId 已存在账本，禁止覆盖: " + this.filePath + "。请更换 E2E_RUN_ID。");
    }
    this.document = {
      schemaVersion: 2,
      runId,
      targetApiBase: E2E_API_BASE,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      entries: [],
    };
    this.persist();
  }

  static load(filePath) {
    const absolute = path.resolve(filePath);
    const relative = path.relative(LEDGER_DIR, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("只允许加载 " + LEDGER_DIR + " 内的账本: " + absolute);
    }
    const document = JSON.parse(fs.readFileSync(absolute, "utf-8"));
    if (document.schemaVersion !== 2 || !Array.isArray(document.entries)) {
      throw new Error("不支持的账本格式: " + absolute);
    }
    if (document.targetApiBase !== E2E_API_BASE) {
      throw new Error("账本目标环境与当前 API 基址不一致，拒绝跨环境清理。");
    }
    for (const entry of document.entries) {
      if (!entry.entryId || !entry.recordId || !entry.businessKey) {
        throw new Error("账本包含缺少身份字段的记录: " + absolute);
      }
      if (!entry.businessKey.includes(document.runId)) {
        throw new Error("账本业务键不属于本次 runId，拒绝加载清理。");
      }
      assertCleanupDescriptor(entry.cleanup);
      assertCleanupOwnsRecord(entry.cleanup, entry.recordId);
    }
    const ledger = Object.create(RunLedger.prototype);
    ledger.filePath = absolute;
    ledger.document = document;
    return ledger;
  }

  get runId() {
    return this.document.runId;
  }

  record(entry) {
    assertCleanupDescriptor(entry.cleanup);
    if (!entry.recordId?.trim() || !entry.businessKey?.trim()) {
      throw new Error("禁止记录缺少真实主键或业务键的清理任务。");
    }
    if (!entry.businessKey.includes(this.runId)) {
      throw new Error("业务键必须包含当前 runId，禁止把共享业务数据写入清理账本: " + entry.businessKey);
    }
    assertCleanupOwnsRecord(entry.cleanup, entry.recordId);
    const saved = {
      ...entry,
      entryId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      cleanupStatus: "pending",
    };
    this.document.entries.push(saved);
    this.persist();
    return saved;
  }

  markDone(entryId) {
    this.#update(entryId, "done");
  }

  markFailed(entryId, error) {
    this.#update(entryId, "failed", error instanceof Error ? error.message : String(error));
  }

  getPending() {
    return this.document.entries.filter((e) => e.cleanupStatus !== "done");
  }

  summary() {
    const total = this.document.entries.length;
    const done = this.document.entries.filter((e) => e.cleanupStatus === "done").length;
    return { total, done, pending: total - done, runId: this.runId, filePath: this.filePath };
  }

  #update(entryId, status, error) {
    const entry = this.document.entries.find((e) => e.entryId === entryId);
    if (!entry) throw new Error("账本记录不存在: " + entryId);
    entry.cleanupStatus = status;
    entry.cleanupError = error;
    this.persist();
  }

  persist() {
    this.document.updatedAt = new Date().toISOString();
    const pending = this.document.entries.some((e) => e.cleanupStatus !== "done");
    const failed = this.document.entries.some((e) => e.cleanupStatus === "failed");
    this.document.status = failed ? "cleanup-failed" : pending ? "running" : "clean";
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.document, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }
}
`;
}

// ── 模板：API 探针 ──────────────────────────────
function tplApiProbe() {
  return `/**
 * api-probe.js — API 请求探针（信封校验）
 */
import { E2E_API_BASE, SUCCESS_CODE } from "./environment.js";

function authorizationHeaders(token) {
  const value = (token || "").trim();
  if (!value) throw new Error("未提供认证 token（E2E_TOKEN），禁止执行验证或清理请求。");
  const normalized = /^bearer\\s+/i.test(value) ? value : "Bearer " + value;
  return { Authorization: normalized, "Content-Type": "application/json" };
}

async function parseEnvelope(response) {
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("API 返回非 JSON: HTTP " + response.status() + " " + text.slice(0, 300));
  }
  if (!response.ok() || body.code !== SUCCESS_CODE) {
    throw new Error("API 失败: HTTP " + response.status() + " code=" + body.code + " message=" + (body.message || "-"));
  }
  return body;
}

export async function apiRequest(request, token, method, apiPath, body) {
  const response = await request.fetch(E2E_API_BASE + apiPath, {
    method,
    headers: authorizationHeaders(token),
    data: body,
  });
  return parseEnvelope(response);
}

export async function executeCleanup(request, token, cleanup) {
  if (!cleanup.path.startsWith("/") || cleanup.path.includes("..") || cleanup.path.includes("://")) {
    throw new Error("拒绝执行非相对路径的清理请求: " + cleanup.path);
  }
  const url = new URL(E2E_API_BASE + cleanup.path);
  Object.entries(cleanup.query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await request.fetch(url.toString(), {
    method: cleanup.method,
    headers: authorizationHeaders(token),
    data: cleanup.body,
  });
  return parseEnvelope(response);
}
`;
}

// ── 模板：清理编排 ──────────────────────────────
function tplCleanup() {
  return `/**
 * cleanup.js — 按账本逆序清理，失败保留账本待恢复
 */
import { executeCleanup } from "./api-probe.js";

export async function cleanupLedger(request, token, ledger) {
  const errors = [];
  for (const entry of [...ledger.getPending()].reverse()) {
    try {
      await executeCleanup(request, token, entry.cleanup);
      ledger.markDone(entry.entryId);
    } catch (error) {
      ledger.markFailed(entry.entryId, error);
      errors.push(entry.pageId + "/" + entry.recordId + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  if (errors.length > 0) {
    throw new Error("测试数据清理未闭环，账本保留为待处理状态:\\n" + errors.join("\\n"));
  }
}
`;
}

// ── 模板：playwright 配置 ───────────────────────
function tplPlaywrightConfig() {
  return `/**
 * playwright.config.js — 三轮策略编排
 *
 * 执行顺序:
 *   npx playwright test --project=round1-readonly     # 只读冒烟（默认可跑）
 *   E2E_ENABLE_WRITE=1 E2E_WRITE_CONFIRM=... \\
 *     npx playwright test --project=round2-write      # 受控写入（三重门禁）
 *   E2E_LEDGER_FILE=... npx playwright test --project=cleanup  # 按账本恢复清理
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:8080";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./reports/artifacts",
  fullyParallel: false,
  workers: 1, // B 端业务有状态，串行执行防脏数据
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./reports/html", open: "never" }],
    ["json", { outputFile: "./reports/results.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: "round1-readonly", testMatch: /round1-readonly\\.spec\\.js/ },
    { name: "round2-write", testMatch: /round2-write\\.spec\\.js/ },
    { name: "cleanup", testMatch: /cleanup\\.spec\\.js/ },
  ],
});
`;
}

// ── 模板：ROUND1 只读冒烟 ───────────────────────
function tplRound1(pageName, route, apiPrefix) {
  return `/**
 * ROUND1 只读冒烟 — ${pageName}
 *
 * 硬门:
 * 1. 登录态有效（跳转登录页 = 失败，不是 skip）
 * 2. 页面必须渲染表格或明确空态（防白屏）
 * 3. 必须观察到至少一个业务响应（防"只看元素"的假通过）
 * 4. HTTP >= 400 / 业务码非成功 / console error / pageerror 任一出现即失败
 * 5. 只读模式下观察到写请求即失败
 */
import { test, expect } from "@playwright/test";
import { monitorPage } from "../support/network-monitor.js";
import { assertAuthenticated, isBusinessApi } from "../support/environment.js";

const PAGE_ROUTE = "${route}";

test.describe("ROUND1 只读冒烟 — ${pageName}", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_ROUTE, { waitUntil: "domcontentloaded" });
  });

  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("验证页面渲染表格或明确空态", async ({ page }) => {
    test.setTimeout(60_000);
    const monitor = monitorPage(page, { readonly: true, isBusinessApi });

    await assertAuthenticated(page);
    await page.waitForSelector(".el-table, .ag-root-wrapper, .el-empty", { timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    const rowCount = await page.locator(".el-table__body-wrapper tr, .ag-row").count();
    const hasEmptyState = (await page.locator(".el-empty, .ag-no-rows").count()) > 0;
    expect(rowCount > 0 || hasEmptyState, "页面未渲染表格数据或明确空态，疑似白屏或模块未挂载").toBeTruthy();

    await monitor.assertClean("${pageName} round1");
  });

  test("检查查询接口返回业务数据结构", async ({ page }) => {
    const monitor = monitorPage(page, { readonly: true, isBusinessApi });
    await assertAuthenticated(page);

    // reload 触发新一轮查询，避免错过首屏加载期的请求
    const responsePromise = page.waitForResponse(
      (r) => isBusinessApi(r.url()) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const response = await responsePromise.catch(() => null);
    expect(response, "未观察到业务 POST 查询请求").not.toBeNull();
    expect(response.status()).toBeLessThan(400);

    const body = await response.json().catch(() => ({}));
    expect(Number(body.code), "业务码应为成功码（默认 2000，可用 E2E_SUCCESS_CODE 覆盖）").toBe(
      Number(process.env.E2E_SUCCESS_CODE || 2000),
    );

    await monitor.assertClean("${pageName} round1-api");
  });
});
`;
}

// ── 模板：ROUND2 受控写入 ───────────────────────
function tplRound2(pageName, apiPrefix, pageOp, createOp, removeOp, requiredFields) {
  const pagePath = pageOp?.externalPath || `${apiPrefix}/queryPage`;
  const createPath = createOp?.externalPath || `${apiPrefix}/save`;
  const removePath = removeOp?.externalPath || `${apiPrefix}/deleteById/{id}`;
  const payloadLines = requiredFields
    .map((f) => `    ${f.name}: ${dummyLiteral(f)}, // ${f.comment}`)
    .join("\n");

  return `/**
 * ROUND2 受控写入 — ${pageName}（API 级数据闭环）
 *
 * 硬门禁（三重确认，默认禁止写入）:
 *   E2E_ENABLE_WRITE=1
 *   E2E_WRITE_CONFIRM=<确认串>（见 support/environment.js）
 *   E2E_ALLOWED_WRITE_HOSTS=<目标主机>
 *
 * 闭环: 新增 → 真实落库校验（queryPage 查询确认）→ 账本登记 → 精确主键清理 → 清理后复查（零污染）
 */
import { test, expect } from "@playwright/test";
import { RunLedger } from "../support/run-ledger.js";
import { cleanupLedger } from "../support/cleanup.js";
import { apiRequest } from "../support/api-probe.js";
import { requireWriteApproval, requireStoredAuth } from "../support/environment.js";

const QUERY_PATH = "${pagePath}";
const CREATE_PATH = "${createPath}";
const DELETE_PATH = "${removePath}";

function buildPayload(runId) {
  return {
${payloadLines}
  };
}

test.describe("ROUND2 受控写入 — ${pageName}", () => {
  test.beforeAll(() => {
    requireStoredAuth();
    requireWriteApproval();
  });

  test.afterAll(() => {
    // 汇总信息在用例内输出；账本文件保留在 reports/ledgers 供审计与恢复清理
  });

  test("新增数据真实落库并零污染清理", async ({ request }) => {
    const token = process.env.E2E_TOKEN || "";
    const ledger = new RunLedger();
    const businessKey = "AT_" + ledger.runId;

    try {
      // 1. 新增（契约必填字段构造合法 payload，业务键含 runId 便于识别与清理）
      const payload = { ...buildPayload(ledger.runId), remark: businessKey };
      const created = await apiRequest(request, token, "POST", CREATE_PATH, payload);
      const recordId = String(created.data ?? "");
      expect(recordId, "新增接口必须返回真实业务主键，才能执行零污染清理").not.toBe("");

      // 2. 账本登记（真实主键 + 精确清理动作）
      const deletePath = DELETE_PATH.includes("{id}") ? DELETE_PATH.replace("{id}", recordId) : DELETE_PATH;
      ledger.record({
        pageId: "ROUND2",
        operation: { method: "POST", path: CREATE_PATH },
        recordId,
        businessKey,
        cleanup: DELETE_PATH.includes("{id}")
          ? { method: "DELETE", path: deletePath }
          : { method: "DELETE", path: deletePath, query: { id: recordId } },
      });

      // 3. 真实落库校验：queryPage 必须能查到刚写入的数据
      const queried = await apiRequest(request, token, "POST", QUERY_PATH, { current: 1, size: 10 });
      const records = queried.data?.records || queried.records || [];
      expect(
        (Array.isArray(records) ? records : []).some((r) => JSON.stringify(r).includes(recordId)),
        "新增后未查询到测试主键 " + recordId + "，疑似未真实落库",
      ).toBeTruthy();
    } finally {
      // 4. 精确主键清理（逆序，失败保留账本）
      if (ledger.getPending().length > 0) {
        await cleanupLedger(request, token, ledger).catch((e) => {
          console.error("清理失败，账本保留: " + ledger.filePath, e);
        });
      }
    }

    // 5. 清理后复查（零污染验证）
    expect(ledger.summary().pending, "存在未清理记录，检查账本 " + ledger.filePath).toBe(0);
    const remaining = await apiRequest(request, token, "POST", QUERY_PATH, { current: 1, size: 10 });
    const remainRecords = remaining.data?.records || remaining.records || [];
    expect(
      (Array.isArray(remainRecords) ? remainRecords : []).length === 0 ||
        !(remainRecords || []).some((r) => JSON.stringify(r).includes(ledger.runId)),
      "清理后仍存在本次测试数据",
    ).toBeTruthy();
  });
});
`;
}

function dummyLiteral(field) {
  const type = (field.type || "String").toLowerCase();
  if (type.includes("decimal") || type.includes("double") || type.includes("float")) return "1.5";
  if (type.includes("int") || type.includes("long")) return "1";
  if (type.includes("date")) return '"2026-01-01 00:00:00"';
  return '"AT_" + runId';
}

// ── 模板：恢复清理 ──────────────────────────────
function tplCleanupSpec(pageName) {
  return `/**
 * 按账本恢复清理 — ${pageName}
 *
 * 用法: E2E_LEDGER_FILE=./reports/ledgers/ledger-TSxxxx.json \\
 *       npx playwright test --project=cleanup
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import { RunLedger } from "../support/run-ledger.js";
import { cleanupLedger } from "../support/cleanup.js";

test.describe("恢复清理 — ${pageName}", () => {
  test.beforeAll(() => {
    if (!process.env.E2E_LEDGER_FILE) {
      throw new Error("恢复清理必须显式设置 E2E_LEDGER_FILE，禁止猜测或批量清理。");
    }
  });

  test.afterAll(() => {
    // 清理完成后账本标记为 clean；失败时账本保留 pending 状态供下次恢复
  });

  test("验证按账本恢复清理未完成的测试数据", async ({ request }) => {
    const ledger = RunLedger.load(path.resolve(process.env.E2E_LEDGER_FILE));
    const token = process.env.E2E_TOKEN || "";
    await cleanupLedger(request, token, ledger);
    expect(ledger.summary().pending).toBe(0);
  });
});
`;
}

// ── 模板：README ────────────────────────────────
function tplReadme(pageName, writeConfirm) {
  return `# E2E 测试工程 — ${pageName}

由 wl-skills-test run-gen --type e2e 生成（模式源自 wl-ui-produce 炼钢平台实战沉淀）。

## 快速开始

\`\`\`bash
npm i -D @playwright/test
npx playwright install chromium

# 环境变量（按目标系统调整）
set E2E_BASE_URL=http://localhost:8080
set E2E_API_PREFIX=/api
set E2E_TOKEN=Bearer xxx

# ROUND1 只读冒烟（默认可跑，零风险）
npx playwright test --project=round1-readonly

# ROUND2 受控写入（三重门禁，默认禁止）
set E2E_ENABLE_WRITE=1
set E2E_WRITE_CONFIRM=${writeConfirm}
set E2E_ALLOWED_WRITE_HOSTS=localhost
npx playwright test --project=round2-write

# 按账本恢复清理（写入中断后）
set E2E_LEDGER_FILE=./reports/ledgers/ledger-TSxxxx.json
npx playwright test --project=cleanup
\`\`\`

## 三轮策略

| 轮次 | project | 风险 | 门禁 |
|------|---------|------|------|
| ROUND1 | round1-readonly | 只读，零风险 | 无（可直接跑） |
| ROUND2 | round2-write | 写入+自动清理 | ENABLE_WRITE + WRITE_CONFIRM + 主机白名单 |
| CLEANUP | cleanup | 按账本精确清理 | 必须显式指定账本文件 |

## 硬门原则

1. **假通过防线**：必须观察到至少一个业务接口响应，只看页面元素不算通过
2. **响应防线**：HTTP>=400 / 业务码非成功 / console error / pageerror 任一即失败
3. **只读防线**：只读套件观察到写请求（POST 写路径/PUT/DELETE）即失败
4. **零污染防线**：写入必须登记账本（真实主键+业务键含 runId），finally 清理+复查
5. **登录态防线**：跳转登录页=失败，不是 skip
`;
}
