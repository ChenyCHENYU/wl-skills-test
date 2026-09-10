/**
 * swagger-import.js — OpenAPI(Swagger) → wl-contract 转换器（v0.21.0）
 *
 * 接入故事的关键一环：后端已机器可读的接口描述（/v3/api-docs）直接变成测试契约，
 * 人不再手写第二份。确定性转换（关键词规则 + schema 解引用），不靠 AI 猜。
 *
 * 支持：OpenAPI 3.x（components.schemas）与 2.x（definitions）的 JSON；
 * YAML 请经 URL 获取（springdoc 默认返回 JSON）或先转 JSON。
 */

import { readFileSync, existsSync } from "node:fs";
import { stripBom } from "./shared/utils.js";

const OP_RULES = [
  { key: "page", test: (m, p, body) => /querypage|query-list|pagelist/.test(p) || (m === "post" && /\/(page|list)$/.test(p)) || body?.hasPaging },
  { key: "detail", test: (m, p) => m === "get" && /getbyid|detail|\/info/.test(p) },
  { key: "create", test: (m, p) => (m === "post" || m === "put") && /\/(save|create|add|insert)$/.test(p) },
  { key: "update", test: (m, p) => (m === "put" || m === "post") && /\/(update|edit|modify)/.test(p) },
  { key: "remove", test: (m, p) => m === "delete" && /delete|remove/.test(p) },
];

const TYPE_MAP = { integer: "number", number: "number", boolean: "boolean", string: "string", array: "string" };

/**
 * @param {string} source — URL（http(s)://）或本地 .json 文件路径
 * @param {object} [options] — { module: 只取该首段路径, entity, successCode }
 * @returns {Promise<{contract: object, warnings: string[], unmatched: string[]}>}
 */
export async function importOpenApi(source, options = {}) {
  const spec = await loadSpec(source, options);
  const isV3 = Boolean(spec.components?.schemas);
  const schemas = isV3 ? spec.components.schemas : spec.definitions ?? {};
  // OpenAPI 2.x 的 paths 相对 basePath，拼接才是完整外部路径（v3 无 basePath，恒空串）
  const basePath = isV3 ? "" : String(spec.basePath ?? "");

  const warnings = [];
  const unmatched = [];
  const ops = {};
  const opsRaw = {}; // 原始 OpenAPI 操作对象（requestBody/schema 提取用）
  const paths = spec.paths ?? {};
  let entity = options.entity || null;

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    const path = String(rawPath);
    const seg1 = path.split("/").filter(Boolean)[0] ?? "";
    if (options.module && seg1 !== options.module && !path.startsWith(`/${options.module}`)) continue;
    for (const method of ["get", "post", "put", "delete", "patch"]) {
      const op = pathItem?.[method];
      if (!op) continue;
      const lower = path.toLowerCase();
      const bodyHasPaging = pagingInBody(op, schemas, isV3);
      const rule = OP_RULES.find((r) => r.test(method, lower, { hasPaging: bodyHasPaging }));
      if (!rule) {
        unmatched.push(`${method.toUpperCase()} ${path}`);
        continue;
      }
      if (!ops[rule.key]) {
        ops[rule.key] = { method: method.toUpperCase(), externalPath: basePath + path, description: op.summary ?? op.description ?? "" };
        opsRaw[rule.key] = op;
        if (!entity && op.tags?.[0]) entity = op.tags[0];
      } else {
        unmatched.push(`${method.toUpperCase()} ${path}（${rule.key} 已由 ${ops[rule.key].externalPath} 占位）`);
      }
    }
  }

  // createRequest：从 create（缺则 update）的 requestBody schema 解引用
  const bodySchema = extractBodySchema(opsRaw.create ?? opsRaw.update);
  const fields = bodySchema ? schemaToFields(bodySchema, schemas) : [];
  if (ops.create && fields.length === 0) warnings.push("未能从 requestBody 提取字段（无 schema 或内联为空）——createRequest 为空，请人工补全");

  // 响应模型：detail 的 200 响应 schema（解一层信封 data/records）→ models.record
  // （漂移检测基准优先用响应模型，比"create 字段≈响应字段"的假设更准）
  const recordFields = extractRecordFields(opsRaw.detail, schemas);
  if (recordFields) warnings.push("已从 detail 响应提取 models.record——契约漂移检测将以响应模型为基准");

  // 查询模型：page 的 requestBody 属性（剔除分页参数）→ models.queryRequest（组合查询收敛探针的数据源）
  const queryFields = extractQueryFields(opsRaw.page, schemas);

  if (!entity) {
    entity = fields[0] ? guessEntityFromSchemaName(bodySchema) : segOf(ops.page ?? ops.create) || "Entity";
    warnings.push(`未从 tags/路径识别到实体名，默认使用 "${entity}"，请核对`);
  }
  const module = options.module || segOf(ops.page ?? ops.create ?? ops.remove ?? Object.values(ops)[0]) || entity;

  const successCode = options.successCode ?? 2000;
  if (!options.successCode) {
    warnings.push(`OpenAPI 不包含业务成功码信息，transport.successCode 默认 ${successCode}（jh4j 惯例），请按后端实际核对`);
  }
  if (!ops.page) warnings.push("未识别到列表查询操作（queryPage/page/list）——冒烟与读回步骤将无法执行");
  if (ops.create && !ops.remove) warnings.push("有新增但无删除操作——run-api 零污染清理将无法执行，测试可能残留数据");
  if (unmatched.length > 0) warnings.push(`${unmatched.length} 个端点未纳入 CRUD 映射（非标准命名或重复占位）: ${unmatched.slice(0, 5).join("; ")}${unmatched.length > 5 ? " …" : ""}`);

  const contract = {
    kind: "wl-api-contract",
    schemaVersion: 1,
    protocolVersion: "1.0",
    resource: { contractId: `${module}-${Date.now().toString(36)}`, module, entity },
    operations: ops,
    models: {
      createRequest: fields,
      ...(recordFields ? { record: recordFields } : {}),
      ...(queryFields && queryFields.length > 0 ? { queryRequest: queryFields } : {}),
    },
    transport: { successCode, pagination: { defaultCurrent: 1, defaultSize: 10, maxSize: 200 } },
    _source: { type: String(source).startsWith("http") ? "openapi-url" : "openapi-file", importedAt: new Date().toISOString() },
  };
  return { contract, warnings, unmatched };
}

