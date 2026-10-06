/**
 * e2e-generator.js — 深度 E2E 工程脚手架生成器（v0.8.0）
 *
 * 固化 wl-ui-produce（炼钢生产平台 32 页面）e2e 的全部工程化模式：
 *
 * 工程骨架（7 project 编排，config 加载即校验）:
 *   auth-setup → round1-readonly → round1-detail → ui-contract → round2-write → quarantine → cleanup
 *
 * 1. 用例归属清单（fixtures/suites.js）+ 加载期强校验:
 *    未归类/重复归属/清单有但文件缺失/test.only/隔离声明漂移/写入安全标记缺失/Bearer 截断 → fail
 * 2. 显式路由映射（routes.json）优先于 dir 推导，双向一致性校验（missing/extra 即失败）
 * 3. 登录态双模式: 默认人工登录（兼容验证码/SSO/MFA），配置账号时自动填表
 * 4. round1 深度用例: 列头渲染/搜索收敛/重置恢复/字典翻译（A 组），证据附件 attach
 * 5. ui-contract: page.route 拦截写请求，验证端点+payload 契约而不落库（任何环境可跑）
 * 6. quarantine: 高风险流程（共享状态/无可靠逆操作）显式隔离 + 声明强校验
 * 7. round2 受控写入: UI 级（含 test-fill 钩子）/API 级双模式，账本+零污染
 *
 * 生成物通过本包 audit() 自审计（T1-T25，见 test/self-consistency.test.js）。
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { consumeContract } from "./contract-consumer.js";

/**
 * 生成 E2E 工程脚手架
 * @param {string} contractPath — page-spec / 契约 / page-spec 目录 / manifest JSON（{pages,routes}）
 * @param {object} options — { outputDir, baseUrl, apiPrefix, writeConfirm, routes }
 * @returns {{ pageName: string, files: string[], pages: Array, warnings: string[] }}
 */
export function generateE2eScaffold(contractPath, options = {}) {
  const ctx = collectPages(contractPath, options.routes);
  const outputDir = options.outputDir || "./e2e";
  const baseUrl = options.baseUrl || "http://localhost:8080";
  const apiPrefix = options.apiPrefix || defaultApiPrefix(ctx);
  const writeConfirm = options.writeConfirm || "WL_E2E_SIT_CONFIRM";
  // UI 适配层（v0.10.0）：element-plus（默认）/ steel（AG Grid + steel-list-panel，wl-ui-produce 形态）/ ant-design
  // 非法取值直接报错（旧实现静默回退 element-plus，生成物在目标组件库上跑不通才发现）
  const ui = options.ui || "element-plus";
  const customSelectors = options.selectors && typeof options.selectors === "object" ? options.selectors : null;
  const KNOWN_UI = ["element-plus", "steel", "ant-design"];
  if (!customSelectors && !KNOWN_UI.includes(ui)) {
    throw new Error(`未知 UI 适配 "${ui}"（可选: ${KNOWN_UI.join(" / ")}，或通过 options.selectors 注入自定义适配层）`);
  }
  // 工位页模板（查看/录入态 + 进阶查询回填 + save/submit 两段式，全 page.route 拦截零污染）
  const workstation = options.workstation === true || ctx.workstation === true;

  const pageName = ctx.pages.length === 1 ? ctx.pages[0].name : `${ctx.pages.length} 个页面`;
  const primary = ctx.pages[0] || { name: "被测系统", pageId: "PAGE", route: "/" };

  const files = [];
  const warnings = [...(ctx.warnings || [])];
  const requiredApiOperations = ["page", "create", "remove"].map((key) => ctx.summary?.operations?.find((operation) => operation.key === key));
  const apiFactsReady = ctx.summary?.apiFactsStatus !== "unresolved" && requiredApiOperations.every((operation) =>
    operation && typeof operation.externalPath === "string" && operation.externalPath.startsWith("/") && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method));
  if (!apiFactsReady) warnings.push("API 事实未决：保留 UI/只读场景；ROUND2 模板保持跳过，请补真实 API 契约后重新生成。");
  const derivedCount = ctx.pages.filter((p) => p.routeSource === "derived").length;
  if (derivedCount > 0) {
    warnings.push(
      `${derivedCount} 个页面路由为 dir 推导（未命中 routes.json/spec.route），请在 fixtures/pages.js 核对（routeSource: "derived"）`,
    );
  }
  const write = (rel, content) => {
    const full = join(outputDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
    files.push(rel);
  };

  const uiFields = ctx.uiFormFields || [];
  const hasPageSpecColumns = ctx.pages.some((p) => (p.columns || []).length > 0);

  write("support/selectors.js", tplSelectors(ui, customSelectors));
  write("support/environment.js", tplEnvironment(baseUrl, apiPrefix, writeConfirm));
  write("support/network-monitor.js", tplNetworkMonitor());
  write("support/run-ledger.js", tplRunLedger());
  write("support/api-probe.js", tplApiProbe());
  write("support/cleanup.js", tplCleanup());
  write("fixtures/pages.js", tplPagesFixture(ctx.pages, ctx.sourceType));
  write("fixtures/suites.js", tplSuites(hasPageSpecColumns, workstation));
  write("playwright.config.js", tplPlaywrightConfig());
  write("package.json", tplPackageJson());
  write("tests/auth-setup.spec.js", tplAuthSetup());
  write("tests/round1-readonly.spec.js", tplRound1(ui));
  if (hasPageSpecColumns) {
    write("tests/round1-detail.spec.js", tplRound1Detail());
  }
  write("tests/ui-contract.spec.js", tplUiContract());
  if (workstation) {
    write("tests/workstation.spec.js", tplWorkstation(primary));
  }
  if (uiFields.length > 0) {
    write("tests/round2-write.spec.js", withApiReadiness(tplRound2UI(primary, apiPrefix, ctx, uiFields, ctx.testFill), apiFactsReady));
  } else {
    write("tests/round2-write.spec.js", withApiReadiness(tplRound2API(primary, apiPrefix, ctx), apiFactsReady));
  }
  write("tests/quarantine.spec.js", tplQuarantine());
  write("tests/cleanup.spec.js", tplCleanupSpec());
  write("README.md", tplReadme(pageName, writeConfirm, uiFields.length > 0, ctx.pages.length, derivedCount, ui, workstation));

  return { pageName, files, pages: ctx.pages, warnings };
}

function withApiReadiness(script, ready) {
  if (ready) return script;
  return '// API 事实未决：请提供 page-spec.apiContract 后重新生成；写入环境开关不能绕过此边界。\n' +
    script.replace("test.describe(", "test.describe.skip(");
}

// ── 页面收集（单文件 / 目录 / manifest / 路由映射）────
function collectPages(contractPath, routesPath) {
  let stat;
  try {
    stat = statSync(contractPath);
  } catch (e) {
    throw new Error(`无法读取契约路径 ${contractPath}: ${e.message}`);
  }
  const ctx = { pages: [], uiFormFields: [], summary: null, sourceType: null, testFill: false, warnings: [] };

  let routes = null;

  if (stat.isDirectory()) {
    // 批量模式：递归扫描 page-spec.json；自动探测 routes.json / routes.*.json
    const specs = [];
    walkDir(contractPath, (f) => {
      if (f.endsWith("page-spec.json") || f.endsWith(".page-spec.json")) specs.push(f);
      const base = f.split(/[\\/]/).pop();
      if (/^routes(\.[^.]+)?\.json$/.test(base)) {
        try {
          routes = { ...routes, ...JSON.parse(readFileSync(f, "utf-8")) };
        } catch (e) {
          // 无效 routes JSON 记入警告（此前静默丢弃，用户不知道哪个文件没生效）
          ctx.warnings.push(`路由映射文件解析失败已忽略: ${f}（${e.message}）`);
        }
      }
    });
    for (const spec of specs) {
      try {
        const data = JSON.parse(readFileSync(spec, "utf-8"));
        if (data.page && (data.mode || data.dir)) ctx.pages.push(toPageEntry(data));
        // 合并全部 spec 的表单必填字段（首个 spec 无 formSections 时返回 []，
        // 旧实现 first-wins 会永久屏蔽后续 spec 的字段，批量模式生成错误的 round2 形态）
        for (const f of extractUiFields(data)) {
          if (!ctx.uiFormFields.some((x) => (x.name || "") === (f.name || ""))) ctx.uiFormFields.push(f);
        }
        if (data.features?.testFill) ctx.testFill = true;
        if (data.features?.workstation || data.mode === "WORKSTATION") ctx.workstation = true;
      } catch (e) {
        ctx.warnings.push(`page-spec 解析失败已跳过: ${spec}（${e.message}）`);
      }
    }
    if (ctx.pages.length === 0) throw new Error(`目录 ${contractPath} 下未找到有效的 page-spec.json`);
    ctx.sourceType = "page-spec-batch";
  } else {
    const raw = readFileSync(contractPath, "utf-8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`JSON 解析失败: ${e.message}`);
    }
    if (Array.isArray(data.pages) && data.pages.length > 0 && data.pages[0].page) {
      // manifest 模式：{ pages: [...], routes: { pageId: route } }
      for (const p of data.pages) ctx.pages.push(toPageEntry(p));
      if (data.routes && typeof data.routes === "object") routes = data.routes;
      // manifest 的表单字段跨页面合并（旧实现只读 pages[0]）
      for (const p of data.pages) {
        for (const f of extractUiFields(p)) {
          if (!ctx.uiFormFields.some((x) => (x.name || "") === (f.name || ""))) ctx.uiFormFields.push(f);
        }
        if (p.features?.testFill) ctx.testFill = true;
      }
      ctx.sourceType = "page-spec-batch";
    } else {
      const result = consumeContract(contractPath);
      const s = result.summary;
      ctx.summary = s;
      ctx.sourceType = result.type;
      if (result.type === "page-spec") {
        const data2 = JSON.parse(raw);
        ctx.pages.push(toPageEntry(data2));
        ctx.uiFormFields = extractUiFields(data2);
        ctx.testFill = data2.features?.testFill === true;
        ctx.workstation = data2.features?.workstation === true || data2.mode === "WORKSTATION";
      } else {
        ctx.pages.push({ pageId: "", name: s.entity || "业务实体", route: "/", writable: true, routeSource: "spec" });
      }
    }
  }

  // 显式 routes 参数优先于自动探测；显式来源做严格双向校验（用户意图），
  // 自动合并来源对多余映射降级为警告（陈旧的 routes.dev.json 不再一刀切阻断生成）
  if (routesPath && existsSync(routesPath)) {
    routes = JSON.parse(readFileSync(routesPath, "utf-8"));
    applyRoutes(ctx.pages, routes, { strict: true, warnings: ctx.warnings });
  } else if (routes) {
    applyRoutes(ctx.pages, routes, { strict: false, warnings: ctx.warnings });
  }
  return ctx;
}

