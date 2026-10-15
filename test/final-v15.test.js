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
test("v15: README 提供系列标识、动态版本与真实接入和核验入口", () => {
  const readme = readFileSync(join(PKG_ROOT, "README.md"), "utf-8");
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf-8"));

  assert.ok(readme.includes("<picture>"));
  assert.ok(readme.includes("prefers-color-scheme: dark"));
  for (const logo of ["wl-test-logo.svg", "wl-test-logo-dark.svg"]) {
    assert.ok(readme.includes(`/wl-skills-test/main/assets/${logo}`), `缺少系列 Logo：${logo}`);
  }
  assert.ok(readme.includes(`https://img.shields.io/npm/v/${pkg.name}`), "版本徽章应动态读取 npm");
  assert.ok(readme.includes(`https://www.npmjs.com/package/${pkg.name}`));
  assert.ok(!/tests-\d+%20pass|version-\d+\.\d+\.\d+-blue/.test(readme), "主 README 不固化测试数量或版本记录");
  for (const command of ["init", "validate --json", "audit --target", "status --run-id", "report --run-id"]) {
    assert.ok(readme.includes(`wl-skills-test ${command}`), `缺少真实操作入口：${command}`);
  }
  for (const doc of ["docs/quality-evidence.md", "docs/sit-delivery.md", "docs/project-scope.md", "docs/maintenance-contract.md"]) {
    assert.ok(readme.includes(`](${doc})`), `缺少深度手册入口：${doc}`);
    assert.ok(existsSync(join(PKG_ROOT, doc)), `手册路径不存在：${doc}`);
  }
  assert.equal(getToolCount(), TOOL_DESCRIPTORS.length);
  assert.equal(TOOL_DESCRIPTORS.length, Object.keys(HANDLERS).length);
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
