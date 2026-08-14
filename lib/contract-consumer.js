/**
 * contract-consumer.js — 消费 kit/bd/page-spec 三种契约，提取可测试资源
 *
 * 支持的契约格式：
 * 1. wl-api-contract（kit 前后端共享 API 契约）
 * 2. wl-contract.json（bd 后端全量契约）
 * 3. page-spec.json（kit 前端页面规格）
 */

import { readFileSync, existsSync } from "node:fs";

const DELIVERY_PROFILE = {
  profileId: "jh4j3-openapi3",
  protocolVersion: "1.0",
  successCode: 2000,
  envelope: ["code", "message", "data"],
  pagination: {
    requestCurrent: "current",
    requestSize: "size",
    defaultCurrent: 1,
    defaultSize: 10,
    maxSize: 200,
    recordsPath: "data.records",
    totalPath: "data.total",
  },
  standardOps: {
    page: { method: "POST", path: "queryPage", permission: "query_page" },
    detail: { method: "GET", path: "getById/{id}", permission: "get_by_id" },
    create: { method: "POST", path: "save", permission: "save" },
    update: { method: "PUT", path: "updateById", permission: "update_by_id" },
    remove: { method: "DELETE", path: "deleteById/{id}", permission: "delete_by_id" },
  },
};

/**
 * 自动检测契约类型并解析
 * @param {string} filePath — 契约文件路径
 * @returns {{type: string, data: object, summary: object}}
 */
export function consumeContract(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`契约文件不存在: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}`);
  }

  const type = detectContractType(data);

  switch (type) {
    case "wl-api-contract":
      return { type, data, summary: summarizeApiContract(data) };
    case "bd-contract":
      return { type, data, summary: summarizeBdContract(data) };
    case "page-spec":
      return { type, data, summary: summarizePageSpec(data) };
    default:
      throw new Error(`无法识别契约类型，请检查文件格式`);
  }
}

/**
 * 检测契约类型
 */
function detectContractType(data) {
  if (data.kind === "wl-api-contract") return "wl-api-contract";
  if (data.rootPackage && data.api && data.database) return "bd-contract";
  if (data.page && data.mode && data.dir) return "page-spec";
  return "unknown";
}

// ── wl-api-contract（kit）──────────────────────
function summarizeApiContract(data) {
  const ops = data.operations || {};
  const models = data.models || {};
  const resource = data.resource || {};

  return {
    contractId: resource.contractId || data.contractId || "unknown",
    module: resource.module || "",
    entity: resource.entity || "",
    description: resource.description || "",
    permissionPrefix: resource.permissionPrefix || "",

    operations: Object.entries(ops).map(([key, op]) => ({
      key,
      method: op.method,
      externalPath: op.externalPath || "",
      permission: op.permission || "",
    })),

    permissions: extractPermissions(ops, data),

    fields: extractModelFields(models),

    transport: data.transport
      ? {
          successCode: data.transport.successCode,
          pagination: data.transport.pagination?.defaultSize || 10,
          maxSize: data.transport.pagination?.maxSize || 200,
        }
      : null,

    completion: data.completion
      ? {
          status: data.completion.contractStatus || "draft",
          openQuestions: data.completion.openQuestions || [],
        }
      : null,
  };
}