// 路由优先级: spec.route > routes.json[pageId] > dir 推导；映射与清单双向一致性校验
function applyRoutes(pages, routes, { strict = true, warnings = [] } = {}) {
  const pageIds = new Set(pages.filter((p) => p.pageId).map((p) => p.pageId));
  const needMap = pages.filter((p) => p.routeSource !== "spec" && p.pageId).map((p) => p.pageId);
  const missing = needMap.filter((id) => routes[id] === undefined);
  const extra = Object.keys(routes).filter((k) => !pageIds.has(k));
  if (missing.length > 0) {
    throw new Error(`routes.json 与页面清单不一致（双向校验失败）:\n  缺少映射: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    if (strict) {
      throw new Error(`routes.json 与页面清单不一致（双向校验失败）:\n  多余映射: ${extra.join(", ")}`);
    }
    warnings.push(`路由映射含未知页面已忽略: ${extra.join(", ")}（来源为自动合并的多份 routes 文件，请清理过期映射）`);
    for (const k of extra) delete routes[k];
  }
  for (const p of pages) {
    if (p.routeSource !== "spec" && p.pageId && routes[p.pageId]) {
      p.route = routes[p.pageId];
      p.routeSource = "map";
    }
  }
}

function walkDir(dir, cb) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkDir(full, cb);
    else cb(full);
  }
}

function toPageEntry(data) {
  const explicit = typeof data.route === "string" && data.route.length > 0;
  const derived = deriveRouteFromDir(data.dir);
  const toolbar = data.toolbar || [];
  const ops = data.operations || [];
  const writable = toolbar.some((b) => /新增|修改|删除|添加|创建|保存/.test(b.label || "")) || ops.length > 0;
  const labelMap = {};
  for (const q of data.query || []) if (q.name) labelMap[q.name] = q.label || q.name;
  for (const c of data.columns || []) if (c.name) labelMap[c.name] = c.label || c.name;
  return {
    pageId: data.pageId || data.page || "",
    name: data.page || "",
    route: explicit ? data.route : derived,
    routeSource: explicit ? "spec" : "derived",
    writable,
    query: (data.query || []).slice(0, 3).map((q) => ({ name: q.name || q.field || "", label: q.label || labelMap[q.name] || q.name || "" })),
    columns: (data.columns || []).slice(0, 8).map((c) => ({
      name: c.name || c.field || "",
      label: c.label || labelMap[c.name] || c.name || "",
      dict: Boolean(c.dict || c.dictCode),
    })),
    // 子表页签（DETAIL_TABS 页面的 subTables，round1-detail 逐页签校验）
    tabs: (data.subTables || []).slice(0, 4).map((t) => ({ title: t.title || t.label || t.name || t.key || "", key: t.key || t.name || "" })),
  };
}

function deriveRouteFromDir(dir) {
  if (!dir) return "/";
  // Windows 反斜杠归一（"src\views\x" 推导出 "/src\views\x" 的脏路由）
  const normalized = String(dir).replace(/\\/g, "/");
  if (normalized.startsWith("/")) return normalized;
  const idx = normalized.indexOf("/views/");
  if (idx > -1) return normalized.slice(idx + "/views".length) || "/";
  return `/${normalized}`;
}

// UI round2 表单必填字段（label 优先，用于 placeholder 定位）
function extractUiFields(data) {
  const fields = [];
  const labelMap = {};
  for (const q of data.query || []) if (q.name) labelMap[q.name] = q.label || q.name;
  for (const c of data.columns || []) if (c.name) labelMap[c.name] = c.label || c.name;
  for (const s of data.formSections || []) {
    for (const f of s.fields || []) {
      if (f.required) {
        fields.push({ name: f.name || f.field, label: f.label || labelMap[f.name || f.field] || f.name || f.field });
      }
    }
  }
  return fields;
}

function defaultApiPrefix(ctx) {
  const path = ctx.summary?.operations?.[0]?.externalPath || "";
  const m = path.match(/^(\/[^/]+)/);
  return m ? m[1] : "/api";
}

// ── 模板：选择器适配层（v0.10.0）─────────────────
// customSelectors: 调用方注入的自定义适配层（options.selectors），合并进 ADAPTERS 后按 ui 名取用——
// 第四个组件库不再需要改生成器代码
function tplSelectors(ui, customSelectors) {
  const customBlock = customSelectors
    ? `\n// 自定义适配层（由 options.selectors 注入）
ADAPTERS[${JSON.stringify(ui)}] = ${JSON.stringify(customSelectors, null, 2)};
`
    : "";
  return `/**
 * selectors.js — 组件库选择器适配层（集中管理，换组件库只改这一个文件）
 *
 * 当前适配: ${ui}
 * 可通过环境变量 E2E_UI 运行时切换（element-plus / steel / ant-design${customSelectors ? " / " + ui : ""}）。
 * steel = AG Grid + steel-list-panel 自研组件（wl-ui-produce 炼钢平台形态）。
 */
const UI = process.env.E2E_UI || "${ui}";

const ADAPTERS = {
  "element-plus": {
    gridWait: ".el-table, .el-empty, .el-tabs",
    row: ".el-table__body-wrapper tr",
    empty: ".el-empty",
    headerCells: ".el-table__header th",
    dialog: ".el-dialog:visible",
    dialogConfirm: '.el-dialog:visible .el-button--primary, .el-dialog:visible button:has-text("确定"), .el-dialog:visible button:has-text("保存")',
    toolbar: "",
    queryForm: ".el-form-item, .el-row, form",
    toolbarButton: ".el-button, button",
    messageBoxConfirm: ".el-message-box__btns .el-button--primary",
    colCell: null, // el-table 按表头 label 定位（见 round1-detail 的 cellText）
  },
  steel: {
    gridWait: ".steel-list-panel__table .ag-root-wrapper, .ag-root-wrapper, .el-empty, .el-tabs",
    row: ".steel-list-panel__table .ag-row, .ag-row",
    empty: ".ag-overlay-no-rows-center, .ag-no-rows, .el-empty",
    headerCells: ".ag-header-cell-text, .el-table__header th",
    dialog: ".jh-dialog:visible, .el-dialog:visible",
    dialogConfirm: '.jh-dialog:visible .el-button--primary, .el-dialog:visible .el-button--primary, .el-dialog:visible button:has-text("确定"), .el-dialog:visible button:has-text("保存")',
    toolbar: ".steel-list-panel__actions",
    queryForm: ".el-form-item, .el-row, form",
    toolbarButton: ".el-button, button",
    messageBoxConfirm: ".el-message-box__btns .el-button--primary",
    colCell: (col) => '.ag-row[row-index="0"] [col-id="' + col + '"]',
  },
  "ant-design": {
    gridWait: ".ant-table, .ant-empty",
    row: ".ant-table-tbody tr",
    empty: ".ant-empty",
    headerCells: ".ant-table-thead th",
    dialog: ".ant-modal:visible",
    dialogConfirm: '.ant-modal:visible .ant-btn-primary, .ant-modal:visible button:has-text("确定"), .ant-modal:visible button:has-text("保存")',
    toolbar: "",
    queryForm: ".ant-form-item, form",
    toolbarButton: ".ant-btn, button",
    messageBoxConfirm: ".ant-modal-confirm-btns .ant-btn-primary",
    colCell: null,
  },
};
${customBlock}
const WORKSTATION = {
  commandCard: ".steel-workstation__command-card, .workstation-command, form",
  actions: ".steel-workstation__actions",
  actualForm: ".steel-workstation__actual-form, .workstation-actual-form",
  advanced: ".steel-workstation__advanced",
};

export const sel = { ...ADAPTERS[UI] || ADAPTERS["element-plus"], workstation: WORKSTATION };
`;
}

// ── 模板：工位页（查看/录入态 + 进阶查询回填 + save/submit 两段式，全拦截零污染）──
function tplWorkstation(primary) {
  return `/**
 * 工位页契约测试 — ${primary.name}（源自 wl-ui-produce SteelWorkstationPage 模式）
 *
 * 工位页特殊形态（非标准 CRUD）：
 * 1. 初始"查看"态（operationMode=view），实绩表单禁用
 * 2. 进阶查询从已下达计划选炉次回填（此处拦截 plan 查询返回模拟行，确定性验证回填逻辑）
 * 3. 保存调 save（DRAFT）/ 提交调 submit（确认弹窗）——全部 page.route 拦截，不落库零污染
 *
 * 覆盖: W1 打开+查看态禁用 / W2 进阶查询回填 / W3 新增后可编辑 / W4 save 契约 / W5 submit 契约
 */
import { test, expect } from "@playwright/test";
import { sel } from "../support/selectors.js";
import { assertAuthenticated } from "../support/environment.js";

const PAGE_ROUTE = ${JSON.stringify(primary.route)};

function successEnvelope(message = "成功", data = {}) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 2000, message, data }),
  };
}

