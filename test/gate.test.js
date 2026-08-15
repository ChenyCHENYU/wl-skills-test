/**
 * gate 测试 — 聚合卡门（审计/E2E/冒烟/DI/性能）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runGate } from "../lib/gate.js";
import { generateE2eScaffold } from "../lib/e2e-generator.js";

const TMP = join(process.cwd(), ".tmp-gate");

const PAGE_SPEC = {
  page: "订单列表",
  mode: "LIST",
  dir: "/views/order",
  query: [{ name: "orderNo", label: "订单号" }],
  columns: [{ name: "orderNo", label: "订单号" }],
  toolbar: [{ label: "新增" }],
};

const GOOD_SPEC = `import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {});
test.afterEach(async ({ page }) => {});
test("should display list", async ({ page }) => {
  await expect(page.locator("table")).toBeVisible();
});
`;

test("gate: 全部通过场景（审计+E2E+冒烟+DI）", async () => {
  mkdirSync(TMP, { recursive: true });
  const auditDir = join(TMP, "audited");
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(join(auditDir, "good.spec.js"), GOOD_SPEC);

  const e2eDir = join(TMP, "e2e");
  const specFile = join(TMP, "spec.json");
  writeFileSync(specFile, JSON.stringify(PAGE_SPEC));
  generateE2eScaffold(specFile, { outputDir: e2eDir });

  const smoke = join(TMP, "smoke.json");
  writeFileSync(smoke, JSON.stringify({ summary: { passRate: 100 } }));
  const defects = join(TMP, "defects.json");
  writeFileSync(defects, JSON.stringify([{ severity: "minor", status: "closed", module: "a" }]));

  try {
    const r = await runGate({ auditDir, e2eDir, smokeResult: smoke, defects, cases: 100 });
    assert.equal(r.error, undefined);
    assert.equal(r.pass, true, JSON.stringify(r.checks));
    assert.ok(r.checks.length >= 5);
    assert.equal(r.summary.failed, 0);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("gate: 冒烟不达标阻断", async () => {
  mkdirSync(TMP, { recursive: true });
  const smoke = join(TMP, "smoke.json");
  writeFileSync(smoke, JSON.stringify({ summary: { passRate: 60 } }));
  try {
    const r = await runGate({ smokeResult: smoke });
    assert.equal(r.pass, false);
    assert.ok(r.checks.some((c) => !c.pass && c.name.includes("冒烟")));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("gate: 输入错误 fail-closed（路径不存在）", async () => {
  const r = await runGate({ auditDir: "./no-such-dir", smokeResult: "./no-such.json" });
  assert.equal(r.pass, false);
  assert.ok(r.inputErrors.length >= 2);
});

test("gate: 无检查项返回用法错误", async () => {
  const r = await runGate({});
  assert.ok(r.error.includes("未提供"));
});