// ── wl-contract.json（bd）───────────────────────
function summarizeBdContract(data) {
  const api = data.api || {};
  const entity = data.entity || {};
  const requestPath = api.requestPath || data.module || "resource";
  const externalBase = api.externalBasePath || `/${requestPath}`;
  const perms = api.permissions || {};
  const permPrefix = api.permissionPrefix || "";

  // bd 标准操作映射为统一 operations 格式（与 wl-api-contract 对齐）
  const stdOps = [
    { key: "page", method: "POST", path: "queryPage", perm: perms.page || `${permPrefix}_query_page` },
    { key: "detail", method: "GET", path: `getById/{id}`, perm: perms.detail || `${permPrefix}_get_by_id` },
    { key: "create", method: "POST", path: "save", perm: perms.create || `${permPrefix}_save` },
    { key: "update", method: "PUT", path: "updateById", perm: perms.update || `${permPrefix}_update_by_id` },
    { key: "remove", method: "DELETE", path: `deleteById/{id}`, perm: perms.remove || `${permPrefix}_delete_by_id` },
  ].map((o) => ({
    key: o.key,
    method: o.method,
    externalPath: `${externalBase}/${o.path}`,
    permission: o.perm,
  }));

  // customOperations 也映射为 operations
  const customOps = (data.customOperations || []).map((op) => ({
    key: op.name || "custom",
    method: op.method || "POST",
    externalPath: `${externalBase}${op.path || ""}`,
    permission: op.permission || "",
  }));

  const allOps = [...stdOps, ...customOps];

  return {
    contractId: data.contractId || "unknown",
    module: data.module || "",
    entity: entity.name || "",
    description: entity.description || "",
    table: entity.table || "",
    database: data.database || "mysql",
    permissionPrefix: permPrefix,
    rootPackage: data.rootPackage || "",

    operations: allOps,

    permissions: extractBdPermissions(api),

    fields: (data.fields || []).map((f) => ({
      name: f.name,
      column: f.column,
      javaType: f.javaType,
      dbType: f.dbType,
      comment: f.comment,
      writable: f.writable,
      requiredOnCreate: f.requiredOnCreate || false,
      queryMode: f.queryMode || "none",
      enumValues: f.enumValues || null,
      constraints: f.constraints || null,
      classification: f.classification || "public",
    })),

    customOperations: (data.customOperations || []).map((op) => ({
      name: op.name,
      summary: op.summary,
      method: op.method,
      path: op.path,
      permission: op.permission,
      kind: op.kind,
      preconditions: op.preconditions || [],
      patch: op.patch || [],
    })),

    relations: (data.relations || []).map((r) => ({
      name: r.name,
      type: r.type,
      detailEntity: r.detailEntity,
      joinColumn: r.joinColumn,
    })),
  };
}

// ── page-spec（kit 页面规格）────────────────────
function summarizePageSpec(data) {
  return {
    pageName: data.page || "",
    pageId: data.pageId || "",
    mode: data.mode || "",
    dir: data.dir || "",
    profileId: data.profileId || "",
    apiContract: data.apiContract || "",

    queryFields: (data.query || []).map((f) => ({
      name: f.name || f.field || "",
      label: f.label || "",
      type: f.type || "input",
      dictCode: f.dictCode || null,
      required: f.required || false,
    })),

    columns: (data.columns || []).map((c) => ({
      name: c.name || c.field || "",
      label: c.label || "",
      type: c.type || "text",
      width: c.width || null,
      dict: c.dict || null,
      clickable: c.clickable || false,
    })),

    toolbar: (data.toolbar || []).map((b) => ({
      label: b.label || "",
      color: b.color || b.type || "default",
      action: b.action || "",
    })),

    operations: (data.operations || []).map((o) => ({
      label: o.label || "",
      action: o.action || "",
    })),

    formSections: (data.formSections || []).map((s) => ({
      name: s.name,
      label: s.label,
      fieldCount: (s.fields || []).length,
      requiredFields: (s.fields || []).filter((f) => f.required).map((f) => f.name || f.field),
    })),

    // page-spec 的操作映射为统一 operations 格式（供 generateTestCaseMatrix）
    pageOperations: (data.operations || []).map((o) => ({
      label: o.label || "",
      action: o.action || "",
    })),
    toolbarActions: (data.toolbar || []).map((b) => ({
      label: b.label || "",
      action: b.action || "",
    })),

    // 标准操作推断（page-spec 基于模式推断 CRUD）
    operations: inferPageSpecOperations(data),

    features: data.features || {},
  };
}

// page-spec → 标准 CRUD 操作推断
function inferPageSpecOperations(data) {
  const base = data.dir || "/api";
  const ops = [];
  // LIST 模式推断有查询和 CRUD
  if (data.mode === "LIST" || data.mode === "MASTER_DETAIL" || data.mode === "TREE_LIST") {
    ops.push({ key: "page", method: "POST", externalPath: `${base}/queryPage`, permission: "" });
  }
  const toolbar = data.toolbar || [];
  const hasAdd = toolbar.some((b) => b.label?.match(/新增|新建|添加|创建/));
  if (hasAdd) {
    ops.push({ key: "create", method: "POST", externalPath: `${base}/save`, permission: "" });
  }
  const rowOps = data.operations || [];
  if (rowOps.some((o) => o.action === "edit" || o.label?.match(/编辑/))) {
    ops.push({ key: "update", method: "PUT", externalPath: `${base}/updateById`, permission: "" });
  }
  if (rowOps.some((o) => o.action === "delete" || o.label?.match(/删除/))) {
    ops.push({ key: "remove", method: "DELETE", externalPath: `${base}/deleteById/{id}`, permission: "" });
  }
  return ops;
}

