/**
 * contract-consumer.js — 消费 kit/bd/page-spec 三种契约，提取可测试资源
 *
 * 支持的契约格式：
 * 1. wl-api-contract（kit 前后端共享 API 契约）
 * 2. wl-contract.json（bd 后端全量契约）
 * 3. page-spec.json（kit 前端页面规格）
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join, parse as parsePath } from "node:path";

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
export function consumeContract(filePath, options = {}) {
  const absolutePath = resolve(filePath);
  const visited = new Set(options._visited || []);
  if (visited.has(absolutePath)) throw new Error("apiContract 引用存在循环");
  visited.add(absolutePath);
  if (!existsSync(filePath)) {
    throw new Error(`契约文件不存在: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""); // 剥离 UTF-8 BOM（Windows 记事本/PowerShell 产出）
  options._readFiles?.add(absolutePath);
  let data;
  try {
    if (/\.md$/i.test(filePath)) {
      const contracts = [...raw.matchAll(/```wl-api-contract\s*\r?\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
      const selected = options.contractId ? contracts.filter((contract) => contract.resource?.contractId === options.contractId || contract.contractId === options.contractId) : contracts;
      if (selected.length !== 1) throw new Error(`api.md 必须明确选择一个 wl-api-contract 区块（匹配 ${selected.length} 个）`);
      data = selected[0];
    } else data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}`);
  }

  const type = detectContractType(data);

  switch (type) {
    case "wl-api-contract":
      assertApiVersion(data);
      return { type, data, summary: summarizeApiContract(data) };
    case "bd-contract":
      if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error(`不支持 bd schemaVersion=${data.schemaVersion}`);
      return { type, data, summary: summarizeBdContract(data, resolveDeliveryProfile(filePath, data, options)) };
    case "page-spec": {
      const summary = summarizePageSpec(data);
      if (data.apiContract) {
        const reference = typeof data.apiContract === "string" ? data.apiContract : data.apiContract.path;
        if (!reference || typeof reference !== "string") throw new Error("page-spec.apiContract 必须提供契约相对路径");
        const [referencePath, fragment] = reference.split("#");
        const resolved = resolve(dirname(filePath), referencePath);
        if (resolved === resolve(filePath)) throw new Error("page-spec.apiContract 不得引用页面规格自身");
        const api = consumeContract(resolved, { ...options, _visited: visited, contractId: data.apiContract.contractId || fragment || data.contractId });
        if (!["wl-api-contract", "bd-contract"].includes(api.type)) throw new Error("page-spec.apiContract 必须引用 API 契约");
        Object.assign(summary, api.summary, { pageName: data.page, apiContract: data.apiContract,
          apiContractPath: resolved, operationSource: "api-contract" });
      } else {
        summary.operationSource = "page-intent";
        summary.apiFactsStatus = "unresolved";
        summary.unresolvedApiFacts = ["API 契约、请求方法和真实接口路径；请提供 page-spec.apiContract"];
      }
      return { type, data, summary };
    }
    default:
      throw new Error(`无法识别契约类型，请检查文件格式`);
  }
}

function assertApiVersion(data) {
  if (data.schemaVersion !== 1) throw new Error(`不支持 wl-api-contract schemaVersion=${data.schemaVersion}`);
  if (data.protocolVersion !== undefined && data.protocolVersion !== "1.0") throw new Error(`不支持 wl-api-contract protocolVersion=${data.protocolVersion}`);
}

export function assertApiFacts(summary) {
  if (summary.apiFactsStatus === "unresolved" || !summary.operations?.length ||
      summary.operations.some((op) => !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(op.method) || typeof op.externalPath !== "string" || !op.externalPath.startsWith("/"))) {
    throw new Error("API 事实未决：请提供真实 API 契约（page-spec.apiContract 或 wl-api-contract），不能从页面路由推测接口");
  }
}

function resolveDeliveryProfile(filePath, data, options) {
  let profile = options.deliveryProfile || options.profile;
  if (typeof profile === "string") {
    const profilePath = resolve(dirname(filePath), profile);
    profile = JSON.parse(readFileSync(profilePath, "utf8").replace(/^\uFEFF/, ""));
    options._readFiles?.add(profilePath);
  }
  if (!profile) {
    let current = dirname(resolve(filePath));
    while (true) {
      const local = join(current, ".wl-skills-bd/contracts/wl-delivery-profile.v1.json");
      if (existsSync(local)) {
        profile = JSON.parse(readFileSync(local, "utf8").replace(/^\uFEFF/, ""));
        options._readFiles?.add(local);
        break;
      }
      if (current === parsePath(current).root) break;
      current = dirname(current);
    }
  }
  if (!profile) {
    if (data.profile && data.profile !== DELIVERY_PROFILE.profileId) throw new Error(`缺少 ${data.profile} 的 delivery profile；请显式提供项目 profile`);
    return null;
  }
  validateDeliveryProfile(profile);
  if (data.profile && profile.profileId !== data.profile) throw new Error(`delivery profile ${profile.profileId} 与契约 ${data.profile} 不匹配`);
  return profile;
}

function validateDeliveryProfile(profile) {
  const fail = (location) => { throw new Error(`delivery profile ${location} 缺失或不合法，不能回退默认值`); };
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  if (profile.protocolVersion !== "1.0") throw new Error("delivery profile protocolVersion 不兼容");
  if (!text(profile.profileId)) fail("profileId");
  const transport = profile.transport;
  if (!transport || typeof transport !== "object" || Array.isArray(transport)) fail("transport");
  const operations = transport.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) fail("transport.operations");
  for (const key of Object.keys(DELIVERY_PROFILE.standardOps)) {
    const operation = operations[key];
    if (!operation || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method) ||
        !text(operation.path) || /:\/\//.test(operation.path) || operation.path.split("/").includes("..")) fail(`transport.operations.${key}`);
  }
  const envelope = transport.responseEnvelope;
  if (!envelope || typeof envelope.successCode !== "number" || !Number.isFinite(envelope.successCode)) fail("transport.responseEnvelope.successCode");
  const envelopeFields = [envelope.codeField, envelope.messageField, envelope.dataField];
  if (envelopeFields.some((field) => !text(field)) || new Set(envelopeFields).size !== 3) fail("transport.responseEnvelope fields");
  const pagination = transport.pagination;
  if (!pagination || !text(pagination.requestCurrent) || !text(pagination.requestSize) || pagination.requestCurrent === pagination.requestSize) fail("transport.pagination request fields");
  for (const key of ["defaultCurrent", "defaultSize", "maxSize"]) {
    if (!Number.isInteger(pagination[key]) || pagination[key] < 1) fail(`transport.pagination.${key}`);
  }
  if (pagination.maxSize < pagination.defaultSize) fail("transport.pagination.maxSize");
  if (!text(pagination.responseRecords || pagination.recordsPath) || !text(pagination.responseTotal || pagination.totalPath)) fail("transport.pagination response fields");
}

/**
 * 检测契约类型
 */
