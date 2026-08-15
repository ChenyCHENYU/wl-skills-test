/**
 * test-data-factory 测试 — 类型/枚举/约束/字段名语义驱动的合法测试值
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDummyValue, buildCreatePayload } from "../lib/test-data-factory.js";

test("data-factory: 枚举字段取第一个枚举值", () => {
  assert.equal(buildDummyValue({ name: "status", type: "String", enumValues: ["ENABLE", "DISABLE"] }), "ENABLE");
});

test("data-factory: 对象枚举取 value/code", () => {
  assert.equal(buildDummyValue({ name: "level", enumValues: [{ value: "A", label: "高" }] }), "A");
  assert.equal(buildDummyValue({ name: "level", enumValues: [{ code: "B" }] }), "B");
});

test("data-factory: 数值类型", () => {
  assert.equal(buildDummyValue({ name: "amount", javaType: "BigDecimal" }), 1.5);
  assert.equal(buildDummyValue({ name: "count", javaType: "Integer" }), 1);
  assert.equal(buildDummyValue({ name: "count", type: "long" }), 1);
});

test("data-factory: 布尔类型", () => {
  assert.equal(buildDummyValue({ name: "enabled", javaType: "Boolean" }), true);
});

test("data-factory: 日期/时间类型", () => {
  assert.equal(buildDummyValue({ name: "createTime", javaType: "LocalDateTime" }), "2026-01-01 12:00:00");
  assert.equal(buildDummyValue({ name: "birth", javaType: "LocalDate" }), "2026-01-01");
});

test("data-factory: 字段名语义（email/phone）", () => {
  assert.equal(buildDummyValue({ name: "contact_email", type: "String" }), "at_test@example.com");
  assert.equal(buildDummyValue({ name: "mobilePhone", type: "String" }), "13800138000");
});

test("data-factory: maxLength 约束截断", () => {
  const v = buildDummyValue({ name: "remarkzz", type: "String", constraints: { maxLength: 4 } });
  assert.ok(String(v).length <= 4, `应截断到 4 位: ${v}`);
});

test("data-factory: 数值约束夹取", () => {
  assert.equal(buildDummyValue({ name: "ratio", javaType: "BigDecimal", constraints: { min: 10, max: 20 } }), 10);
});

test("data-factory: 编号字段生成唯一可识别值（含 runId）", () => {
  const v = buildDummyValue({ name: "order_no", type: "String" }, { runId: "TS20260815" });
  assert.ok(String(v).includes("TS20260815"), "编号值应含 runId 便于零污染识别");
});

test("data-factory: buildCreatePayload 只含必填字段", () => {
  const payload = buildCreatePayload(
    [
      { name: "orderNo", javaType: "String", requiredOnCreate: true },
      { name: "remark", javaType: "String", requiredOnCreate: false },
    ],
    { runId: "TSX" },
  );
  assert.ok("orderNo" in payload);
  assert.ok(!("remark" in payload));
});