// ── 辅助函数 ──────────────────────────────────
function extractPermissions(ops, data) {
  const perms = {};
  for (const [key, op] of Object.entries(ops)) {
    if (op.permission) perms[key] = op.permission;
  }
  // extensionOperations
  for (const ext of data.extensionOperations || []) {
    if (ext.permission) perms[ext.name || "extension"] = ext.permission;
  }
  return perms;
}

function extractBdPermissions(api) {
  return api.permissions || {};
}

function extractModelFields(models) {
  const result = {};
  for (const [modelName, fields] of Object.entries(models)) {
    result[modelName] = (fields || []).map((f) => ({
      name: f.name,
      description: f.description || "",
      required: f.required || false,
      type: f.type || "string",
      constraints: f.constraints || null,
      enum: f.enum || null,
    }));
  }
  return result;
}

/**
 * 从契约摘要生成测试用例矩阵（核心功能）
 * @param {object} summary — consumeContract 返回的 summary
 * @returns {Array<{id, name, module, type, method, path, permission, description}>}
 */
export function generateTestCaseMatrix(summary) {
  const cases = [];
  let seq = 0;

  // 标准操作测试用例（CRUD）
  for (const op of summary.operations || []) {
    seq++;
    cases.push({
      id: `TC-${String(seq).padStart(3, "0")}`,
      name: `${summary.entity || summary.pageName} - ${op.key} 正常路径`,
      module: summary.module || summary.pageName,
      type: "api",
      opKey: op.key,
      method: op.method,
      path: op.externalPath,
      permission: op.permission,
      description: `验证 ${op.key} 操作在正常输入下的正确性`,
      priority: "P1",
    });

    seq++;
    cases.push({
      id: `TC-${String(seq).padStart(3, "0")}`,
      name: `${summary.entity || summary.pageName} - ${op.key} 权限拒绝`,
      module: summary.module || summary.pageName,
      type: "permission",
      opKey: op.key,
      method: op.method,
      path: op.externalPath,
      permission: op.permission,
      description: `验证无权限用户访问 ${op.key} 时被拒绝`,
      priority: "P1",
    });
  }

  // 权限矩阵测试
  if (summary.permissionPrefix || summary.permissions) {
    seq++;
    cases.push({
      id: `TC-${String(seq).padStart(3, "0")}`,
      name: `${summary.entity || summary.pageName} - 权限矩阵全覆盖`,
      module: summary.module || summary.pageName,
      type: "permission",
      method: "ALL",
      path: "",
      permission: summary.permissionPrefix || "",
      description: "验证所有角色对所有操作的权限控制",
      priority: "P0",
    });
  }

  // 必填字段校验（从 models 或 fields 提取）
  const requiredFields = extractRequiredFields(summary);
  for (const field of requiredFields) {
    seq++;
    cases.push({
      id: `TC-${String(seq).padStart(3, "0")}`,
      name: `${summary.entity || summary.pageName} - ${field} 必填校验`,
      module: summary.module || summary.pageName,
      type: "boundary",
      method: "POST",
      path: "",
      permission: "",
      description: `验证 ${field} 为空时的校验提示`,
      priority: "P2",
    });
  }

  return cases;
}

function extractRequiredFields(summary) {
  const fields = [];
  // bd 契约
  if (summary.fields && Array.isArray(summary.fields)) {
    for (const f of summary.fields) {
      if (f.requiredOnCreate) {
        fields.push(f.name);
      }
    }
  }
  // kit models
  if (summary.fields && typeof summary.fields === "object" && !Array.isArray(summary.fields)) {
    const createModel = summary.fields.createRequest || [];
    for (const f of createModel) {
      if (f.required) fields.push(f.name);
    }
  }
  // page-spec formSections
  if (summary.formSections) {
    for (const s of summary.formSections) {
      for (const fname of s.requiredFields || []) {
        if (!fields.includes(fname)) fields.push(fname);
      }
    }
  }
  return [...new Set(fields)];
}

export { DELIVERY_PROFILE };
