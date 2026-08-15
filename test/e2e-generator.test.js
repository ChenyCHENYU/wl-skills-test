/**
 * e2e-generator 测试 — 脚手架结构完整性与关键安全模式
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateE2eScaffold } from "../lib/e2e-generator.js";

const TMP = join(process.cwd(), ".tmp-e2e-gen");

const SAMPLE_PAGE_SPEC = {
  page: "订单列表",
  mode: "LIST",
  dir: "/views/order/list",
  query: [{ name: "orderNo", label: "订单号", type: "input" }],
  toolbar: [{ label: "新增", color: "primary", action: "openModal" }],
  operations: [{ label: "编辑", action: "edit" }, { label: "删除", action: "delete" }],
};

const SAMPLE_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "e2e-001", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}", permission: "order_delete_by_id" },
  },
  models: {
    createRequest: [{ name: "orderNo", description: "订单号", required: true, type: "string" }],
  },
};

test("e2e-generator: page-spec 生成完整脚手架", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    const result = generateE2eScaffold(spec, { outputDir: outDir });
    assert.equal(result.pageName, "订单列表");
    assert.ok(result.files.length >= 10);
    assert.ok(existsSync(join(outDir, "support", "network-monitor.js")));
    assert.ok(existsSync(join(outDir, "tests", "round1-readonly.spec.js")));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 契约生成的 round2 含真实落库校验与账本清理", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "contract.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_CONTRACT));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const round2 = readFileSync(join(outDir, "tests", "round2-write.spec.js"), "utf-8");
    assert.ok(round2.includes("RunLedger"), "应使用清理账本");
    assert.ok(round2.includes("requireWriteApproval"), "应有三重写入门禁");
    assert.ok(round2.includes("真实落库"), "应含真实落库校验");
    assert.ok(round2.includes("零污染"), "应含零污染复查");
    assert.ok(round2.includes("orderNo"), "payload 应含契约必填字段");
    assert.ok(round2.includes("deleteById"), "应使用契约 remove 操作清理");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: network-monitor 含假通过防线与只读写检测", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const monitor = readFileSync(join(outDir, "support", "network-monitor.js"), "utf-8");
    assert.ok(monitor.includes("未观察到任何业务接口响应"), "必须有'观察到业务响应'硬门（防假通过）");
    assert.ok(monitor.includes("只读套件观察到写请求"), "只读模式必须检测写请求");
    assert.ok(monitor.includes("pageerror"), "必须监控 pageerror");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: run-ledger 含主键归属与 runId 业务键校验", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const ledger = readFileSync(join(outDir, "support", "run-ledger.js"), "utf-8");
    assert.ok(ledger.includes("assertCleanupOwnsRecord"), "清理请求必须携带本条主键");
    assert.ok(ledger.includes("businessKey.includes(this.runId)"), "业务键必须含 runId（禁止清理共享数据）");
    assert.ok(ledger.includes("renameSync"), "原子落盘（tmp+rename）");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成的 JS 文件不含 TypeScript 注解（可执行）", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const env = readFileSync(join(outDir, "support", "environment.js"), "utf-8");
    assert.ok(!/\)\s*:\s*(void|Promise|boolean|string)\s*\{/.test(env), "生成的 .js 不得含 TS 注解");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── v0.7.0: 批量模式 / 路由推导 / UI round2 / auth-setup ──

const REAL_PAGE_SPEC = {
  schemaVersion: 1,
  pageId: "PLBD002",
  page: "冶炼时间维护",
  dir: "src/views/produce/steelmaking/base-data/smelting-time",
  mode: "DETAIL_TABS",
  query: [{ name: "factory", label: "工厂/组织" }],
  columns: [{ name: "mc_code", label: "机台编码" }],
  toolbar: [{ label: "新增", color: "primary" }, { label: "修改" }, { label: "删除", color: "danger" }],
  operations: [],
  formSections: [{ name: "basic", label: "基本信息", fields: [{ name: "mc_code", required: true, label: "机台编码" }] }],
};

test("e2e-generator: 真实 page-spec（dir 为文件系统路径）路由自动推导", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(REAL_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const pages = readFileSync(join(outDir, "fixtures", "pages.js"), "utf-8");
    assert.ok(pages.includes("/produce/steelmaking/base-data/smelting-time"), "src/views/... 应推导为 /produce/...");
    assert.ok(pages.includes("PLBD002"), "应保留 pageId");
    assert.ok(pages.includes("writable: true"), "toolbar 有新增/删除应判定可写");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: formSections 存在时生成 UI 级 round2", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(REAL_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const round2 = readFileSync(join(outDir, "tests", "round2-write.spec.js"), "utf-8");
    assert.ok(round2.includes("受控写入(UI)"), "应为 UI 级闭环");
    assert.ok(round2.includes("getByRole(\"button\", { name: /新增|新建|添加/ }"), "应点击新增按钮");
    assert.ok(round2.includes("captureAuthorizationHeader"), "应从页面捕获 Authorization 用于 API 校验与清理");
    assert.ok(round2.includes("机台编码"), "应按表单 label 填充");
    assert.ok(round2.includes("RunLedger"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 目录批量扫描 page-spec 生成多页面清单", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = join(TMP, "specs");
  mkdirSync(join(dir, "a"), { recursive: true });
  mkdirSync(join(dir, "b"), { recursive: true });
  const s1 = { ...REAL_PAGE_SPEC, pageId: "PL001", page: "页面一", dir: "src/views/mod/a" };
  const s2 = { ...REAL_PAGE_SPEC, pageId: "PL002", page: "页面二", dir: "src/views/mod/b", toolbar: [], formSections: [] };
  writeFileSync(join(dir, "a", "page-spec.json"), JSON.stringify(s1));
  writeFileSync(join(dir, "b", "page-spec.json"), JSON.stringify(s2));
  const outDir = join(TMP, "e2e");
  try {
    const result = generateE2eScaffold(dir, { outputDir: outDir });
    assert.equal(result.pages.length, 2, "应扫描到 2 个页面");
    const pages = readFileSync(join(outDir, "fixtures", "pages.js"), "utf-8");
    assert.ok(pages.includes("PL001"));
    assert.ok(pages.includes("PL002"));
    assert.ok(pages.includes("writable: false"), "无工具栏按钮的页面应为只读");
    const round1 = readFileSync(join(outDir, "tests", "round1-readonly.spec.js"), "utf-8");
    assert.ok(round1.includes("for (const pageEntry of PAGES)"), "round1 应循环页面清单");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成 auth-setup 登录态 spec 与四 project 配置", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const auth = readFileSync(join(outDir, "tests", "auth-setup.spec.js"), "utf-8");
    assert.ok(auth.includes("E2E_LOGIN_USER"), "应支持环境变量驱动登录");
    assert.ok(auth.includes("storageState"), "应保存 storageState");
    const config = readFileSync(join(outDir, "playwright.config.js"), "utf-8");
    assert.ok(config.includes("auth-setup"), "config 应含 auth-setup project");
    assert.ok(config.includes("storedAuth"), "config 应复用已存在的登录态");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