async function waitForWorkstation(page, timeout = 30_000) {
  await page.waitForSelector(sel.workstation.commandCard + ", " + sel.gridWait, { timeout });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

async function clickAction(page, label) {
  const btn = page
    .locator(sel.workstation.actions + ", " + (sel.toolbar || sel.toolbarButton || ".el-button, button"))
    .getByRole("button", { name: label })
    .first();
  await expect(btn, "工位工具栏按钮 " + label + " 应可见").toBeVisible({ timeout: 10_000 });
  await btn.click();
}

test.describe("工位页契约 — ${primary.name}", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_ROUTE, { waitUntil: "domcontentloaded" });
    await assertAuthenticated(page);
    await waitForWorkstation(page);
  });

  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test("W1 验证工位页打开与查看态表单禁用", async ({ page }) => {
    const inputs = page.locator(sel.workstation.actualForm + " input");
    const total = await inputs.count();
    if (total > 0) {
      const disabled = await page.locator(sel.workstation.actualForm + " input[disabled]").count();
      expect(disabled, "查看态实绩区输入应全部禁用").toBe(total);
    }
  });

  test("W2 验证进阶查询选计划后炉号回填", async ({ page }) => {
    test.setTimeout(90_000);
    // 拦截计划查询返回一行模拟数据（确定性验证回填逻辑，不依赖 SIT 种子）
    await page.route("**/queryPage*", (route) =>
      route.fulfill(successEnvelope("模拟", { records: [{ plan_no: "MOCK-PLAN-01", heat_no: "MOCK-HEAT-01" }], total: 1 })),
    );
    await page.route("**/getByHeat*", (route) => route.fulfill(successEnvelope()));

    await clickAction(page, /进阶查询|高级查询/);
    const advanced = page.locator(sel.workstation.advanced + " " + sel.row.split(",")[0]).first();
    const visible = await advanced.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    if (!visible) {
      test.skip(true, "进阶面板为项目自定义结构，请按实际改写定位器");
    }
    await advanced.click();

    // 回填断言：顶部查询区炉号输入框非空
    const heatInput = page.locator(sel.workstation.commandCard + " input").first();
    await expect
      .poll(async () => (await heatInput.count()) > 0 ? await heatInput.inputValue() : "", { timeout: 10_000 })
      .not.toBe("");
  });

  test("W3 验证新增后实绩表单可编辑", async ({ page }) => {
    await page.route("**/getByHeat*", (route) => route.fulfill(successEnvelope()));
    await clickAction(page, /新增|新建/);
    const enabled = await page.locator(sel.workstation.actualForm + " input:not([disabled])").count();
    expect(enabled, "录入态实绩区应存在可编辑输入").toBeGreaterThan(0);
  });

  test("W4 验证保存契约（拦截 save，断言炉号）", async ({ page }) => {
    const TEST_HEAT = "E2E-HEAT-0001";
    await page.route("**/save*", (route) => route.fulfill(successEnvelope()));
    await page.route("**/getByHeat*", (route) => route.fulfill(successEnvelope()));

    const heatInput = page.locator(sel.workstation.commandCard + " input").first();
    if ((await heatInput.count()) > 0) await heatInput.fill(TEST_HEAT);
    await clickAction(page, /新增|新建/);

    const saveReq = page.waitForRequest((r) => /\\/save/.test(r.url()) && r.method() === "POST", { timeout: 15_000 });
    await clickAction(page, /保存/);
    const req = await saveReq;
    const body = (req.postDataJSON() ?? {});
    expect(
      JSON.stringify(body).includes(TEST_HEAT) || Object.values(body).some((v) => String(v ?? "").includes(TEST_HEAT)),
      "保存请求应携带炉号",
    ).toBeTruthy();
  });

  test("W5 验证提交契约（拦截 submit + 确认弹窗）", async ({ page }) => {
    const TEST_HEAT = "E2E-HEAT-0002";
    await page.route("**/submit*", (route) => route.fulfill(successEnvelope()));
    await page.route("**/getByHeat*", (route) => route.fulfill(successEnvelope()));

    const heatInput = page.locator(sel.workstation.commandCard + " input").first();
    if ((await heatInput.count()) > 0) await heatInput.fill(TEST_HEAT);
    await clickAction(page, /新增|新建/);

    const submitReq = page.waitForRequest((r) => /\\/submit/.test(r.url()) && r.method() === "POST", { timeout: 15_000 });
    await clickAction(page, /提交/);
    // 确认弹窗（适配层取选择器：ElMessageBox / ant Modal.confirm）
    const confirmBtn = page.locator(sel.messageBoxConfirm).first();
    if (await confirmBtn.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
      await confirmBtn.click();
    }
    const req = await submitReq;
    expect(req.method()).toBe("POST");
    expect(
      JSON.stringify(req.postDataJSON() ?? {}).includes(TEST_HEAT),
      "提交请求应携带炉号",
    ).toBeTruthy();
  });
});
`;
}

// ── 模板：环境与门禁 ─────────────────────────────
function tplEnvironment(baseUrl, apiPrefix, writeConfirm) {
  return `/**
 * environment.js — E2E 环境配置与安全门禁
 *
 * 环境变量:
 *   E2E_BASE_URL / E2E_API_BASE / E2E_API_PREFIX / E2E_TOKEN / E2E_SUCCESS_CODE
 *   E2E_ENABLE_WRITE=1 + E2E_WRITE_CONFIRM + E2E_ALLOWED_WRITE_HOSTS（写入门禁）
 *
 * 登录态双模式（auth-setup project）:
 *   - 人工模式（默认，兼容验证码/SSO/MFA）: 直接运行，在弹出的浏览器中人工完成登录
 *   - 自动模式: 设置 E2E_LOGIN_USER / E2E_LOGIN_PASSWORD 后自动填表
 *   E2E_LOGIN_URL / E2E_LOGIN_PATH / E2E_LOGIN_USER_SELECTOR / E2E_LOGIN_PASSWORD_SELECTOR 可覆盖
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
export const E2E_LOGIN_PATH_DEFAULT = "/login";
export const MANUAL_LOGIN_TIMEOUT_MS = Number(process.env.E2E_MANUAL_LOGIN_TIMEOUT_MS || 240000);

export function requireStoredAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      "缺少登录态 " + AUTH_FILE + "。请先执行 npm run e2e:auth（人工或自动模式），或手动放置 .auth/user.json。",
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

/**
 * 从页面业务请求中捕获完整 Authorization 头（禁止截断 Bearer 前缀——真实系统可能用小写 bearer）
 */
export function captureAuthorizationHeader(page) {
  let authorization = "";
  page.on("request", (request) => {
    if (authorization || !isBusinessApi(request.url())) return;
    const header = request.headers()["authorization"]?.trim() || "";
    if (/^bearer\\s+\\S+$/i.test(header)) authorization = header;
  });
  return () => authorization;
}
`;
}

// ── 模板：网络监控（含证据附件）──────────────────
function tplNetworkMonitor() {
  return `/**
 * network-monitor.js — 页面级网络/控制台监控
 *
 * 硬门（源自 wl-ui-produce 实战）：
 * 1. 必须观察到至少一个业务接口响应 —— 只看页面元素不看接口 = 假通过
 * 2. HTTP >= 400 或 业务 code != 成功码 → 失败
 * 3. console error / pageerror → 失败（忽略 favicon / sourcemap 噪音）
 * 4. 只读模式下观察到写请求（POST 写路径 / PUT / DELETE / PATCH）→ 失败
 * 5. assertClean 支持证据附件：观察到的全部业务响应与失败明细 attach 进 HTML 报告
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

  function attachEvidence(testInfo, name, payload) {
    if (!testInfo?.attach) return;
    testInfo.attach(name, {
      body: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      contentType: "application/json",
    });
  }

  return {
    get observedCount() {
      return observed.length;
    },
    observed,
    async assertClean(label, testInfo) {
      await Promise.allSettled(pending);
      attachEvidence(testInfo, "e2e-business-responses.json", observed);
      if (observed.length === 0) {
        throw new Error(
          "[" + (label || "network-monitor") + "] 未观察到任何业务接口响应，不能仅凭页面元素判定链路通过。",
        );
      }
      if (failures.length > 0) {
        attachEvidence(testInfo, "e2e-failures.json", failures);
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

// ── 模板：API 探针 / 清理编排 ───────────────────
function tplApiProbe() {
  return `/**
 * api-probe.js — API 请求探针（信封校验）
 */
import { E2E_API_BASE, SUCCESS_CODE } from "./environment.js";