function detectContractType(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "unknown";
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
  const fields = extractModelFields(models);
  for (const [opKey, alias] of [["create", "createRequest"], ["update", "updateRequest"], ["page", "queryRequest"]]) {
    const model = ops[opKey]?.requestModel;
    if (!fields[alias] && model && fields[model]) fields[alias] = fields[model];
  }
  const byKey = new Map(Object.entries(ops).map(([key, op]) => [key, { ...op, key }]));
  for (const extension of data.extensionOperations || []) {
    if (typeof extension === "string") {
      if (!byKey.has(extension)) throw new Error(`extensionOperations 引用未声明操作: ${extension}`);
      continue;
    }
    const key = extension?.name || extension?.key;
    if (!key) throw new Error("extensionOperations 对象缺少操作名");
    if (byKey.has(key)) continue;
    const externalPath = extension.externalPath || extension.path;
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(extension.method) || typeof externalPath !== "string" || !externalPath.startsWith("/")) {
      throw new Error(`extensionOperations.${key} 缺少真实 method/externalPath，不能推测接口`);
    }
    byKey.set(key, { ...extension, key, externalPath });
  }
  const allOperations = [...byKey.values()];

  return {
    contractId: resource.contractId || data.contractId || "unknown",
    module: resource.module || "",
    entity: resource.entity || "",
    description: resource.description || "",
    permissionPrefix: resource.permissionPrefix || "",
    profileId: data.source?.profile || data.profile || "",
    apiFactsStatus: "resolved",

    operations: allOperations.filter((op) => op.applicability !== "not-applicable").map((op) => ({
      ...op,
      method: op.method,
      externalPath: op.externalPath || "",
      permission: op.permission || "",
    })),

    permissions: extractPermissions(ops, data),

    fields,
    models: structuredClone(models),
    operationModels: Object.fromEntries(allOperations.map((op) => [op.key, {
      requestModel: op.requestModel, responseModel: op.responseModel,
      requestFields: models[op.requestModel] || [], responseFields: models[op.responseModel] || [],
    }])),

    transport: data.transport
      ? {
          successCode: data.transport.successCode,
          ...data.transport,
          paginationConfig: data.transport.pagination,
          pagination: data.transport.pagination?.defaultSize || 10,
          maxSize: data.transport.pagination?.maxSize || 200,
        }
      : null,

    completion: data.completion
      ? {
          ...data.completion,
          status: data.completion.contractStatus || data.completion.status || "draft",
          openQuestions: data.completion.openQuestions || [],
        }
      : null,
  };
}

