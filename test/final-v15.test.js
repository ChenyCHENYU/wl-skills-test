/**
 * v0.15.0 收口回归 — write-guard 字节回滚 / 文档口径单一事实源
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computePlanHash, verifyPlanHash } from "../lib/plan-hash.js";
import { createWritePlan, confirmAndWrite } from "../lib/write-guard.js";
import { getToolCount, TOOL_DESCRIPTORS } from "../mcp/registry.js";
import { HANDLERS } from "../mcp/tools/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const TMP = join(process.cwd(), ".tmp-final-v15");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

// ── plan-hash 归一化 ──
test("v15: plan-hash 键序/路径/文件顺序归一", () => {
  const h1 = computePlanHash([{ target: "D:\\a\\b.md", content: "x" }, { target: "c/d.md", content: "y" }]);
  const h2 = computePlanHash([{ target: "c/d.md", content: "y", extra: 1 }, { target: "D:/a/b.md", content: "x" }]);
  // 注意：extra 键不同是不同计划——只验证键序与路径归一
  const h3 = computePlanHash([{ target: "c/d.md", content: "y" }, { target: "D:/a/b.md", content: "x" }]);
  assert.equal(h1, h3, "路径斜杠与文件顺序差异应产生相同哈希");
  assert.notEqual(h1, h2);
  assert.ok(verifyPlanHash([{ target: "D:\\a\\b.md", content: "x" }, { target: "c/d.md", content: "y" }], h3), "verify 用原始形式也应通过");
});

// ── write-guard 字节级回滚 ──
test("v15: 写入失败按字节回滚（BOM/CRLF 保真），回滚失败如实上报", () => {
  setupTmp();
  const good = join(TMP, "good.md");
  const bad = join(TMP, "sub", "bad.md");
  // good.md 含 BOM + CRLF（文本往返会失真的内容）
  const originalBuffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("line1\r\nline2\r\n", "utf-8")]);
  writeFileSync(good, originalBuffer);
  // 用同名文件占住 "sub"：bad.md 的 dirname mkdirSync 会失败 → 触发部分失败 + 回滚
  writeFileSync(join(TMP, "sub"), "");
  try {
    const files = [
      { target: good, content: "新的内容" },
      { target: bad, content: "不应写入" },
    ];
    const hash = computePlanHash(files);
    const result = confirmAndWrite(files, hash);
    assert.equal(result.success, false, "存在失败写入时应失败");
    assert.ok(result.errors.length > 0, "应上报写入错误");
    // good.md 已按字节恢复（BOM + CRLF 完整）
    assert.deepEqual(readFileSync(good), originalBuffer, "回滚必须是字节级保真");
    assert.ok(Array.isArray(result.rollbackErrors), "rollbackErrors 字段应存在");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v15: 计划含重复目标直接拒绝", () => {
  const files = [
    { target: join(TMP, "dup.md"), content: "a" },
    { target: join(TMP, "dup.md"), content: "b" },
  ];
  const result = confirmAndWrite(files, computePlanHash(files));
  assert.equal(result.success, false);
  assert.ok(result.reason.includes("重复目标"));
});

// ── 文档口径单一事实源 ──
test("v15: README 徽章/口径与代码一致（工具数/测试数/版本）", async () => {
  const readme = readFileSync(join(PKG_ROOT, "README.md"), "utf-8");
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

  // MCP 工具数从注册表派生
  const toolCount = getToolCount();
  assert.ok(readme.includes(`MCP-${toolCount}-teal`), `README MCP 徽章应为 ${toolCount}`);
  assert.ok(!/1[45] 个 MCP 工具/.test(readme), "正文不得残留过时工具数（14/15）");
  // parity（与 stdio 启动同一防线）
  assert.equal(TOOL_DESCRIPTORS.length, Object.keys(HANDLERS).length);
  // 版本徽章 = package.json
  assert.ok(readme.includes(`version-${pkg.version}-blue`), `README 版本徽章应为 ${pkg.version}`);
  // 测试徽章与实际测试数一致（统计 test/ 下 test( 出现次数近似；至少不得低于徽章）
  const testDir = join(PKG_ROOT, "test");
  const { readdirSync } = await import("node:fs");
  let testCount = 0;
  for (const f of readdirSync(testDir)) {
    if (!f.endsWith(".test.js")) continue;
    testCount += (readFileSync(join(testDir, f), "utf-8").match(/^\s*test\(/gm) || []).length;
  }
  // The router registers one real test per released skill on the same for() line.
  const routingTest = readFileSync(join(testDir, "task-observability.test.js"), "utf-8");
  if (routingTest.includes("for (const skill of readRoutes().skills) test(")) {
    testCount += JSON.parse(readFileSync(join(PKG_ROOT, "files/.wl-skills-test/routes.v1.json"), "utf-8")).skills.length;
  }
  const badgeMatch = readme.match(/tests-(\d+)%20pass/);
  assert.ok(badgeMatch, "README 应有 tests 徽章");
  // 徽章不得高于实际 test() 定义数（防虚标）；精确总数以 node --test 运行结果为准
  assert.ok(parseInt(badgeMatch[1], 10) <= testCount, `README 测试徽章 ${badgeMatch[1]} 不得高于实际 test() 数 ${testCount}`);
  // 结构章节反映 v0.12 拆分
  assert.ok(readme.includes("cli/"), "包结构应包含 lib/cli/");
  assert.ok(readme.includes("shared/"), "包结构应包含 lib/shared/");
});

test("v15: quality-gate.js DI 检查与 calculateDI 同口径（模块收敛在位）", async () => {
  const { calculateDI } = await import("../lib/test-codegen.js");
  // 单模块集中缺陷（DI 大于豁免线且占比 100%）→ 收敛失败
  const di = calculateDI(
    [
      { severity: "fatal", status: "closed", module: "a" },
      { severity: "critical", status: "closed", module: "a" },
    ],
    200,
  );
  assert.equal(di.releaseChecks.moduleConvergence.pass, false, "单模块 DI=13 > 豁免线 3 且占比 100% 应判不收敛");
  assert.equal(di.releaseDecision, "blocked");
});