function authorizationHeaders(token) {
  const value = (token || "").trim();
  if (!value) throw new Error("未提供认证 token（E2E_TOKEN 或页面捕获的 Authorization），禁止执行验证或清理请求。");
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

// ── 模板：页面清单（含路由来源标记）──────────────
function tplPagesFixture(pages, sourceType) {
  const entries = pages
    .map((p) => {
      const q = JSON.stringify(p.query || []);
      const c = JSON.stringify(p.columns || []);
      const t = JSON.stringify(p.tabs || []);
      return `  { pageId: ${JSON.stringify(String(p.pageId || ""))}, name: ${JSON.stringify(p.name)}, route: ${JSON.stringify(p.route)}, routeSource: ${JSON.stringify(p.routeSource || "spec")}, writable: ${p.writable ? "true" : "false"}, query: ${q}, columns: ${c}, tabs: ${t} },`;
    })
    .join("\n");
  return `/**
 * pages.js — 页面清单（由 wl-skills-test run-gen --type e2e 自动生成，来源: ${sourceType}）
 *
 * 路由来源（routeSource）:
 *   "spec"    — page-spec 显式 route 字段（最可信）
 *   "map"     — routes.json 映射（pageId → 真实路由，推荐，真实路由常与目录无关）
 *   "derived" — 由 dir 推导（src/views/xxx → /xxx），真实系统不一定成立，务必人工核对！
 */
export const PAGES = [
${entries}
];
`;
}

// ── 模板：用例归属清单（config 加载即强校验）──────
function tplSuites(hasDetail, hasWorkstation) {
  return `/**
 * suites.js — E2E 用例唯一归属清单 + 工程约束强校验（源自 wl-ui-produce 实战）
 *
 * 新增 *.spec.js 时必须先在这里归类；playwright.config.js 加载阶段会调用
 * assertE2ESpecCatalog()，发现以下任一问题直接 fail——防止"文件写了但从未被执行"的假闭环：
 *   1. 未归类 / 重复归属 / 清单存在但文件缺失
 *   2. test.only / describe.only（禁止只跑局部用例）
 *   3. 写入组 spec 缺安全标记（requireWriteApproval / new RunLedger / finally / cleanupLedger）
 *   4. 写入组截断 Bearer 前缀（真实 API 验证与清理将失去认证方案）
 *   5. 隔离组未声明 test.skip B 组（隔离声明漂移）
 *   6. UI 契约组未使用 page.route 拦截（禁止把真实写入误归为模拟测试）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_SPEC = ["auth-setup.spec.js"];
export const ROUND1_CORE_SPEC = ["round1-readonly.spec.js"];
// 有 page-spec 列信息时才生成逐页深度 spec（与实际生成物联动，防"清单有但文件缺失"）
export const ROUND1_DETAIL_SPECS = [${hasDetail ? '"round1-detail.spec.js"' : ""}];
export const UI_CONTRACT_SPECS = ["ui-contract.spec.js"];
export const WORKSTATION_SPECS = [${hasWorkstation ? '"workstation.spec.js"' : ""}];
export const QUARANTINED_FLOW_SPECS = ["quarantine.spec.js"];
export const ROUND2_WRITE_SPECS = ["round2-write.spec.js"];
export const CLEANUP_SPEC = ["cleanup.spec.js"];

const OWNED_SPEC_GROUPS = [
  AUTH_SPEC,
  ROUND1_CORE_SPEC,
  ROUND1_DETAIL_SPECS,
  UI_CONTRACT_SPECS,
  WORKSTATION_SPECS,
  QUARANTINED_FLOW_SPECS,
  ROUND2_WRITE_SPECS,
  CLEANUP_SPEC,
];

export function specMatch(specs) {
  // 空清单匹配"永不"（Playwright 空 testMatch 会退化为匹配全部文件，必须显式排除）
  if (!specs || specs.length === 0) return [/\$a^/];
  return specs.map((name) => new RegExp(name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "$"));
}

export function assertE2ESpecCatalog(testDir) {
  const actual = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith(".spec.js"))
    .sort();
  const declared = OWNED_SPEC_GROUPS.flatMap((group) => [...group]);
  const duplicates = declared.filter((name, index) => declared.indexOf(name) !== index);
  const declaredSet = new Set(declared);
  const actualSet = new Set(actual);
  const unclassified = actual.filter((name) => !declaredSet.has(name));
  const missing = declared.filter((name) => !actualSet.has(name));

  if (duplicates.length || unclassified.length || missing.length) {
    throw new Error(
      [
        "E2E 用例归属清单不闭环。",
        duplicates.length ? "重复归属: " + [...new Set(duplicates)].join(", ") : "",
        unclassified.length ? "未归类: " + unclassified.join(", ") : "",
        missing.length ? "清单存在但文件缺失: " + missing.join(", ") : "",
      ]
        .filter(Boolean)
        .join("\\n"),
    );
  }

  const sourceOf = (name) => fs.readFileSync(path.join(testDir, name), "utf8");

  for (const name of actual) {
    const source = sourceOf(name);
    if (/\\btest\\.only\\s*\\(|\\btest\\.describe\\.only\\s*\\(/.test(source)) {
      throw new Error(name + " 包含 test.only，禁止提交只执行局部用例的测试文件。");
    }
  }

  for (const name of [...ROUND2_WRITE_SPECS]) {
    const source = sourceOf(name);
    const requiredSafetyMarkers = ["requireWriteApproval", "new RunLedger", "finally", "cleanupLedger"];
    const absent = requiredSafetyMarkers.filter((marker) => !source.includes(marker));
    if (absent.length) {
      throw new Error(name + " 缺少受控写入安全标记: " + absent.join(", "));
    }
    if (/\\.slice\\(\\s*["'\`]Bearer\\s+["'\`]\\.length\\s*\\)/.test(source)) {
      throw new Error(name + " 截断了 Bearer 前缀，真实 API 验证和清理请求将失去认证方案。");
    }
  }

  for (const name of QUARANTINED_FLOW_SPECS) {
    const source = sourceOf(name);
    if (/\\btest\\(\\s*["'\`]B\\d+/.test(source)) {
      throw new Error(name + " 的高风险 B 组存在未 skip 用例，禁止解除业务流隔离。");
    }
    if (!/\\btest\\.skip\\(\\s*["'\`]B\\d+/.test(source)) {
      throw new Error(name + " 未找到明确的 test.skip B 组，隔离声明可能已漂移。");
    }
  }

  for (const name of UI_CONTRACT_SPECS) {
    const source = sourceOf(name);
    if (!source.includes("page.route(")) {
      throw new Error(name + " 被归类为 UI 契约模拟，但未发现 page.route 拦截，禁止把真实写入误归为模拟测试。");
    }
  }

  // 工位页 save/submit 全部走拦截（零污染），无拦截声明的工位 spec 视为漂移
  for (const name of WORKSTATION_SPECS) {
    if (!name) continue;
    const source = sourceOf(name);
    if (!source.includes("page.route(")) {
      throw new Error(name + " 工位页测试必须 page.route 拦截 save/submit（零污染），否则应归入 round2 组。");
    }
  }
}
`;
}

// ── 模板：playwright 配置（7 project 编排）───────
function tplPlaywrightConfig() {
  return `/**
 * playwright.config.js — 7 层 project 编排（config 加载即执行归属清单强校验）
 *
 *   npm run e2e:auth        人工/自动登录生成 storageState
 *   npm run e2e             ROUND1 只读冒烟（零风险）
 *   npm run e2e:detail      ROUND1 逐页深度（搜索收敛/重置/字典翻译）
 *   npm run e2e:ui-contract UI 契约（page.route 拦截，不落库，任何环境可跑）
 *   npm run e2e:round2      ROUND2 受控写入（三重门禁，默认禁止）
 *   npm run e2e:quarantine:list  查看隔离组（默认全部 skip）
 *   npm run e2e:cleanup     按账本恢复清理
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
  AUTH_SPEC,
  ROUND1_CORE_SPEC,
  ROUND1_DETAIL_SPECS,
  UI_CONTRACT_SPECS,
  WORKSTATION_SPECS,
  QUARANTINED_FLOW_SPECS,
  ROUND2_WRITE_SPECS,
  CLEANUP_SPEC,
  specMatch,
  assertE2ESpecCatalog,
} from "./fixtures/suites.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, "tests");
// 用例归属清单 + 工程约束强校验（未归类/only/安全标记缺失等 → 配置加载即 fail）
assertE2ESpecCatalog(testDir);

const baseURL = process.env.E2E_BASE_URL || "http://localhost:8080";
const authFile = path.resolve(__dirname, ".auth/user.json");
const storedAuth = fs.existsSync(authFile) ? authFile : undefined;

const commonUse = {
  ...devices["Desktop Chrome"],
  baseURL,
  // 无下载浏览器时可用系统 Chrome：set E2E_CHANNEL=chrome（wl-ui-produce 形态）
  channel: process.env.E2E_CHANNEL || undefined,
  // 系统 Chrome 可能继承系统代理，旁路回环地址（mock/本地服务必需）
  launchOptions: process.env.E2E_CHANNEL ? { args: ["--proxy-bypass-list=<-loopback>"] } : undefined,
  locale: "zh-CN",
  screenshot: "only-on-failure",
  // video 需要 ffmpeg 二进制（默认关闭；E2E_VIDEO=1 且已 npx playwright install ffmpeg 时启用）
  video: process.env.E2E_VIDEO === "1" ? "retain-on-failure" : undefined,
  trace: "retain-on-failure",
  actionTimeout: 20_000,
  navigationTimeout: 45_000,
};

export default defineConfig({
  testDir,
  outputDir: "./reports/artifacts",
  fullyParallel: false,
  workers: 1, // B 端业务有状态，串行执行防脏数据
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./reports/html", open: "never" }],
    ["json", { outputFile: "./reports/results.json" }],
  ],
  projects: [
    { name: "auth-setup", testMatch: specMatch(AUTH_SPEC), use: { ...commonUse, storageState: undefined } },
    { name: "round1-readonly", testMatch: specMatch(ROUND1_CORE_SPEC), use: { ...commonUse, storageState: storedAuth } },
    { name: "round1-detail", testMatch: specMatch(ROUND1_DETAIL_SPECS), use: { ...commonUse, storageState: storedAuth } },
    { name: "ui-contract", testMatch: specMatch(UI_CONTRACT_SPECS), use: { ...commonUse, storageState: storedAuth } },
    { name: "workstation", testMatch: specMatch(WORKSTATION_SPECS), use: { ...commonUse, storageState: storedAuth } },
    { name: "round2-write", testMatch: specMatch(ROUND2_WRITE_SPECS), use: { ...commonUse, storageState: storedAuth } },
    { name: "quarantine", testMatch: specMatch(QUARANTINED_FLOW_SPECS), use: { ...commonUse, storageState: storedAuth } },
    { name: "cleanup", testMatch: specMatch(CLEANUP_SPEC), use: { ...commonUse, storageState: storedAuth } },
  ],
});
`;
}

// ── 模板：e2e/package.json（npm scripts 一键化）──
function tplPackageJson() {
  return JSON.stringify(
    {
      name: "e2e",
      private: true,
      type: "module",
      scripts: {
        "e2e:auth": "playwright test --project=auth-setup --headed",
        e2e: "playwright test --project=round1-readonly",
        "e2e:detail": "playwright test --project=round1-detail",
        "e2e:ui-contract": "playwright test --project=ui-contract",
        "e2e:workstation": "playwright test --project=workstation",
        "e2e:round2": "playwright test --project=round2-write",
        "e2e:round2:check": "playwright test --project=round2-write --list",
        "e2e:quarantine:list": "playwright test --project=quarantine --list",
        "e2e:cleanup": "playwright test --project=cleanup",
        "e2e:report": "playwright show-report reports/html",
      },
      devDependencies: {
        "@playwright/test": "^1.40.0",
      },
    },
    null,
    2,
  ) + "\n";
}

// ── 模板：auth-setup 登录双模式 ─────────────────
function tplAuthSetup() {
  return `/**
 * 登录态准备 — 双模式
 *
 * 人工模式（默认，兼容验证码/SSO/MFA）:
 *   npm run e2e:auth → 在弹出的浏览器中人工完成登录 → 自动保存 storageState
 * 自动模式（无验证码的系统）:
 *   set E2E_LOGIN_USER / E2E_LOGIN_PASSWORD 后 npm run e2e:auth
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  E2E_BASE_URL,
  E2E_LOGIN_PATH_DEFAULT,
  MANUAL_LOGIN_TIMEOUT_MS,
  AUTH_FILE,
} from "../support/environment.js";

test.describe("登录态准备", () => {
  test.beforeAll(() => {
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  });

  test.afterAll(() => {
    // 登录态文件供后续 project 复用；重新登录前可删除 .auth 目录
  });

  test("验证登录并保存登录态", async ({ page }) => {
    const user = process.env.E2E_LOGIN_USER || "";
    const password = process.env.E2E_LOGIN_PASSWORD || "";
    const auto = Boolean(user && password);

    if (auto) {
      // ── 自动模式 ──
      const loginUrl = process.env.E2E_LOGIN_URL || E2E_BASE_URL + (process.env.E2E_LOGIN_PATH || E2E_LOGIN_PATH_DEFAULT);
      const userSelector =
        process.env.E2E_LOGIN_USER_SELECTOR ||
        'input[placeholder*="账号"], input[placeholder*="用户名"], input[name="username"], input[type="text"]';
      const passwordSelector = process.env.E2E_LOGIN_PASSWORD_SELECTOR || 'input[placeholder*="密码"], input[type="password"]';

      await page.goto(loginUrl);
      await page.locator(userSelector).first().fill(user);
      await page.locator(passwordSelector).first().fill(password);
      await page.getByRole("button", { name: /登录|登\\s*录|LOGIN/i }).first().click();
    } else {
      // ── 人工模式（验证码/SSO/MFA 均可）──
      await page.goto(E2E_BASE_URL);
      if (/login|oauth/i.test(page.url())) {
        console.log("[auth] 请在浏览器中完成登录（支持验证码/SSO）；成功进入系统后脚本自动保存登录态。");
      }
    }

    await page.waitForURL((url) => !/login|oauth/i.test(String(url)), { timeout: MANUAL_LOGIN_TIMEOUT_MS });
    await page.context().storageState({ path: AUTH_FILE });
    expect(fs.existsSync(AUTH_FILE), "storageState 应已保存").toBe(true);
    console.log("[auth] 登录态已保存: " + AUTH_FILE);
  });
});
`;
}

// ── 模板：ROUND1 只读冒烟（证据附件版）──────────
function tplRound1() {
  return `/**
 * ROUND1 只读冒烟 — 批量页面（fixtures/pages.js）
 *
 * 硬门:
 * 1. 登录态有效（跳转登录页 = 失败，不是 skip）
 * 2. 页面必须渲染表格或明确空态（防白屏）
 * 3. 必须观察到至少一个业务响应（防"只看元素"的假通过），响应/失败清单 attach 进报告
 * 4. HTTP >= 400 / 业务码非成功 / console error / pageerror 任一出现即失败
 * 5. 只读模式下观察到写请求即失败；可写页面必须存在可见业务操作按钮
 */
import { test, expect } from "@playwright/test";
import { monitorPage } from "../support/network-monitor.js";
import { assertAuthenticated, isBusinessApi } from "../support/environment.js";
import { sel } from "../support/selectors.js";
import { PAGES } from "../fixtures/pages.js";

async function waitForContent(page) {
  await page.waitForSelector(sel.gridWait, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

test.describe("ROUND1 只读冒烟", () => {
  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  for (const pageEntry of PAGES) {
    test.describe(\`\${pageEntry.pageId} \${pageEntry.name}\`, () => {
      test.beforeEach(async ({ page }) => {
        await page.goto(pageEntry.route, { waitUntil: "domcontentloaded" });
      });

      test(\`验证页面渲染表格或明确空态 [\${pageEntry.pageId}]\`, async ({ page }, testInfo) => {
        test.setTimeout(60_000);
        const monitor = monitorPage(page, { readonly: true, isBusinessApi });

        await assertAuthenticated(page);
        await waitForContent(page);

        const rowCount = await page.locator(sel.row).count();
        const hasEmptyState = (await page.locator(sel.empty).count()) > 0;
        expect(
          rowCount > 0 || hasEmptyState,
          pageEntry.pageId + " 未渲染表格数据或明确空态，疑似白屏或模块未挂载",
        ).toBeTruthy();

        await monitor.assertClean(pageEntry.pageId + " round1", testInfo);
      });

      if (pageEntry.writable) {
        test(\`检查业务操作入口可见 [\${pageEntry.pageId}]\`, async ({ page }, testInfo) => {
          const monitor = monitorPage(page, { readonly: true, isBusinessApi });
          await assertAuthenticated(page);
          await waitForContent(page);

          const businessAction = page.getByRole("button", {
            name: /新增|修改|编辑|删除|保存|提交|下达|确认|完成|退回/,
          });
          await expect(
            businessAction.first(),
            pageEntry.pageId + " 标记为可写，但没有可见业务操作按钮",
          ).toBeVisible();

          await monitor.assertClean(pageEntry.pageId + " round1-btn", testInfo);
        });
      }
    });
  }
});
`;
}

// ── 模板：ROUND1 逐页深度（A 组深用例）──────────
function tplRound1Detail() {
  return `/**
 * ROUND1 逐页深度 — 列头渲染 / 搜索收敛 / 重置恢复 / 字典翻译（A 组深用例）
 *
 * 与冒烟不同：深度用例逐列断言（AG Grid col-id / el-table 表头 label）、
 * 验证"搜索→结果收敛→重置→恢复全量"闭环、验证字典列翻译为中文（而非原始编码）。
 * SIT 无数据时优雅 skip（不是假通过也不是硬失败）。
 */
import { test, expect } from "@playwright/test";
import { assertAuthenticated } from "../support/environment.js";
import { sel } from "../support/selectors.js";
import { PAGES } from "../fixtures/pages.js";

async function waitForGrid(page, timeout = 30_000) {
  await page.waitForSelector(sel.gridWait, { timeout });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

async function rowCount(page) {
  return page.locator(sel.row).count();
}

async function cellText(page, colName) {
  // AG Grid（steel 适配）: 按 col-id；el-table: 按表头 label 定位列索引
  if (typeof sel.colCell === "function") {
    const agCell = page.locator(sel.colCell(colName));
    if ((await agCell.count()) > 0) return ((await agCell.first().textContent()) ?? "").trim();
  }
  const headers = page.locator(sel.headerCells);
  const headerCount = await headers.count();
  for (let i = 0; i < headerCount; i++) {
    const text = ((await headers.nth(i).textContent()) ?? "").trim();
    if (text.includes(colName)) {
      const cell = page.locator(sel.row).first().locator("td").nth(i);
      if ((await cell.count()) > 0) return ((await cell.textContent()) ?? "").trim();
    }
  }
  return "";
}

async function fillQueryInput(page, label, value) {
  const input = page
    .locator(sel.queryForm || ".el-form-item, .el-row, form")
    .filter({ hasText: label })
    .locator('input[type="text"], input:not([type])')
    .first();
  await expect(input, "查询输入框 " + label + " 应可见").toBeVisible({ timeout: 10_000 });
  await input.fill(value);
}

async function clickButton(page, name) {
  const btn = page.getByRole("button", { name }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

const DICT_CJK_ONLY = process.env.E2E_DICT_CJK_ONLY !== "0";

test.describe("ROUND1 逐页深度", () => {
  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  for (const pageEntry of PAGES) {
    const firstQuery = pageEntry.query?.[0];
    const columns = pageEntry.columns || [];

    test.describe(\`\${pageEntry.pageId} \${pageEntry.name} 深度\`, () => {
      test.beforeEach(async ({ page }) => {
        await page.goto(pageEntry.route, { waitUntil: "domcontentloaded" });
        await assertAuthenticated(page);
        await waitForGrid(page);
      });

      if (columns.length > 0) {
        test(\`验证列头按规范渲染 [\${pageEntry.pageId}]\`, async ({ page }) => {
          const rows = await rowCount(page);
          if (rows === 0) test.skip(true, "SIT 无数据，跳过列级断言");
          const headerTexts = ((await page.locator(sel.headerCells).allTextContents()) || []).join("|");
          const missingLabels = columns
            .slice(0, 5)
            .filter((c) => c.label && !headerTexts.includes(c.label))
            .map((c) => c.label);
          expect(
            missingLabels,
            \`\${pageEntry.pageId} 以下列头缺失或改名: \${missingLabels.join(",")}\`,
          ).toHaveLength(0);
        });
      }

      // 子表页签（DETAIL_TABS）：逐页签点击后校验网格渲染
      for (const tab of pageEntry.tabs || []) {
        if (!tab.title) continue;
        test(\`验证子表页签渲染: \${tab.title} [\${pageEntry.pageId}]\`, async ({ page }) => {
          const tabItem = page.getByRole("tab", { name: tab.title }).first();
          const found = await tabItem.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
          if (!found) test.skip(true, "未找到页签 " + tab.title + "（非页签布局请移除本用例）");
          await tabItem.click();
          await page.waitForSelector(sel.gridWait, { timeout: 30_000 });
          const rows = await rowCount(page);
          const hasEmpty = (await page.locator(sel.empty).count()) > 0;
          expect(rows > 0 || hasEmpty, tab.title + " 页签应渲染网格或空态").toBeTruthy();
        });
      }

      if (firstQuery && firstQuery.label && columns.length > 0) {
        test(\`验证搜索收敛并重置恢复 [\${pageEntry.pageId}]\`, async ({ page }) => {
          const before = await rowCount(page);
          if (before === 0) test.skip(true, "SIT 无数据，跳过搜索断言");

          const probeColumn = columns.find((c) => c.name === firstQuery.name) || columns[0];
          const probeValue = await cellText(page, probeColumn.label || probeColumn.name);
          expect(probeValue, "取首行探针值不应为空").not.toBe("");

          await fillQueryInput(page, firstQuery.label, probeValue);
          await clickButton(page, /查询|搜索/);

          const after = await rowCount(page);
          expect(after, "搜索结果应至少 1 行").toBeGreaterThanOrEqual(1);
          expect(after, "搜索结果不应多于全量").toBeLessThanOrEqual(before);

          await clickButton(page, /重置/);
          const resetRows = await rowCount(page);
          expect(resetRows, "重置后应恢复不少于搜索结果的数据量").toBeGreaterThanOrEqual(after);
        });
      }

      const dictColumns = columns.filter((c) => c.dict && c.name);
      if (dictColumns.length > 0) {
        test(\`验证字典列翻译为中文 [\${pageEntry.pageId}]\`, async ({ page }) => {
          const rows = await rowCount(page);
          if (rows === 0) test.skip(true, "SIT 无数据，跳过字典断言");
          const col = dictColumns[0];
          const text = await cellText(page, col.label || col.name);
          if (!text) test.skip(true, "字典列首行为空，跳过");
          if (DICT_CJK_ONLY) {
            expect(
              /[\\u4e00-\\u9fff]/.test(text),
              \`\${col.name} 应显示字典中文（当前值: \${text}），若原始编码即中文可设 E2E_DICT_CJK_ONLY=0\`,
            ).toBe(true);
          }
          expect(text, "字典列不应显示 0/1 原始标识").not.toMatch(/^(0|1|true|false)$/i);
        });
      }
    });
  }
});
`;
}

// ── 模板：UI 契约（page.route 拦截，不落库）──────
function tplUiContract() {
  return `/**
 * UI 契约验证 — page.route 拦截写请求，验证端点与 payload 契约（不落库）
 *
 * 价值: 无安全测试数据/危险流程/任意环境下都能验证前端行为契约。
 * 声明: 拦截结果不能作为真实落库、流程状态或外部系统集成的通过证据（见 fixtures/suites.js 校验）。
 *
 * 断言: 保存请求 URL 匹配写端点模式 + 请求体携带业务键 + 前端对成功信封的正确反应。
 */
import { test, expect } from "@playwright/test";
import { assertAuthenticated } from "../support/environment.js";
import { sel } from "../support/selectors.js";
import { PAGES } from "../fixtures/pages.js";

function successEnvelope(message = "成功") {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 2000, message, data: "MOCK-ID" }),
  };
}

async function waitForGrid(page, timeout = 30_000) {
  await page.waitForSelector(sel.gridWait, { timeout });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

const WRITE_PATTERN = /\\/(save|updateById|submit|release|confirm)(?:[/?]|$)/i;

test.describe("UI 契约（拦截模拟）", () => {
  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  for (const pageEntry of PAGES.filter((p) => p.writable)) {
    test.describe(\`\${pageEntry.pageId} \${pageEntry.name}\`, () => {
      test.beforeEach(async ({ page }) => {
        await page.goto(pageEntry.route, { waitUntil: "domcontentloaded" });
      });

      test(\`验证新增请求契约（拦截，不落库）[\${pageEntry.pageId}]\`, async ({ page }) => {
        test.setTimeout(90_000);

        // 拦截全部写请求 → 成功信封；查询真实放行（页面需要真实数据打开）
        await page.route("**/*", (route) => {
          const req = route.request();
          if (req.method() === "POST" && WRITE_PATTERN.test(new URL(req.url()).pathname)) {
            return route.fulfill(successEnvelope("UI 契约模拟成功"));
          }
          return route.continue();
        });

        await assertAuthenticated(page);
        await waitForGrid(page);

        const addButton = page.getByRole("button", { name: /新增|新建|添加/ }).first();
        await expect(addButton, pageEntry.pageId + " 应有新增按钮").toBeVisible({ timeout: 10_000 });
        await addButton.click();

        const dialog = page.locator(sel.dialog).first();
        const dialogVisible = await dialog.waitFor({ state: "visible", timeout: 10_000 }).then(
          () => true,
          () => false,
        );
        if (!dialogVisible) {
          test.skip(true, pageEntry.pageId + " 新增非弹窗模式（行内编辑/跳转页），请按实际交互改写");
        }

        // 测试填充钩子优先（见 references/test-fill-standard.md）；否则填第一个可见文本框
        const fillBtn = dialog.locator('[data-testid="wl-test-fill"], [data-testid="steel-test-fill"]').first();
        if ((await fillBtn.count()) > 0) {
          await fillBtn.click();
        } else {
          const input = dialog.locator('input[type="text"], input:not([type])').first();
          if ((await input.count()) > 0) await input.fill("UI_CONTRACT");
        }

        const writeRequest = page.waitForRequest(
          (r) => WRITE_PATTERN.test(new URL(r.url()).pathname) && r.method() === "POST",
          { timeout: 15_000 },
        );
        await dialog.locator(sel.dialogConfirm).last().click();
        const req = await writeRequest;

        expect(req.method(), "写请求应为 POST").toBe("POST");
        const body = req.postDataJSON() ?? {};
        expect(
          Object.keys(body).length > 0 || req.postData(),
          "写请求应携带请求体（payload 契约）",
        ).toBeTruthy();
      });
    });
  }
});
`;
}

// ── 模板：ROUND2 UI 级受控写入（含 test-fill 钩子）──
function tplRound2UI(primary, apiPrefix, ctx, uiFields, testFill) {
  const removeOp = (ctx.summary?.operations || []).find((o) => o.key === "remove");
  const pageOp = (ctx.summary?.operations || []).find((o) => o.key === "page");
  const createOp = (ctx.summary?.operations || []).find((o) => o.key === "create");
  const queryPath = pageOp?.externalPath || "";
  const removePath = removeOp?.externalPath || "";
  const createPath = createOp?.externalPath || "";
  const fillLines = uiFields
    .slice(0, 5)
    .map(
      (f) =>
        // label/name 经 JSON.stringify 转义后注入选择器（含引号的标签此前会生成语法错误的 spec）
        `    await dialog.locator('input[placeholder*=${JSON.stringify(String(f.label || ""))}], input[placeholder*=${JSON.stringify(String(f.name || ""))}]').first().fill("AT_" + businessKey); // ${String(f.name || "").replace(/\*\//g, "")}（日期/字典控件请按实际改写）`,
    )
    .join("\n");
  const testFillBlock = testFill
    ? `      // 测试填充钩子（推荐，见 references/test-fill-standard.md）：按字典快照/字段语义填充，比 placeholder 猜填健壮
      const fillBtn = dialog.locator('[data-testid="wl-test-fill"], [data-testid="steel-test-fill"]').first();
      if ((await fillBtn.count()) > 0) {
        await fillBtn.click();
      }
`
    : "";

  return `/**
 * ROUND2 受控写入（UI 级数据闭环）— ${primary.name}
 *
 * 硬门禁（三重确认，默认禁止写入）:
 *   E2E_ENABLE_WRITE=1 + E2E_WRITE_CONFIRM=<确认串> + E2E_ALLOWED_WRITE_HOSTS=<目标主机>
 *
 * 闭环: UI 新增 → 捕获保存响应真实主键 → API 真实落库校验 → 账本登记 → 精确主键清理 → 零污染复查
 */
import { test, expect } from "@playwright/test";
import { sel } from "../support/selectors.js";
import { RunLedger } from "../support/run-ledger.js";
import { cleanupLedger } from "../support/cleanup.js";
import { apiRequest } from "../support/api-probe.js";
import {
  requireStoredAuth,
  requireWriteApproval,
  assertAuthenticated,
  captureAuthorizationHeader,
  isBusinessApi,
  SUCCESS_CODE,
} from "../support/environment.js";

const PAGE_ROUTE = ${JSON.stringify(primary.route)};
const QUERY_PATH = ${JSON.stringify(queryPath)}; // 空值表示 API 事实待补，所属组保持 skip
const CREATE_PATH = ${JSON.stringify(createPath)};
const DELETE_PATH = ${JSON.stringify(removePath)};
const QUERY_METHOD = ${JSON.stringify(pageOp?.method || "")};
const CREATE_METHOD = ${JSON.stringify(createOp?.method || "")};
const DELETE_METHOD = ${JSON.stringify(removeOp?.method || "")};

// 主键精确匹配（与 run-api 同口径：任意字段值全等，不做子串匹配防误命中）
const hasRecordId = (records, id) =>
  (Array.isArray(records) ? records : []).some(
    (r) => r && typeof r === "object" && Object.values(r).some((v) => v !== null && v !== undefined && typeof v !== "object" && String(v) === String(id)),
  );

test.describe("ROUND2 受控写入(UI) — ${primary.name}", () => {
  test.beforeAll(() => {
    requireStoredAuth();
    requireWriteApproval();
  });

  test.afterAll(() => {
    // 账本文件保留在 reports/ledgers 供审计与恢复清理
  });

  test("新增数据真实落库并零污染清理", async ({ page, request }, testInfo) => {
    const ledger = new RunLedger();
    const businessKey = "AT_" + ledger.runId;
    const getAuthorization = captureAuthorizationHeader(page);
    let authorization = "";

    try {
      await page.goto(PAGE_ROUTE, { waitUntil: "domcontentloaded" });
      await assertAuthenticated(page);

      // 1. UI 新增（业务键含 runId 便于识别与清理）
      await page.getByRole("button", { name: /新增|新建|添加/ }).first().click();
      const dialog = page.locator(sel.dialog).first();
      await expect(dialog).toBeVisible();
${testFillBlock}${fillLines}

      const savePromise = page.waitForResponse(
        (r) => isBusinessApi(r.url()) && new URL(r.url()).pathname === CREATE_PATH && r.request().method() === CREATE_METHOD,
        { timeout: 30_000 },
      );
      await dialog.locator(sel.dialogConfirm).last().click();
      const saveResponse = await savePromise;
      const envelope = await saveResponse.json().catch(() => ({}));
      expect(saveResponse.status(), String(envelope.message || "")).toBeLessThan(400);
      expect(Number(envelope.code), "业务码应为成功码").toBe(SUCCESS_CODE);

      // data 可能是纯主键，也可能是 { id } 对象信封（旧实现 String(obj) 得 "[object Object]" 污染账本）
      const rawId = envelope.data;
      const recordId =
        rawId === null || rawId === undefined
          ? ""
          : typeof rawId === "object"
            ? String(rawId.id ?? rawId.pkId ?? rawId.uuid ?? "")
            : String(rawId);
      expect(recordId, "新增接口必须返回真实业务主键，才能执行零污染清理").not.toBe("");
      authorization = getAuthorization() || saveResponse.request().headers()["authorization"] || "";
      expect(authorization, "未捕获到保存请求的 Authorization，无法执行 API 校验与清理").not.toBe("");
      testInfo.attach("round2-save.json", {
        body: Buffer.from(JSON.stringify({ recordId, businessKey, url: saveResponse.url() }, null, 2), "utf8"),
        contentType: "application/json",
      });

      // 2. 账本登记（真实主键 + 精确清理动作）
      const deletePath = DELETE_PATH.includes("{id}") ? DELETE_PATH.replace("{id}", recordId) : DELETE_PATH;
      ledger.record({
        pageId: "ROUND2-UI",
        operation: { method: CREATE_METHOD, path: CREATE_PATH },
        recordId,
        businessKey,
        cleanup: DELETE_PATH.includes("{id}")
          ? { method: DELETE_METHOD, path: deletePath }
          : { method: DELETE_METHOD, path: deletePath, query: { id: recordId } },
      });

      // 3. 真实落库校验：queryPage 必须能查到刚写入的主键（size=100 防第一页漏查，精确匹配防误命中）
      const queried = await apiRequest(request, authorization, QUERY_METHOD, QUERY_PATH, { current: 1, size: 100 });
      const records = queried.data?.records || queried.records || [];
      expect(
        hasRecordId(records, recordId),
        "新增后未查询到测试主键 " + recordId + "，疑似未真实落库",
      ).toBeTruthy();
    } finally {
      // 4. 精确主键清理（失败保留账本，可按 E2E_LEDGER_FILE 恢复）
      if (ledger.getPending().length > 0 && authorization) {
        await cleanupLedger(request, authorization, ledger).catch((e) => {
          console.error("清理失败，账本保留: " + ledger.filePath, e);
        });
      }
    }

    // 5. 清理后复查（零污染验证）
    expect(ledger.summary().pending, "存在未清理记录，检查账本 " + ledger.filePath).toBe(0);
    const token = authorization || process.env.E2E_TOKEN || "";
    if (token) {
      const remaining = await apiRequest(request, token, QUERY_METHOD, QUERY_PATH, { current: 1, size: 100 });
      const remainRecords = remaining.data?.records || remaining.records || [];
      expect(
        !(remainRecords || []).some((r) => JSON.stringify(r).includes(ledger.runId)),
        "清理后仍存在本次测试数据",
      ).toBeTruthy();
    }
  });
});
`;
}

// ── 模板：ROUND2 API 级受控写入 ─────────────────
function tplRound2API(primary, apiPrefix, ctx) {
  const s = ctx.summary || {};
  const pageOp = (s.operations || []).find((o) => o.key === "page");
  const createOp = (s.operations || []).find((o) => o.key === "create");
  const removeOp = (s.operations || []).find((o) => o.key === "remove");
  const queryPath = pageOp?.externalPath || "";
  const createPath = createOp?.externalPath || "";
  const removePath = removeOp?.externalPath || "";
  const requiredFields = extractWritableFields(s);
  const payloadLines = requiredFields
    .map((f) => `    ${f.name}: ${dummyLiteral(f)}, // ${f.comment}`)
    .join("\n");

  return `/**
 * ROUND2 受控写入 — ${primary.name}（API 级数据闭环）
 *
 * 硬门禁（三重确认，默认禁止写入）:
 *   E2E_ENABLE_WRITE=1 + E2E_WRITE_CONFIRM=<确认串>（见 support/environment.js）+ E2E_ALLOWED_WRITE_HOSTS=<目标主机>
 *
 * 闭环: 新增 → 真实落库校验（queryPage 查询确认）→ 账本登记 → 精确主键清理 → 清理后复查（零污染）
 */
import { test, expect } from "@playwright/test";
import { RunLedger } from "../support/run-ledger.js";
import { cleanupLedger } from "../support/cleanup.js";
import { apiRequest } from "../support/api-probe.js";
import { requireWriteApproval } from "../support/environment.js";

const QUERY_PATH = ${JSON.stringify(queryPath)};
const CREATE_PATH = ${JSON.stringify(createPath)};
const DELETE_PATH = ${JSON.stringify(removePath)};
const QUERY_METHOD = ${JSON.stringify(pageOp?.method || "")};
const CREATE_METHOD = ${JSON.stringify(createOp?.method || "")};
const DELETE_METHOD = ${JSON.stringify(removeOp?.method || "")};

// 主键精确匹配（与 run-api 同口径：任意字段值全等，不做子串匹配防误命中）
const hasRecordId = (records, id) =>
  (Array.isArray(records) ? records : []).some(
    (r) => r && typeof r === "object" && Object.values(r).some((v) => v !== null && v !== undefined && typeof v !== "object" && String(v) === String(id)),
  );

function buildPayload(runId) {
  return {
${payloadLines}
  };
}

test.describe("ROUND2 受控写入 — ${primary.name}", () => {
  test.beforeAll(() => {
    requireWriteApproval();
  });

  test.afterAll(() => {
    // 汇总信息在用例内输出；账本文件保留在 reports/ledgers 供审计与恢复清理
  });

  test("新增数据真实落库并零污染清理", async ({ request }, testInfo) => {
    const token = process.env.E2E_TOKEN || "";
    const ledger = new RunLedger();
    const businessKey = "AT_" + ledger.runId;

    try {
      // 1. 新增（契约必填字段构造合法 payload，业务键含 runId 便于识别与清理）
      const payload = { ...buildPayload(ledger.runId), remark: businessKey };
      const created = await apiRequest(request, token, CREATE_METHOD, CREATE_PATH, payload);
      // data 可能是纯主键，也可能是 { id } 对象信封（旧实现 String(obj) 得 "[object Object]" 污染账本）
      const rawId = created.data;
      const recordId =
        rawId === null || rawId === undefined
          ? ""
          : typeof rawId === "object"
            ? String(rawId.id ?? rawId.pkId ?? rawId.uuid ?? "")
            : String(rawId);
      expect(recordId, "新增接口必须返回真实业务主键，才能执行零污染清理").not.toBe("");
      testInfo.attach("round2-save.json", {
        body: Buffer.from(JSON.stringify({ recordId, businessKey }, null, 2), "utf8"),
        contentType: "application/json",
      });

      // 2. 账本登记（真实主键 + 精确清理动作）
      const deletePath = DELETE_PATH.includes("{id}") ? DELETE_PATH.replace("{id}", recordId) : DELETE_PATH;
      ledger.record({
        pageId: "ROUND2",
        operation: { method: CREATE_METHOD, path: CREATE_PATH },
        recordId,
        businessKey,
        cleanup: DELETE_PATH.includes("{id}")
          ? { method: DELETE_METHOD, path: deletePath }
          : { method: DELETE_METHOD, path: deletePath, query: { id: recordId } },
      });

      // 3. 真实落库校验：queryPage 必须能查到刚写入的数据（size=100 防第一页漏查，精确匹配防误命中）
      const queried = await apiRequest(request, token, QUERY_METHOD, QUERY_PATH, { current: 1, size: 100 });
      const records = queried.data?.records || queried.records || [];
      expect(
        hasRecordId(records, recordId),
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
    const remaining = await apiRequest(request, token, QUERY_METHOD, QUERY_PATH, { current: 1, size: 100 });
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

// ── 模板：隔离流程（高风险 B 组）─────────────────
function tplQuarantine() {
  return `/**
 * 隔离流程 — 高风险 B 组（默认全部 skip，fixtures/suites.js 强校验隔离声明不漂移）
 *
 * 隔离准入判断（满足任一即应隔离，禁止默认执行）:
 *   1. 共享业务状态变更（如计划下达/退回/分割——影响他人测试数据）
 *   2. 无测试专属数据（无法保证操作对象属于本次 runId）
 *   3. 无可靠逆操作（清理不能恢复原状态）
 *
 * 解除隔离前必须: 准备测试专属种子数据 + 实现可靠逆操作 + 移除 test.skip 并
 * 在 fixtures/suites.js 把本文件移出 QUARANTINED_FLOW_SPECS（否则加载即 fail）。
 *
 * 种子数据声明（解除隔离时填写）:
 *   - <计划号/单号>: <用途>（属测试账号所有，可安全变更）
 */
import { test, expect } from "@playwright/test";

test.describe("隔离流程（高风险，默认全部 skip）", () => {
  test.beforeEach(async ({ page }) => {
    // 隔离流程即使被解除也必须先过写入门禁
    const { requireWriteApproval } = await import("../support/environment.js");
    requireWriteApproval();
    await page.goto("/");
  });

  test.afterEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test.skip("B1 <按实际业务填写：如计划下达→验证状态→取消恢复>", async ({ page }) => {
    // 解除隔离后按 A/B/C 编号体系补全步骤与断言
    expect(true).toBe(true);
  });

  test.skip("B2 <按实际业务填写：如浇次分割/合并>", async ({ page }) => {
    expect(true).toBe(true);
  });
});
`;
}

// ── 模板：恢复清理 ──────────────────────────────
function tplCleanupSpec() {
  return `/**
 * 按账本恢复清理
 *
 * 用法: set E2E_LEDGER_FILE=./reports/ledgers/ledger-TSxxxx.json && npm run e2e:cleanup
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import { RunLedger } from "../support/run-ledger.js";
import { cleanupLedger } from "../support/cleanup.js";

test.describe("恢复清理", () => {
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

// ── 辅助：契约可写字段（API 级 payload 用）──────
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

function dummyLiteral(field) {
  const type = (field.type || "String").toLowerCase();
  if (type.includes("decimal") || type.includes("double") || type.includes("float")) return "1.5";
  if (type.includes("int") || type.includes("long")) return "1";
  if (type.includes("date")) return '"2026-01-01 00:00:00"';
  return '"AT_" + runId';
}

// ── 模板：README ────────────────────────────────
function tplReadme(pageName, writeConfirm, isUiRound2, pageCount, derivedCount, ui, workstation) {
  return `# E2E 测试工程 — ${pageName}

由 wl-skills-test run-gen --type e2e 生成（模式源自 wl-ui-produce 炼钢平台实战，7 层 project 编排）。
页面清单见 \`fixtures/pages.js\`（共 ${pageCount} 个页面）。${derivedCount > 0 ? `⚠️ 其中 ${derivedCount} 个路由为 dir 推导（routeSource: "derived"），真实路由常与目录无关（如 /lgBaseData/lgBaseDataMaster），请提供 routes.json（pageId→路由）或直接修正 pages.js。` : ""}

> UI 适配：\`support/selectors.js\` 当前为 **${ui}**（可 \`E2E_UI\` 运行时切换 element-plus/steel/ant-design，换组件库只改这一个文件）。
> 浏览器：默认 chromium；无下载环境可 \`set E2E_CHANNEL=chrome\` 使用系统 Chrome。${workstation ? "\n> 已生成工位页契约测试（workstation.spec.js，save/submit 全拦截零污染）。" : ""}

## 快速开始

\`\`\`bash
npm install
npx playwright install chromium

# 环境变量（按目标系统调整）
set E2E_BASE_URL=http://localhost:8080
set E2E_API_PREFIX=/api

npm run e2e:auth          # 0. 登录态（默认人工模式，兼容验证码/SSO；配 E2E_LOGIN_USER/PASSWORD 走自动）
npm run e2e               # 1. ROUND1 只读冒烟（零风险）
npm run e2e:detail        # 2. ROUND1 逐页深度（搜索收敛/重置/字典翻译）
npm run e2e:ui-contract   # 3. UI 契约（page.route 拦截，不落库，任何环境可跑）

# 4. ROUND2 受控写入（三重门禁，默认禁止）
set E2E_ENABLE_WRITE=1
set E2E_WRITE_CONFIRM=${writeConfirm}
set E2E_ALLOWED_WRITE_HOSTS=localhost
npm run e2e:round2

npm run e2e:quarantine:list   # 5. 查看隔离组（高风险流程，默认全部 skip）
set E2E_LEDGER_FILE=./reports/ledgers/ledger-TSxxxx.json
npm run e2e:cleanup           # 6. 按账本恢复清理
npm run e2e:report            # 查看 HTML 报告（含证据附件）
\`\`\`

## 7 层 project 与风险分层

| project | 风险 | 门禁 | 证据 |
|---------|------|------|------|
| auth-setup | 登录 | 无 | .auth/user.json |
| round1-readonly | 只读 | 无 | 业务响应 JSON 附件 |
| round1-detail | 只读 | 无 | 列级/搜索收敛断言 |
| ui-contract | 零（拦截） | 无 | 请求契约断言 |
| round2-write | 写入+自动清理 | ENABLE_WRITE + WRITE_CONFIRM + 主机白名单 | 账本 + 落库校验 |
| quarantine | 高风险 | 隔离声明（suites.js 校验不漂移） | — |
| cleanup | 精确清理 | 必须显式指定账本 | 账本状态 |

## 工程强校验（config 加载即 fail，防假闭环）

\`fixtures/suites.js\` 的 \`assertE2ESpecCatalog()\` 在 playwright.config.js 加载阶段执行：
未归类 spec / 重复归属 / 清单有但文件缺失 / test.only / 写入组缺安全标记（requireWriteApproval、new RunLedger、finally、cleanupLedger）/ 截断 Bearer 前缀 / 隔离声明漂移 / UI 契约缺 page.route —— 任一命中即拒绝运行。

也可独立执行: \`npx @agile-team/wl-skills-test e2e-check --target ./e2e\`

## 五道硬门

1. **假通过防线**：必须观察到至少一个业务接口响应，只看页面元素不算通过
2. **响应防线**：HTTP>=400 / 业务码非成功 / console error / pageerror 任一即失败
3. **只读防线**：只读套件观察到写请求（POST 写路径/PUT/DELETE）即失败
4. **零污染防线**：写入必须登记账本（真实主键+业务键含 runId），finally 清理+复查
5. **登录态防线**：跳转登录页=失败，不是 skip

ROUND2 当前为 **${isUiRound2 ? "UI 级闭环" : "API 级闭环"}**。API 路径来自契约或推断（TODO 标注处），请按 api.md 核对。
`;
}