async function loadSpec(source, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.token) headers["Authorization"] = options.token.startsWith("Bearer") || /^(bearer|basic)\s/i.test(options.token) ? options.token : `Bearer ${options.token}`;
  if (String(source).startsWith("http")) {
    const res = await fetch(source, { signal: AbortSignal.timeout(10000), headers });
    if (!res.ok) throw new Error(`获取 OpenAPI 失败: HTTP ${res.status}（${source}）`);
    return await res.json();
  }
  if (!existsSync(source)) throw new Error(`OpenAPI 文件不存在: ${source}`);
  if (!source.endsWith(".json")) throw new Error("仅支持 JSON（YAML 请经 URL 获取或先转 JSON）");
  return JSON.parse(stripBom(readFileSync(source, "utf-8")));
}

function segOf(op) {
  const p = op?.externalPath ?? "";
  return p.split("/").filter(Boolean)[0] ?? "";
}

function pagingInBody(op, schemas, isV3) {
  const ref = op?.requestBody?.content?.["application/json"]?.schema?.$ref;
  const schema = ref ? resolveRef(ref, schemas, isV3) : null;
  if (!schema?.properties) return false;
  return "current" in schema.properties && "size" in schema.properties;
}

function extractBodySchema(op) {
  // v3: requestBody.content；v2: parameters[in=body].schema
  const content = op?.requestBody?.content;
  const ref = content?.["application/json"]?.schema?.$ref;
  if (ref) return { $ref: ref };
  const inline = content?.["application/json"]?.schema;
  if (inline) return inline;
  const bodyParam = Array.isArray(op?.parameters) ? op.parameters.find((p) => p?.in === "body") : null;
  if (bodyParam?.schema?.$ref) return { $ref: bodyParam.schema.$ref };
  return bodyParam?.schema ?? null;
}

// detail 的 200 响应 → record 字段（解一层 data/records 信封；v2 的 responses 结构兼容）
function extractRecordFields(detailOp, schemas) {
  const json =
    detailOp?.responses?.["200"]?.content?.["application/json"]?.schema ??
    detailOp?.responses?.["200"]?.schema ??
    null;
  if (!json) return null;
  let target = json;
  // 信封解包（最多两层）：$ref → properties.data/$ref → properties.records/$ref
  for (let i = 0; i < 2 && target; i++) {
    if (target.$ref) {
      target = resolveRef(target.$ref, schemas);
      continue;
    }
    const inner = target.properties?.data ?? target.properties?.records ?? null;
    if (inner && (inner.$ref || inner.properties)) {
      target = inner;
      continue;
    }
    break;
  }
  if (!target?.properties) return null;
  const fields = schemaToFields(target, schemas).filter((f) => !["current", "size", "total", "pages"].includes(f.name));
  return fields.length > 0 ? fields : null;
}

// page 的 requestBody → 查询字段（剔除分页参数；枚举保留供数据工厂）
function extractQueryFields(pageOp, schemas) {
  const body = extractBodySchema(pageOp);
  if (!body) return null;
  const schema = body.$ref ? resolveRef(body.$ref, schemas) : body;
  if (!schema?.properties) return null;
  const fields = schemaToFields(schema, schemas).filter((f) => !["current", "size", "current-Page", "pageSize"].includes(f.name));
  return fields.length > 0 ? fields : null;
}

function resolveRef(ref, schemas) {
  const name = String(ref).split("/").pop();
  return schemas[name] ?? null;
}

function guessEntityFromSchemaName(schema) {
  const name = String(schema?.$ref ?? "").split("/").pop() ?? "";
  return name.replace(/(Save|Create|Add|Request|DTO|Dto)$/, "") || "Entity";
}

// OpenAPI schema → 契约字段（required/maxLength/type/description 全保留，这是断言深度的来源）
function schemaToFields(bodySchema, schemas) {
  const schema = bodySchema.$ref ? resolveRef(bodySchema.$ref, schemas) : bodySchema;
  if (!schema || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  const fields = [];
  for (const [name, p] of Object.entries(schema.properties)) {
    const f = {
      name,
      type: TYPE_MAP[p.type] ?? "string",
      description: p.title ?? p.description ?? name,
    };
    if (required.has(name)) f.required = true;
    const maxLen = p.maxLength ?? (p.type === "string" ? undefined : undefined);
    if (maxLen !== undefined) f.constraints = { maxLength: maxLen };
    if (p.minimum !== undefined || p.maximum !== undefined) {
      f.constraints = { ...(f.constraints ?? {}), ...(p.minimum !== undefined ? { min: p.minimum } : {}), ...(p.maximum !== undefined ? { max: p.maximum } : {}) };
    }
    if (Array.isArray(p.enum) && p.enum.length > 0) f.enumValues = p.enum;
    fields.push(f);
  }
  return fields;
}