// ── wl-contract.json（bd）───────────────────────
function summarizeBdContract(data, profile) {
  const api = data.api || {};
  const entity = data.entity || {};
  const requestPath = api.requestPath || data.module || "resource";
  const externalBase = api.externalBasePath || `/${requestPath}`;
  const perms = api.permissions || {};
  const permPrefix = api.permissionPrefix || "";

  // bd 标准操作映射为统一 operations 格式（与 wl-api-contract 对齐）
  const defaultOps = [
    { key: "page", method: "POST", path: "queryPage", perm: perms.page || `${permPrefix}_query_page` },
    { key: "detail", method: "GET", path: `getById/{id}`, perm: perms.detail || `${permPrefix}_get_by_id` },
    { key: "create", method: "POST", path: "save", perm: perms.create || `${permPrefix}_save` },
    { key: "update", method: "PUT", path: "updateById", perm: perms.update || `${permPrefix}_update_by_id` },
    { key: "remove", method: "DELETE", path: `deleteById/{id}`, perm: perms.remove || `${permPrefix}_delete_by_id` },
  ];
  const profileOps = profile ? Object.entries(profile.transport.operations).map(([key, op]) => ({
    key, method: op.method, path: op.path, perm: perms[key] || defaultOps.find((item) => item.key === key)?.perm || "",
  })) : defaultOps;
  const stdOps = profileOps.map((o) => ({
    key: o.key,
    method: o.method,
    externalPath: `${externalBase.replace(/\/$/, "")}/${o.path.replace(/^\//, "")}`,
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
    profileId: profile?.profileId || data.profile || DELIVERY_PROFILE.profileId,
    apiFactsStatus: "resolved",
    transport: {
      successCode: profile?.transport.responseEnvelope?.successCode ?? DELIVERY_PROFILE.successCode,
      pagination: profile?.transport.pagination?.defaultSize ?? DELIVERY_PROFILE.pagination.defaultSize,
      maxSize: profile?.transport.pagination?.maxSize ?? DELIVERY_PROFILE.pagination.maxSize,
      paginationConfig: profile?.transport.pagination || DELIVERY_PROFILE.pagination,
      responseEnvelope: profile?.transport.responseEnvelope,
    },

    operations: allOps,

    permissions: extractBdPermissions(api),

    fields: (data.fields || []).map((f) => ({
      ...f,
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
    // 路由推导：dir 可能是路由（/xxx）或文件系统路径（src/views/xxx → /xxx）
    route: deriveRoute(data),
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
  // UI intentions are useful on their own; transport facts require an API contract.
  const ops = [];
  // LIST 模式推断有查询和 CRUD
  if (data.mode === "LIST" || data.mode === "MASTER_DETAIL" || data.mode === "TREE_LIST") {
    ops.push({ key: "page", intent: "query", surface: "ui" });
  }
  const toolbar = data.toolbar || [];
  const rowOps = data.operations || [];
  // 操作可能来自行内 operations，也可能来自 toolbar（勾选行后点工具栏，真实项目常见）
  const hasAdd = toolbar.some((b) => b.label?.match(/新增|新建|添加|创建/));
  const hasEdit = toolbar.some((b) => b.label?.match(/修改|编辑/)) || rowOps.some((o) => o.action === "edit" || o.label?.match(/编辑/));
  const hasDelete = toolbar.some((b) => b.label?.match(/删除|移除/)) || rowOps.some((o) => o.action === "delete" || o.label?.match(/删除/));
  if (hasAdd) {
    ops.push({ key: "create", intent: "create", surface: "ui" });
  }
  if (hasEdit) {
    ops.push({ key: "update", intent: "edit", surface: "ui" });
  }
  if (hasDelete) {
    ops.push({ key: "remove", intent: "delete", surface: "ui" });
  }
  return ops;
}

// dir 可能是路由（/produce/xxx）或文件系统路径（src/views/produce/xxx → /produce/xxx）
function deriveRoute(data) {
  if (data.route) return data.route;
  const dir = data.dir || "";
  if (dir.startsWith("/")) return dir;
  const idx = dir.indexOf("/views/");
  if (idx > -1) {
    return dir.slice(idx + "/views".length) || "/";
  }
  return dir ? `/${dir}` : "/";
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
      ...f,
      name: f.name,
      description: f.description || "",
      required: f.required || false,
      type: f.type || "string",
      constraints: f.constraints || null,
      enum: f.enum || null,
    }));
  }
  // Existing generators use conventional names; retain named operation models too.
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
  const uiOnly = summary.apiFactsStatus === "unresolved";

  // 标准操作测试用例（CRUD）
  for (const op of summary.operations || []) {
    seq++;
    cases.push({
      id: `TC-${String(seq).padStart(3, "0")}`,
      name: `${summary.entity || summary.pageName} - ${op.key} 正常路径`,
      module: summary.module || summary.pageName,
      type: uiOnly ? "ui" : "api",
      opKey: op.key,
      method: uiOnly ? "" : op.method,
      path: uiOnly ? summary.route : op.externalPath,
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
      method: uiOnly ? "" : op.method,
      path: uiOnly ? summary.route : op.externalPath,
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
      method: uiOnly ? "" : "POST",
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
