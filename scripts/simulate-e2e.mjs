/**
 * simulate-e2e.mjs — 沙箱模拟跑（v0.10.0）
 *
 * 不污染承诺：
 *   - wl-ui-produce 全程只读（page-spec 目录 + routes.sit.json 仅作生成输入）
 *   - 生成物/依赖/报告全在临时沙箱，结束即删
 *   - 被测系统 = 本进程内 mock 前端（steel-list-panel 形态）+ mock API（jh4j 信封）
 *
 * 执行方式（进程内驱动，规避本机 runner 兼容问题；CI/正常环境可同样用 playwright test 跑）：
 *   1. 读真实 page-spec（32 页）+ 真实路由 → generateE2eScaffold(--ui steel)
 *   2. e2e-check + node --check 全量校验生成物
 *   3. 沙箱安装 @playwright/test（作为 playwright 库使用）
 *   4. 用生成的 support/network-monitor.js + support/selectors.js + fixtures/pages.js
 *      真实驱动浏览器逐页执行 ROUND1 五硬门（goto → 网格渲染 → 行/空态 → 只读写检测 → 业务响应观测）
 *   5. 断言全部页面通过 + monitor 证据收集正常 + 零失败
 *
 * 环境自检：无 Chrome/无 wl-ui-produce 时优雅跳过（CI 安全）。
 * 浏览器优先级：E2E_CHANNEL（chrome/msedge）> 系统 Chrome > bundled chromium（需已 install）。
 */
import { createServer } from "node:http";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG_ROOT = "D:/office-project/wl/wl-skills-test";
const PRODUCE = "D:/office-project/wl/wl-ui-produce";
const SANDBOX = join(PKG_ROOT, ".tmp-simulate");
const step = (m) => console.log(`\n[Simulate] ${m}`);

// ── 环境自检（CI/异构机器优雅跳过）──
const hasChrome = existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe");
const hasBundled = ["chromium-1234", "chromium_headless_shell-1234"].some((d) => existsSync(join(process.env.LOCALAPPDATA || "", "ms-playwright", d)));
const hasProduce = existsSync(join(PRODUCE, "src/views/produce/steelmaking"));
if (!hasProduce) {
  console.log("[Simulate] SKIP: wl-ui-produce 不存在（只读源缺失）");
  process.exit(0);
}
if (!hasChrome && !hasBundled) {
  console.log("[Simulate] SKIP: 无可用浏览器（系统 Chrome 或 bundled chromium 均缺失）");
  process.exit(0);
}
const CHANNEL = hasChrome ? "chrome" : undefined; // bundled chromium 时 undefined

rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });
let mock = null;

