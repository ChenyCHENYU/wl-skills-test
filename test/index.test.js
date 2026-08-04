import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanHash, verifyPlanHash } from "../lib/plan-hash.js";
import { calculateDI, generateSmokeSuite, exportCasesMarkdown, generateFromContract } from "../lib/test-codegen.js";
import { createWritePlan, confirmAndWrite } from "../lib/write-guard.js";
import { consumeContract, generateTestCaseMatrix } from "../lib/contract-consumer.js";
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

// ── 第二阶段修复回归测试 ──────────────────────

test("write-guard: confirmAndWrite 实际写入文件", () => {
  const tmpDir = join(process.cwd(), ".tmp-test-write-guard");
  const tmpFile = join(tmpDir, "test.md");
  try {
    const files = [{ target: tmpFile, content: "hello test" }];
    const hash = computePlanHash(files);
    const result = confirmAndWrite(files, hash);
    assert.equal(result.success, true);
    assert.equal(result.written, 1);
    assert.ok(existsSync(tmpFile));
    assert.equal(readFileSync(tmpFile, "utf-8"), "hello test");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("write-guard: confirmAndWrite 哈希不匹配时拒绝", () => {
  const files = [{ target: ".tmp-fake.md", content: "x" }];
  const result = confirmAndWrite(files, "wrong-hash");
  assert.equal(result.success, false);
  assert.ok(result.reason.includes("哈希不匹配"));
});

test("write-guard: confirmAndWrite 生产环境阻断", () => {
  const files = [{ target: ".tmp-prod.md", content: "x" }];
  const hash = computePlanHash(files);
  const result = confirmAndWrite(files, hash, { env: "prod" });
  assert.equal(result.success, false);
  assert.ok(result.reason.includes("生产环境"));
});

test("contract-consumer: 消费 wl-api-contract 格式", () => {
  const sample = {
    kind: "wl-api-contract",
    schemaVersion: 1,
    protocolVersion: "1.0",
    resource: { contractId: "test-001", module: "order", entity: "Order", permissionPrefix: "order" },
    operations: {
      page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
      detail: { method: "GET", externalPath: "/order/getById/1", permission: "order_get_by_id" },
    },
    models: {
      createRequest: [{ name: "orderName", description: "订单名", required: true, type: "string" }],
    },
    transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
  };
  const tmpFile = join(process.cwd(), ".tmp-contract.json");
  writeFileSync(tmpFile, JSON.stringify(sample));
  try {
    const result = consumeContract(tmpFile);
    assert.equal(result.type, "wl-api-contract");
    assert.equal(result.summary.entity, "Order");
    assert.equal(result.summary.operations.length, 2);
    const cases = generateTestCaseMatrix(result.summary);
    assert.ok(cases.length > 0);
    assert.ok(cases.some((c) => c.type === "permission"));
    assert.ok(cases.some((c) => c.name.includes("orderName 必填校验")));
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("test-codegen: generateFromContract 不再崩溃", () => {
  const sample = {
    kind: "wl-api-contract",
    schemaVersion: 1,
    protocolVersion: "1.0",
    resource: { contractId: "test-002", module: "user", entity: "User", permissionPrefix: "sys_user" },
    operations: { page: { method: "POST", externalPath: "/user/queryPage", permission: "sys_user_query_page" } },
    models: { createRequest: [{ name: "username", description: "用户名", required: true, type: "string" }] },
    transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
  };
  const tmpFile = join(process.cwd(), ".tmp-contract2.json");
  writeFileSync(tmpFile, JSON.stringify(sample));
  try {
    const result = generateFromContract(tmpFile);
    assert.ok(result.caseCount > 0);
    assert.equal(result.summary.entity, "User");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("contract-consumer: bd 契约生成 CRUD 用例矩阵", () => {
  const bdContract = {
    schemaVersion: 1,
    contractId: "sale-order",
    profile: "jh4j3-openapi3",
    rootPackage: "com.jhict.sale",
    module: "saleOrder",
    entity: { name: "SaleOrder", table: "SALE_ORDER", description: "销售订单" },
    api: {
      requestPath: "saleOrder",
      externalBasePath: "/sale/saleOrder",
      permissionPrefix: "sale_order",
      permissions: {
        page: "sale_order_query_page",
        create: "sale_order_save",
        update: "sale_order_update_by_id",
        remove: "sale_order_delete_by_id",
        detail: "sale_order_get_by_id",
      },
    },
    database: "oracle",
    migration: { version: "20260805_000000", rollbackStrategy: "DROP TABLE SALE_ORDER", verificationSql: ["SELECT COUNT(*) FROM SALE_ORDER"] },
    fields: [
      { name: "orderNo", column: "ORDER_NO", javaType: "String", dbType: "VARCHAR2(50)", comment: "订单号", writable: true, requiredOnCreate: true },
      { name: "amount", column: "AMOUNT", javaType: "BigDecimal", dbType: "NUMBER(18,2)", comment: "金额", writable: true, requiredOnCreate: false },
    ],
  };
  const tmpFile = join(process.cwd(), ".tmp-bd-contract.json");
  writeFileSync(tmpFile, JSON.stringify(bdContract));
  try {
    const result = consumeContract(tmpFile);
    assert.equal(result.type, "bd-contract");
    assert.ok(result.summary.operations.length >= 5, "bd 应至少有 5 个标准操作");
    const cases = generateTestCaseMatrix(result.summary);
    assert.ok(cases.length >= 8, "bd 契约应生成足够的用例");
    assert.ok(cases.some((c) => c.name.includes("queryPage") || c.name.includes("page")), "应包含查询用例");
    assert.ok(cases.some((c) => c.name.includes("save") || c.name.includes("create")), "应包含新增用例");
    assert.ok(cases.some((c) => c.name.includes("orderNo 必填校验")), "应包含必填校验");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("contract-consumer: page-spec 推断 CRUD 操作", () => {
  const pageSpec = {
    page: "订单列表",
    mode: "LIST",
    dir: "/views/order/list",
    query: [{ name: "orderNo", label: "订单号", type: "input" }],
    toolbar: [{ label: "新增", color: "primary", action: "openModal" }],
    operations: [{ label: "编辑", action: "edit" }, { label: "删除", action: "delete" }],
  };
  const tmpFile = join(process.cwd(), ".tmp-page-spec2.json");
  writeFileSync(tmpFile, JSON.stringify(pageSpec));
  try {
    const result = consumeContract(tmpFile);
    assert.equal(result.type, "page-spec");
    assert.ok(result.summary.operations.length >= 3, "page-spec 应推断出至少 3 个 CRUD 操作");
    assert.ok(result.summary.operations.some((o) => o.key === "page"), "应推断查询操作");
    assert.ok(result.summary.operations.some((o) => o.key === "create"), "应推断新增操作");
    assert.ok(result.summary.operations.some((o) => o.key === "remove"), "应推断删除操作");
    const cases = generateTestCaseMatrix(result.summary);
    assert.ok(cases.length > 0, "page-spec 也应能生成用例");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});
