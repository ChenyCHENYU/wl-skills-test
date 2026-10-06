/**
 * types.js — 契约字段类型分类器（单一事实源）
 *
 * 此前数字/布尔/日期类型判断在 4 处独立实现且口径不一：
 *   case-fine-gen.js / test-data-factory.js / api-executor.js（JS_TYPE 表 + 负例字段筛选）
 * 生成与执行必须对"什么算数值/布尔/日期"达成一致，否则生成的用例与执行的负例口径漂移。
 */

const NUMERIC_TYPES = new Set([
  "number", "integer", "int", "long", "float", "double", "bigdecimal", "decimal", "short", "byte",
]);
const BOOL_TYPES = new Set(["boolean", "bool"]);
const DATE_TYPES = new Set(["date", "localdate", "localdatetime", "localtime", "timestamp", "time", "zoneddatetime", "instant", "year", "month"]);

/** 契约字段原始类型名（type / javaType 归一小写） */
export function rawTypeName(field) {
  return String(field?.type || field?.javaType || "").toLowerCase().replace(/^java\.lang\./, "").replace(/^java\.math\./, "").replace(/^java\.time\./, "").replace(/^java\.util\./, "");
}

/**
 * 字段分类 → "number" | "boolean" | "date" | "string" | "unknown"
 * 枚举字段（有 enum/enumValues/dictCode）优先归类为枚举字符串，由调用方自行判断。
 */
export function typeCategory(field) {
  const t = rawTypeName(field);
  if (!t) return "unknown";
  if (["date", "date-time", "time"].includes(String(field?.format || "").toLowerCase())) return "date";
  if (NUMERIC_TYPES.has(t)) return "number";
  if (BOOL_TYPES.has(t)) return "boolean";
  if (DATE_TYPES.has(t)) return "date";
  if (["string", "char", "text", "varchar"].some((p) => t.startsWith(p))) return "string";
  return "unknown";
}

export function isNumericField(field) {
  return typeCategory(field) === "number";
}

/** 整数子集（数据工厂用来区分 1 与 1.5 的合法值） */
export function isIntegerField(field) {
  const t = rawTypeName(field);
  return ["integer", "int", "long", "short", "byte"].includes(t);
}

export function isBooleanField(field) {
  return typeCategory(field) === "boolean";
}

export function isDateField(field) {
  return typeCategory(field) === "date";
}

/** 字段是否有枚举约束（dict/enum 任一形态） */
export function isEnumField(field) {
  return Boolean(field?.enum || field?.enumValues || field?.dictCode || (Array.isArray(field?.dict) && field.dict.length > 0));
}

/** 契约声明类型 → JS 类型（漂移检测/结构断言用），未知类型返回 null 不参与判定 */
export function declaredJsType(field) {
  const cat = typeCategory(field);
  if (cat === "number" || cat === "boolean") return cat;
  if (cat === "string") return "string";
  return null;
}