try {
  // ── 1. 生成（真实输入）──
  step("读取真实 page-spec + routes.sit.json，--ui steel 生成 …");
  const { generateE2eScaffold } = await import(pathToFileURL(join(PKG_ROOT, "lib/e2e-generator.js")).href);
  const { e2eCheck } = await import(pathToFileURL(join(PKG_ROOT, "lib/e2e-check.js")).href);
  const routes = JSON.parse(readFileSync(join(PRODUCE, "e2e/fixtures/routes.sit.json"), "utf-8"));
  const routesCopy = join(SANDBOX, "routes-input.json");
  writeFileSync(routesCopy, JSON.stringify(routes));

  const gen = generateE2eScaffold(join(PRODUCE, "src/views/produce/steelmaking"), {
    outputDir: join(SANDBOX, "e2e"),
    routes: routesCopy,
    ui: "steel",
  });
  console.log(`  页面: ${gen.pages.length} | 文件: ${gen.files.length} | derived 告警: ${gen.warnings.length}`);
  if (gen.pages.length < 30) throw new Error(`页面数异常: ${gen.pages.length}`);
  if (gen.warnings.length !== 0) throw new Error(`存在 derived 路由: ${gen.warnings.join("; ")}`);

  for (const f of gen.files.filter((x) => x.endsWith(".js"))) {
    execSync(`node --check "${join(SANDBOX, "e2e", f)}"`, { stdio: "pipe" });
  }
  const check = await e2eCheck(join(SANDBOX, "e2e"));
  if (!check.pass) throw new Error(`e2e-check 未通过: ${check.findings.map((f) => f.message).join("; ")}`);
  console.log("  语法 + e2e-check: 全部通过");

  // ── 2. 沙箱安装 playwright（库用法）──
  step("沙箱 npm install @playwright/test（SKIP_BROWSER_DOWNLOAD）…");
  execSync("npm.cmd install --no-save --no-audit --no-fund @playwright/test@1.62.1", {
    cwd: join(SANDBOX, "e2e"),
    stdio: "pipe",
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    timeout: 240000,
  });

  // ── 3. mock 前后端 ──
  step("启动 mock 前端（steel-list-panel）+ mock API（jh4j 信封）…");
  const PAGE_HTML = readFileSync(join(PKG_ROOT, "scripts/mock-page.html"), "utf-8");
  mock = createServer((req, res) => {
    if (req.url.startsWith("/pl/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 2000, message: "ok", data: { records: [{ id: "SIM1" }], total: 1 } }));
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  console.log(`  mock: ${mockUrl}`);

  // ── 4. 进程内驱动：真实生成资产 + 五硬门 ──
  step(`驱动浏览器逐页执行 ROUND1（channel=${CHANNEL ?? "bundled chromium"}）…`);
  const pwPkg = JSON.parse(readFileSync(join(SANDBOX, "e2e/node_modules/@playwright/test/package.json"), "utf-8"));
  const pwMod = await import(pathToFileURL(join(SANDBOX, "e2e/node_modules/@playwright/test/index.js")).href);
  const chromium = pwMod.chromium ?? pwMod.default?.chromium;

  // 复用生成的资产（与 playwright test 运行时同一份代码）
  process.env.E2E_API_PREFIX = "/pl";
  const { monitorPage } = await import(pathToFileURL(join(SANDBOX, "e2e/support/network-monitor.js")).href);
  const selectorsMod = await import(pathToFileURL(join(SANDBOX, "e2e/support/selectors.js")).href);
  const sel = selectorsMod.sel;
  const envMod = await import(pathToFileURL(join(SANDBOX, "e2e/support/environment.js")).href);
  const pagesMod = await import(pathToFileURL(join(SANDBOX, "e2e/fixtures/pages.js")).href);
  console.log(`  生成资产加载: monitorPage/sel(${Object.keys(sel).length} 选择器)/PAGES(${pagesMod.PAGES.length})`);

  const browser = await chromium.launch({ channel: CHANNEL, timeout: 60000 });
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const pageEntry of pagesMod.PAGES) {
    const context = await browser.newContext({ baseURL: mockUrl });
    const page = await context.newPage();
    const monitor = monitorPage(page, { readonly: true, isBusinessApi: envMod.isBusinessApi });
    try {
      await page.goto(pageEntry.route, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector(sel.gridWait, { timeout: 15000 });
      const rowCount = await page.locator(sel.row).count();
      const hasEmpty = (await page.locator(sel.empty).count()) > 0;
      if (rowCount === 0 && !hasEmpty) throw new Error("未渲染网格或空态");
      if (pageEntry.writable) {
        const btn = page.getByRole("button", { name: /新增|修改|编辑|删除|保存|提交|下达|确认|完成|退回/ }).first();
        await btn.waitFor({ state: "visible", timeout: 8000 });
      }
      await monitor.assertClean(pageEntry.pageId + " sim");
      passed++;
    } catch (e) {
      failed++;
      failures.push(`${pageEntry.pageId}: ${String(e.message).split("\n")[0].slice(0, 120)}`);
    } finally {
      await context.close();
    }
  }
  await browser.close();

  console.log(`\n  ROUND1 模拟: ${passed} passed / ${failed} failed（共 ${pagesMod.PAGES.length} 页，五硬门全开）`);
  if (failures.length > 0) {
    for (const f of failures.slice(0, 6)) console.log("    ✗", f);
    throw new Error(`存在失败页面: ${failed}`);
  }
  if (passed < 30) throw new Error(`通过页面数异常: ${passed}`);

  step(`✅ 模拟跑通过：真实 page-spec(${gen.pages.length} 页) × steel 适配 × 生成资产(monitor/selectors/pages) × mock 前后端，五硬门全绿零污染`);
} finally {
  mock?.close();
  rmSync(SANDBOX, { recursive: true, force: true });
  step("沙箱已清理（wl-ui-produce 全程零写入）");
}
