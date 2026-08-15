/**
 * test-data-factory.js — 测试数据工厂
 *
 * 按契约字段类型/约束/语义生成合法测试值，让 run-api 与 e2e 的写操作 payload 真实可过校验。
 * 规则优先级：enumValues > constraints > javaType/type > 字段名语义 > 兜底。
 */

const NAME_RULES = [
  { pattern: /mail/i, value: "at_test@example.com" },
  { pattern: /phone|mobile/i, value: "13800138000" },
  { pattern: /id_?card|idcard/i, value: "110101199003070000" },
  { pattern: /(^|_)(url|website|homepage)$/i, value: "http://example.com" },
  { pattern: /(^|_)(status|state|flag)$/i, value: "1" },
  { pattern: /(^|_)(sort|seq|order_index)$/i, value: 1 },
  { pattern: /remark|comment|description|note/i, value: "AT_自动化测试备注" },
  { pattern: /(^|_)version$/i, value: "v1" },
];

const NUMERIC_TYPES = /bigdecimal|decimal|double|float|number/i;
const INT_TYPES = /int|long|short|byte/i;
const BOOL_TYPES = /bool/i;
const DATE_TYPES = /date/i;

function truncate(value, maxLen) {
  if (!maxLen) return value;
  const limit = parseInt(maxLen, 10);
  if (!Number.isFinite(limit) || limit <= 0) return value;
  return String(value).slice(0, limit);
}

function applyConstraints(value, constraints) {
  if (!constraints) return value;
  let v = value;
  if (constraints.maxLength) v = truncate(v, constraints.maxLength);
  if (constraints.max_length) v = truncate(v, constraints.max_length);
  if (constraints.length) v = truncate(v, constraints.length);
  if (typeof v === "number") {
    if (constraints.minimum !== undefined && v < constraints.minimum) v = constraints.minimum;
    if (constraints.maximum !== undefined && v > constraints.maximum) v = constraints.maximum;
    if (constraints.min !== undefined && v < constraints.min) v = constraints.min;
    if (constraints.max !== undefined && v > constraints.max) v = constraints.max;
  }
  return v;
}

/**
 * 生成单个字段的合法测试值
 * @param {object} field — { name, javaType|type, enumValues, constraints, comment }
 * @param {object} [ctx] — { runId } 业务键前缀（用于可识别、可清理）
 */
export function buildDummyValue(field, ctx = {}) {
  const runId = ctx.runId || "AT";
  // 1. 枚举优先
  if (Array.isArray(field.enumValues) && field.enumValues.length > 0) {
    const v = field.enumValues[0];
    return typeof v === "object" && v !== null ? v.value ?? v.code ?? String(v) : v;
  }
  const type = String(field.javaType || field.type || "String");
  const name = String(field.name || "");
  const lower = name.toLowerCase();

  // 2. 字段名语义
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(lower)) {
      return applyConstraints(rule.value, field.constraints);
    }
  }

  // 3. 类型驱动
  if (NUMERIC_TYPES.test(type)) {
    return applyConstraints(1.5, field.constraints);
  }
  if (INT_TYPES.test(type)) {
    return applyConstraints(1, field.constraints);
  }
  if (BOOL_TYPES.test(type)) {
    return true;
  }
  if (/localdate$/i.test(type)) {
    return "2026-01-01";
  }
  if (/datetime|timestamp/i.test(type)) {
    return "2026-01-01 12:00:00";
  }
  if (/time$/i.test(type)) {
    return "12:00:00";
  }
  if (DATE_TYPES.test(type)) {
    return "2026-01-01";
  }

  // 4. 编号/编码类 → 唯一可识别值（含 runId，便于零污染识别与清理）
  if (/(^|_)(id|no|code|key)$/i.test(lower) && !/(^|_)org_?id$/i.test(lower)) {
    return applyConstraints(`${runId}_${Date.now() % 100000}`, field.constraints);
  }

  // 5. 兜底：中文测试数据（含 runId 前缀）
  return applyConstraints(`AT_${runId.slice(-6)}测试`, field.constraints);
}

/**
 * 按契约字段构造合法 create/update payload（必填字段必须有值，选填字段留空）
 * @param {Array} fields — 契约字段列表（bd fields 或 kit createRequest）
 * @param {object} [ctx] — { runId, includeOptional }
 */
export function buildCreatePayload(fields, ctx = {}) {
  const payload = {};
  for (const f of fields || []) {
    const required = f.requiredOnCreate || f.required;
    if (required || ctx.includeOptional) {
      payload[f.name] = buildDummyValue(f, ctx);
    }
  }
  return payload;
}
