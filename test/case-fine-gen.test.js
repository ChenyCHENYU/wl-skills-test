/**
 * case-fine-gen 测试 — 字段级细粒度用例生成规则
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { consumeContract } from "../lib/contract-consumer.js";
import { generateFineGrainedCases, exportFineCasesMarkdown } from "../lib/case-fine-gen.js";

const TMP = join(process.cwd(), ".tmp-finegen");

const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  protocolVersion: "1.0",
  resource: { contractId: "fine-001", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    detail: { method: "GET", externalPath: "/order/getById/{id}", permission: "order_get_by_id" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}", permission: "order_delete_by_id" },
  },
  models: {
    createRequest: [
      { name: "orderNo", description: "订单号", required: true, type: "string", constraints: { maxLength: 32 } },
      { name: "amount", description: "金额", required: true, type: "number", constraints: { min: 0, max: 100000 } },
      { name: "status", description: "状态", required: true, type: "string", enum: ["DRAFT", "SUBMITTED"] },
      { name: "remark", description: "备注", required: false, type: "string", constraints: { maxLength: 200 } },
    ],
    listResponse: [{ name: "id", type: "string" }],
  },
  transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
};

function getCases() {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, "c.json");
  writeFileSync(p, JSON.stringify(CONTRACT));
  const { summary } = consumeContract(p);
  return generateFineGrainedCases(summary);
}

test("fine-gen: 字段维度规则全覆盖（空值/超长/数值边界×2/类型/枚举/安全/空格）", () => {
  const cases = getCases();
  const dims = new Set(cases.map((c) => c.dimension));
  assert.ok(dims.has("field-required"), "必填置空");
  assert.ok(dims.has("field-length"), "超长");
  assert.ok(dims.has("field-numeric-boundary"), "数值边界");
  assert.ok(dims.has("field-type"), "非数值类型");
  assert.ok(dims.has("field-enum"), "非法枚举");
  assert.ok(dims.has("field-security"), "特殊字符安全");
  assert.ok(dims.has("field-format"), "前后空格");
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

test("fine-gen: 操作维度（重复提交/无权限/不存在主键/重复删除/分页边界）", () => {
  const cases = getCases();
  const dims = new Set(cases.map((c) => c.dimension));
  assert.ok(dims.has("op-duplicate"));
  assert.ok(dims.has("op-permission"));
  assert.ok(dims.has("op-notfound"));
  assert.ok(dims.has("op-idempotent"));
  assert.ok(dims.has("op-pagination"));
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

test("fine-gen: 数量充足（超规范下限 10 条）且优先级合规", () => {
  const cases = getCases();
  assert.ok(cases.length >= 15, `细粒度用例应 ≥15，实际 ${cases.length}`);
  for (const c of cases) {
    assert.ok(["P0", "P1", "P2", "P3"].includes(c.priority));
    assert.ok(c.steps && c.expected && c.preconditions, `${c.id} 应含前置/步骤/预期`);
    assert.ok(c.id.startsWith("FG-"));
  }
  const p0 = cases.filter((c) => c.priority === "P0").length;
  assert.ok(p0 >= 4, `P0 应 ≥4（必填/类型/枚举/重复/权限），实际 ${p0}`);
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

test("fine-gen: autoExec 映射与 run-api DAG 步骤一致", () => {
  const cases = getCases();
  const autoDims = new Set(cases.filter((c) => c.autoExec).map((c) => c.dimension));
  // run-api 已实现的负例/权限/重复/分页维度必须可自动执行
  for (const d of ["field-required", "field-type", "field-length", "op-duplicate", "op-permission", "op-pagination"]) {
    assert.ok(autoDims.has(d), `${d} 应标记 autoExec（run-api DAG 已支持）`);
  }
  // v0.22.0：数值边界/枚举/并发重复已可自动执行（契约约束/dict 驱动）；
  // op-update/op-query-combine 依赖 fixture 声明 update/查询字段，由 v17/v22 测试覆盖
  for (const d of ["field-numeric-boundary", "field-enum", "op-duplicate-concurrent"]) {
    assert.ok(autoDims.has(d), `${d} 应标记 autoExec（run-api DAG 已支持）`);
  }
  // 本 fixture 未声明查询字段，组合查询用例不生成（声明场景由 intrinsic-v22 覆盖）
  // 安全字符/空格格式仍需产品语义判断，诚实标注人工
  assert.ok(!autoDims.has("field-security"));
  assert.ok(!autoDims.has("field-format"));
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});

test("fine-gen: Markdown 导出含分布与映射说明", () => {
  const cases = getCases();
  const md = exportFineCasesMarkdown(cases, "Order");
  assert.ok(md.includes("细粒度用例"));
  assert.ok(md.includes("P0="));
  assert.ok(md.includes("dimension"));
  assert.ok(md.includes("run-api"));
  assert.ok(md.includes("| FG-"));
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
});
