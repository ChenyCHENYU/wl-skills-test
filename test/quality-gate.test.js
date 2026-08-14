/**
 * quality-gate CI 脚本测试 — 含"从包外目录调用"（路径解析回归）与多种参数风格
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const SCRIPT = join(PKG_ROOT, "scripts", "quality-gate.js");
const TMP = join(PKG_ROOT, ".tmp-qg-test");

function runGate(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
    cwd: cwd || PKG_ROOT,
    timeout: 30000,
  });
}

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

const PASS_DEFECTS = [
  { severity: "general", status: "closed", module: "order" },
  { severity: "minor", status: "closed", module: "order" },
];

const FAIL_DEFECTS = [
  { severity: "fatal", status: "open", module: "order" },
  { severity: "critical", status: "open", module: "user" },
];

test("quality-gate: = 风格参数，通过场景退出码 0", () => {
  setupTmp();
  const defects = join(TMP, "pass.json");
  writeFileSync(defects, JSON.stringify(PASS_DEFECTS));
  try {
    const r = runGate(["--defects=" + defects, "--cases=200"]);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("质量门通过"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: 空格风格参数，失败场景退出码 1", () => {
  setupTmp();
  const defects = join(TMP, "fail.json");
  writeFileSync(defects, JSON.stringify(FAIL_DEFECTS));
  try {
    const r = runGate(["--defects", defects, "--cases", "50"]);
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes("质量门未通过"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: 缺陷文件不存在 → 输入错误退出码 1（fail-closed）", () => {
  const r = runGate(["--defects", "./no-such-defects.json"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("不存在") || r.stdout.includes("不存在"));
});

test("quality-gate: 缺陷 JSON 非数组 → 输入错误退出码 1", () => {
  setupTmp();
  const defects = join(TMP, "not-array.json");
  writeFileSync(defects, JSON.stringify({ severity: "fatal" }));
  try {
    const r = runGate(["--defects=" + defects]);
    assert.equal(r.status, 1);
    assert.ok((r.stderr + r.stdout).includes("数组"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: --audit-dir 不存在 → 输入错误退出码 1（不静默跳过）", () => {
  const r = runGate(["--audit-dir", "./no-such-dir"]);
  assert.equal(r.status, 1);
  assert.ok((r.stderr + r.stdout).includes("不存在"));
});

test("quality-gate: 从包外目录调用 --audit-dir 正常工作（路径解析回归）", () => {
  setupTmp();
  // 在 TMP 中放一个干净的 spec（audit 应通过）
  const good = join(TMP, "good.spec.js");
  writeFileSync(
    good,
    `import { test, expect } from "@playwright/test";\ntest.beforeEach(async ({ page }) => {});\ntest.afterEach(async ({ page }) => {});\ntest("should display list", async ({ page }) => {\n  await expect(page.locator("table")).toBeVisible();\n});\n`,
  );
  try {
    // 关键回归：cwd 不是包根目录（旧实现以 cwd 解析 lib 模块路径会崩溃）
    const r = runGate(["--audit-dir", TMP], TMP);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("审计"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: --smoke-result 通过率不足 95% 退出码 1", () => {
  setupTmp();
  const smoke = join(TMP, "smoke.json");
  writeFileSync(smoke, JSON.stringify({ passRate: 80 }));
  try {
    const r = runGate(["--smoke-result=" + smoke]);
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes("冒烟通过率"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: --smoke-result 通过率达标退出码 0", () => {
  setupTmp();
  const smoke = join(TMP, "smoke.json");
  writeFileSync(smoke, JSON.stringify({ passRate: 100 }));
  try {
    const r = runGate(["--smoke-result", smoke]);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("quality-gate: 无参数提示用法退出码 1", () => {
  const r = runGate([]);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes("未提供任何检查参数"));
});
