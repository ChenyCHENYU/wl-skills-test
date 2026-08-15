/**
 * e2e-generator 测试 — 脚手架结构完整性与关键安全模式
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

test("e2e-generator: 生成 auth-setup 登录态 spec 与 project 配置", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const auth = readFileSync(join(outDir, "tests", "auth-setup.spec.js"), "utf-8");
    assert.ok(auth.includes("E2E_LOGIN_USER"), "应支持自动登录");
    assert.ok(auth.includes("人工模式"), "应默认人工模式（兼容验证码/SSO）");
    assert.ok(auth.includes("storageState"), "应保存 storageState");
    const config = readFileSync(join(outDir, "playwright.config.js"), "utf-8");
    assert.ok(config.includes("assertE2ESpecCatalog"), "config 加载应执行归属清单强校验");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── v0.8.0: 路由映射 / 归属清单 / 深度用例 / 隔离 / UI 契约 ──

const DEEP_PAGE_SPEC = {
  schemaVersion: 1,
  pageId: "PLBD001",
  page: "基础资料维护",
  dir: "src/views/produce/steelmaking/base-data/master",
  mode: "LIST",
  query: [{ name: "material_name", label: "料名" }],
  columns: [
    { name: "material_id", label: "料号" },
    { name: "material_name", label: "料名" },
    { name: "plant_code", label: "工厂", dict: "pl_plant_code" },
  ],
  toolbar: [{ label: "新增", color: "primary" }, { label: "删除", color: "danger" }],
  operations: [],
  formSections: [{ name: "basic", label: "基本信息", fields: [{ name: "material_id", required: true, label: "料号" }] }],
};

test("e2e-generator: routes.json 映射优先于 dir 推导，双向校验", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = join(TMP, "specs");
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "page-spec.json"), JSON.stringify(DEEP_PAGE_SPEC));
  const routesFile = join(TMP, "routes.json");
  writeFileSync(routesFile, JSON.stringify({ PLBD001: "/lgBaseData/lgBaseDataMaster" }));
  const outDir = join(TMP, "e2e");
  try {
    const result = generateE2eScaffold(dir, { outputDir: outDir, routes: routesFile });
    assert.equal(result.pages[0].route, "/lgBaseData/lgBaseDataMaster", "应命中真实路由映射");
    assert.equal(result.pages[0].routeSource, "map");
    assert.equal(result.warnings.length, 0, "全映射后无 derived 告警");
    const pages = readFileSync(join(outDir, "fixtures", "pages.js"), "utf-8");
    assert.ok(pages.includes("/lgBaseData/lgBaseDataMaster"));
    assert.ok(pages.includes('"map"'));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: routes.json 缺页/多页 → 双向校验失败", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = join(TMP, "specs");
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "page-spec.json"), JSON.stringify(DEEP_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    // 缺 PLBD001 映射 + 多余 PL999
    const badRoutes = join(TMP, "routes.json");
    writeFileSync(badRoutes, JSON.stringify({ PL999: "/x" }));
    assert.throws(() => generateE2eScaffold(dir, { outputDir: outDir, routes: badRoutes }), /缺少映射|不一致/);
    // 多余键
    const extraRoutes = join(TMP, "routes2.json");
    writeFileSync(extraRoutes, JSON.stringify({ PLBD001: "/a", PL999: "/x" }));
    assert.throws(() => generateE2eScaffold(dir, { outputDir: outDir, routes: extraRoutes }), /多余映射/);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成 suites.js 归属清单且强校验真实执行通过", async () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const suites = readFileSync(join(outDir, "fixtures", "suites.js"), "utf-8");
    assert.ok(suites.includes("assertE2ESpecCatalog"), "应导出强校验函数");
    assert.ok(suites.includes("QUARANTINED_FLOW_SPECS"), "应含隔离组清单");

    // 真实执行：干净 → 通过；未归类文件 → 拒绝
    const { pathToFileURL } = await import("node:url");
    const mod = await import(pathToFileURL(join(outDir, "fixtures", "suites.js")).href);
    mod.assertE2ESpecCatalog(join(outDir, "tests"));
    writeFileSync(join(outDir, "tests", "orphan.spec.js"), 'import { test } from "@playwright/test";\ntest("验证孤儿", () => {});\n');
    assert.throws(() => mod.assertE2ESpecCatalog(join(outDir, "tests")), /未归类/);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成深度用例（搜索收敛/重置/字典翻译）", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(DEEP_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const detail = readFileSync(join(outDir, "tests", "round1-detail.spec.js"), "utf-8");
    assert.ok(detail.includes("验证搜索收敛并重置恢复"), "应生成搜索收敛/重置闭环用例");
    assert.ok(detail.includes("验证字典列翻译为中文"), "应生成字典翻译断言");
    assert.ok(detail.includes("验证列头按规范渲染"), "应生成列头断言");
    assert.ok(detail.includes("col-id"), "应支持 AG Grid 列级定位");
    assert.ok(detail.includes("test.skip(true,"), "SIT 无数据应优雅 skip");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成 ui-contract 拦截与 quarantine 隔离 spec", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(REAL_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const uiContract = readFileSync(join(outDir, "tests", "ui-contract.spec.js"), "utf-8");
    assert.ok(uiContract.includes("page.route("), "必须使用 page.route 拦截");
    assert.ok(uiContract.includes("wl-test-fill"), "应优先识别测试填充钩子");
    assert.ok(uiContract.includes("postDataJSON"), "应断言 payload 契约");

    const quarantine = readFileSync(join(outDir, "tests", "quarantine.spec.js"), "utf-8");
    assert.ok(/test\.skip\(\s*["'`]B\d+/.test(quarantine), "隔离组必须显式 test.skip B 组");
    assert.ok(quarantine.includes("隔离准入判断"), "应声明隔离准则");
    assert.ok(quarantine.includes("requireWriteApproval"), "解除隔离后仍需写入门禁");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: 生成 package.json scripts（type module + 7 project 一键化）", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf-8"));
    assert.equal(pkg.type, "module");
    for (const s of ["e2e:auth", "e2e", "e2e:detail", "e2e:ui-contract", "e2e:round2", "e2e:quarantine:list", "e2e:cleanup", "e2e:report"]) {
      assert.ok(pkg.scripts[s], `应含 ${s} 脚本`);
    }
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: features.testFill 时 round2 接入填充钩子", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  const withFill = { ...DEEP_PAGE_SPEC, features: { testFill: true } };
  writeFileSync(spec, JSON.stringify(withFill));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const round2 = readFileSync(join(outDir, "tests", "round2-write.spec.js"), "utf-8");
    assert.ok(round2.includes("wl-test-fill"), "应点击填充钩子");
    assert.ok(round2.includes("受控写入(UI)"), "有表单应为 UI 级");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── v0.10.0: 选择器适配层 / 工位模板 / 子表页签 ──

test("e2e-generator: 生成 support/selectors.js 且 steel 适配生效", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = join(TMP, "specs");
  mkdirSync(join(dir, "a"), { recursive: true });
  writeFileSync(join(dir, "a", "page-spec.json"), JSON.stringify(DEEP_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(dir, { outputDir: outDir, ui: "steel" });
    const selectors = readFileSync(join(outDir, "support", "selectors.js"), "utf-8");
    assert.ok(selectors.includes('"steel"'), "应写入 steel 适配");
    assert.ok(selectors.includes("steel-list-panel"), "应含 steel-list-panel 选择器");
    assert.ok(selectors.includes("E2E_UI"), "应支持运行时切换");
    // spec 应通过 sel 引用而非硬编码
    const round1 = readFileSync(join(outDir, "tests", "round1-readonly.spec.js"), "utf-8");
    assert.ok(round1.includes('from "../support/selectors.js"'), "round1 应导入 sel");
    assert.ok(round1.includes("sel.gridWait"), "应使用 sel.gridWait");
    assert.ok(round1.includes("sel.row"), "应使用 sel.row");
    const config = readFileSync(join(outDir, "playwright.config.js"), "utf-8");
    assert.ok(config.includes("E2E_CHANNEL"), "config 应支持 channel 切换");
    assert.ok(config.includes("E2E_VIDEO"), "video 应按需启用（ffmpeg 依赖规避）");
    assert.ok(config.includes('import.meta.url'), "config 应为 ESM 安全（不依赖 __dirname）");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: features.workstation 生成工位模板（拦截式零污染）", async () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec-ws.json");
  const ws = { ...DEEP_PAGE_SPEC, features: { workstation: true } };
  writeFileSync(spec, JSON.stringify(ws));
  // 独立 outDir：动态 import 的 suites.js 按 URL 缓存，与其他用例共用路径会命中旧模块
  const outDir = join(TMP, "e2e-ws");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const wsSpec = readFileSync(join(outDir, "tests", "workstation.spec.js"), "utf-8");
    assert.ok(wsSpec.includes("page.route("), "save/submit 必须拦截");
    assert.ok(wsSpec.includes("查看态"), "应含查看态断言");
    assert.ok(wsSpec.includes("进阶查询"), "应含进阶查询回填");
    assert.ok(/W4 验证保存契约/.test(wsSpec), "应含保存契约用例");
    // suites 归属强校验真实执行（workstation 组存在）
    const mod = await import(pathToFileURL(join(outDir, "fixtures", "suites.js")).href);
    mod.assertE2ESpecCatalog(join(outDir, "tests"));
    // package.json scripts
    const pkg = JSON.parse(readFileSync(join(outDir, "package.json"), "utf-8"));
    assert.ok(pkg.scripts["e2e:workstation"], "应有工位执行脚本");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("e2e-generator: subTables 生成子表页签用例", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "spec.json");
  const withTabs = {
    ...DEEP_PAGE_SPEC,
    mode: "DETAIL_TABS",
    subTables: [
      { key: "t1", title: "机台工序时间", name: "t1", label: "t1" },
      { key: "t2", title: "运输待机时间", name: "t2", label: "t2" },
    ],
  };
  writeFileSync(spec, JSON.stringify(withTabs));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir });
    const detail = readFileSync(join(outDir, "tests", "round1-detail.spec.js"), "utf-8");
    assert.ok(detail.includes("验证子表页签渲染"), "应生成页签用例模板");
    assert.ok(detail.includes("pageEntry.tabs"), "应循环页面页签数据");
    assert.ok(detail.includes('getByRole("tab"'), "应按 tab 角色定位页签");
    const pages = readFileSync(join(outDir, "fixtures", "pages.js"), "utf-8");
    assert.ok(pages.includes("机台工序时间"), "pages.js 应含页签数据");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
