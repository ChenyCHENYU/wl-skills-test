/**
 * 执行器测试（Playwright/JMeter 的工具检测和结果解析）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

test("executors: runPlaywright 工具未安装时优雅降级", async () => {
  const { runPlaywright } = await import("../lib/executors.js");
  const result = await runPlaywright({ testDir: "./nonexistent" });
  assert.ok(result.error || result.tool === "playwright");
});

test("executors: runJmeter 工具未安装时优雅降级", async () => {
  const { runJmeter } = await import("../lib/executors.js");
  const result = await runJmeter({ jmxPath: "./nonexistent.jmx" });
  assert.ok(result.error || result.tool === "jmeter");
});

test("audit: T13-T18 JMeter 全规则检测", async () => {
  const { audit } = await import("../lib/test-audit.js");
  const TMP = join(process.cwd(), ".tmp-jmeter-full");
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(
    join(TMP, "bare.jmx"),
    `<jmeterTestPlan><hashTree><ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup"><intProp name="ThreadGroup.num_threads">100</intProp></ThreadGroup></hashTree></jmeterTestPlan>`,
  );

  try {
    const result = audit(join(TMP, "bare.jmx"));
    assert.ok(result.findings.some((f) => f.rule === "T6"), "应检测缺少聚合报告");
    assert.ok(result.findings.some((f) => f.rule === "T9"), "应检测缺少断言");
    assert.ok(result.findings.some((f) => f.rule === "T13"), "应检测缺少 CSV");
    assert.ok(result.findings.some((f) => f.rule === "T14"), "应检测缺少 LoopController");
    assert.ok(result.findings.some((f) => f.rule === "T15"), "应检测缺少 Header");
    assert.ok(result.findings.some((f) => f.rule === "T18"), "应检测缺少 ramp_time");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("audit: T19-T20 用例覆盖率检测", async () => {
  const { audit } = await import("../lib/test-audit.js");
  const TMP = join(process.cwd(), ".tmp-cases-coverage");
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(
    join(TMP, "cases.md"),
    `# 测试用例\n\n| 序号 | 名称 | 优先级 | 预期 |\n|------|------|--------|------|\n| TC-001 | 正常新增 | P0 | 成功 |\n| TC-002 | 正常编辑 | P0 | 成功 |\n| TC-003 | 正常删除 | P0 | 成功 |\n`,
  );

  try {
    const result = audit(join(TMP, "cases.md"));
    assert.ok(result.findings.some((f) => f.rule === "T19"), "应检测用例数量不足");
    assert.ok(result.findings.some((f) => f.rule === "T20"), "应检测缺少异常场景");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("autoFix: F4 硬编码 URL 替换", async () => {
  const { autoFix } = await import("../lib/test-audit.js");
  const TMP = join(process.cwd(), ".tmp-fix-url");
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(
    join(TMP, "hardcoded.spec.js"),
    `test("goto", async ({ page }) => {\n  await page.goto("https://prod.example.com/admin");\n  await expect(page.locator("h1")).toBeVisible();\n});\n`,
  );

  try {
    const result = autoFix(join(TMP, "hardcoded.spec.js"));
    assert.ok(result.changed);
    assert.ok(result.content.includes("BASE_URL"), "应引入 BASE_URL");
    assert.ok(!result.content.includes("https://prod.example.com"), "应替换硬编码 URL");
    assert.ok(result.fixes.some((f) => f.rule === "F4"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("autoFix: F6 测试名规范化", async () => {
  const { autoFix } = await import("../lib/test-audit.js");
  const TMP = join(process.cwd(), ".tmp-fix-name");
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  writeFileSync(
    join(TMP, "badname.spec.js"),
    `import { test, expect } from "@playwright/test";\ntest.beforeEach(async ({ page }) => {});\ntest("随便点一下", async ({ page }) => {\n  await expect(page.locator("body")).toBeVisible();\n});\n`,
  );

  try {
    const result = autoFix(join(TMP, "badname.spec.js"));
    assert.ok(result.changed);
    assert.ok(result.content.includes("should 随便"), "应加 should 前缀");
    assert.ok(result.fixes.some((f) => f.rule === "F6"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
