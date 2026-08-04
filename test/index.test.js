import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanHash, verifyPlanHash } from "../lib/plan-hash.js";
import { calculateDI, generateSmokeSuite, exportCasesMarkdown } from "../lib/test-codegen.js";
import { createWritePlan } from "../lib/write-guard.js";

test("plan-hash: 相同计划产生相同哈希", () => {
  const plan = [{ target: "a.md", content: "hello" }];
  const h1 = computePlanHash(plan);
  const h2 = computePlanHash(plan);
  assert.equal(h1, h2);
  assert.ok(verifyPlanHash(plan, h1));
});

test("plan-hash: 不同计划产生不同哈希", () => {
  const p1 = [{ target: "a.md", content: "hello" }];
  const p2 = [{ target: "a.md", content: "world" }];
  assert.notEqual(computePlanHash(p1), computePlanHash(p2));
});

test("write-guard: 生产环境默认阻断", () => {
  const plan = createWritePlan([{ target: "a.md", content: "test" }], { env: "prod" });
  assert.equal(plan.blocked, true);
});

test("write-guard: 生产环境显式放行", () => {
  const plan = createWritePlan([{ target: "a.md", content: "test" }], {
    env: "prod",
    allowProductionWrites: true,
  });
  assert.equal(plan.blocked, false);
});

test("write-guard: 非生产环境不阻断", () => {
  const plan = createWritePlan([{ target: "a.md", content: "test" }], { env: "dev" });
  assert.equal(plan.blocked, false);
});

test("DI: 无缺陷时 DI=0 且允许上线", () => {
  const result = calculateDI([], 100);
  assert.equal(result.di, 0);
  assert.equal(result.level, "green");
  assert.equal(result.releaseDecision, "pass");
});

test("DI: 致命缺陷未关闭时阻断上线", () => {
  const result = calculateDI(
    [{ severity: "fatal", status: "open" }],
    100,
  );
  assert.equal(result.releaseDecision, "blocked");
});

test("DI: 严重缺陷计算正确", () => {
  const result = calculateDI(
    [
      { severity: "fatal", status: "closed" },
      { severity: "critical", status: "closed" },
      { severity: "general", status: "closed" },
      { severity: "minor", status: "closed" },
    ],
    100,
  );
  assert.equal(result.di, 14.1);
  assert.equal(result.diDensity, 0.141);
  assert.equal(result.level, "yellow");
});

test("smoke: 冒烟套件不超过限制", () => {
  const cases = [];
  for (let i = 0; i < 50; i++) {
    cases.push({
      id: `TC-${i}`,
      name: `test ${i} 正常路径`,
      priority: i < 10 ? "P0" : "P1",
      type: "api",
    });
  }
  const suite = generateSmokeSuite(cases, { complexity: "simple" });
  assert.ok(suite.smokeCount <= 8);
});

test("exportCasesMarkdown: 输出包含表头", () => {
  const md = exportCasesMarkdown(
    [{ id: "TC-001", name: "test", module: "m", type: "api", priority: "P0", method: "GET", path: "/api", description: "desc" }],
    "测试",
  );
  assert.ok(md.includes("| 序号 |"));
  assert.ok(md.includes("TC-001"));
});
