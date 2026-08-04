/**
 * 测试审计引擎 + API 执行器测试
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, autoFix, RULES } from "../lib/test-audit.js";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TMP = join(process.cwd(), ".tmp-audit-test");

function setupTestFiles() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  // 有问题的 Playwright 脚本
  writeFileSync(
    join(TMP, "bad.spec.js"),
    `import { test } from "@playwright/test";
test("随便测一下", async ({ page }) => {
  await page.goto("https://prod.example.com/admin");
  await page.click("button");
  await page.waitForTimeout(3000);
});`,
  );

  // 有问题的 JMeter 脚本
  writeFileSync(
    join(TMP, "bad.jmx"),
    `<jmeterTestPlan>
<ConfigTestElement guiclass="TestPlanGui"/>
<SteppingThreadGroup threads="100" rampUp="10"/>
</jmeterTestPlan>`,
  );

  // 干净的 Playwright 脚本
  writeFileSync(
    join(TMP, "good.spec.js"),
    `import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => { await page.goto("/login"); });
test.afterEach(async ({ page }) => { await page.context().clearCookies(); });
test("should display list", async ({ page }) => {
  await page.goto("/list");
  await expect(page.locator("table")).toBeVisible();
});`,
  );
}

test("audit: T1-T12 规则定义完整", () => {
  assert.ok(RULES.length >= 12);
  assert.ok(RULES.some((r) => r.id === "T1"));
  assert.ok(RULES.some((r) => r.id === "T12"));
});

test("audit: 检测到 Playwright 反模式", () => {
  setupTestFiles();
  try {
    const result = audit(join(TMP, "bad.spec.js"));
    assert.ok(result.findings.length > 0);
    assert.ok(result.findings.some((f) => f.rule === "T1"), "应检测缺少 beforeEach");
    assert.ok(result.findings.some((f) => f.rule === "T2"), "应检测硬编码 URL");
    assert.ok(result.findings.some((f) => f.rule === "T3"), "应检测缺少断言");
    assert.ok(result.findings.some((f) => f.rule === "T4"), "应检测测试名不规范");
    assert.ok(result.findings.some((f) => f.rule === "T5"), "应检测缺少 afterEach");
    assert.ok(result.findings.some((f) => f.rule === "T12"), "应检测 waitForTimeout");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("audit: 干净脚本零问题", () => {
  setupTestFiles();
  try {
    const result = audit(join(TMP, "good.spec.js"));
    assert.equal(result.findings.length, 0);
    assert.equal(result.pass, true);
    assert.equal(result.level, "green");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("audit: 检测到 JMeter 致命坑", () => {
  setupTestFiles();
  try {
    const result = audit(join(TMP, "bad.jmx"));
    assert.ok(result.findings.some((f) => f.rule === "T7"), "应检测 ConfigTestElement 致命组合");
    assert.equal(result.bySeverity.fatal > 0, true);
    assert.equal(result.pass, false);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("audit: 目录递归扫描", () => {
  setupTestFiles();
  try {
    const result = audit(TMP);
    assert.ok(result.total >= 7, "应扫描到多个问题");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("autoFix: 补齐 beforeEach", () => {
  setupTestFiles();
  try {
    const result = autoFix(join(TMP, "bad.spec.js"));
    assert.equal(result.changed, true);
    assert.ok(result.content.includes("beforeEach"));
    assert.ok(result.fixes.some((f) => f.rule === "F2"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("autoFix: 干净文件不修改", () => {
  setupTestFiles();
  try {
    const result = autoFix(join(TMP, "good.spec.js"));
    assert.equal(result.changed, false);
    assert.equal(result.fixes.length, 0);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
