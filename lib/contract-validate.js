/**
 * contract-validate.js — 契约快速校验（v0.20.0 内在闭环）
 *
 * 契约错误此前要跑到执行一半才炸，且常被误诊为"服务不可用"。
 * 规则全部来自 consumeContract 的真实归一/容错逻辑（不拍脑袋造规则）。
 * run-api 执行前串联校验（error 级直接拒跑），CLI 提供 validate-contract 命令。
 */

import { readFileSync, existsSync } from "node:fs";
import { stripBom } from "./shared/utils.js";
import { consumeContract } from "./contract-consumer.js";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

/**
 * 校验契约文件
 * @returns {{valid: boolean, findings: Array<{severity: "error"|"warning", message: string}>, kind: string|null}}
 */
export function validateContractFile(path) {
  if (!existsSync(path)) return { valid: false, findings: [{ severity: "error", message: `契约文件不存在: ${path}` }], kind: null };
  let data;
  try {
    if (!/\.md$/i.test(path)) {
      const rawData = JSON.parse(stripBom(readFileSync(path, "utf-8")));
      const rawValidation = validateContractData(rawData);
      if (!rawValidation.valid) return rawValidation;
    }
    const consumed = consumeContract(path);
    data = consumed.data;
    if (consumed.type === "bd-contract") {
      data = { ...data, resource: { entity: consumed.summary.entity },
        operations: Object.fromEntries(consumed.summary.operations.map((op) => [op.key, op])),
        transport: { successCode: consumed.summary.transport.successCode },
        models: { createRequest: consumed.summary.fields } };
    } else if (consumed.type === "page-spec" && consumed.summary.operationSource === "api-contract") {
      data = { ...data, linkedOperations: consumed.summary.operations };
    }
  } catch (e) {
    return { valid: false, findings: [{ severity: "error", message: `JSON 解析失败: ${e.message}` }], kind: null };
  }
  return validateContractData(data);
}

export function validateContractData(data) {
  const findings = [];
  const isPageSpec = Boolean(data?.page && (data?.mode || data?.dir));
  const kind = isPageSpec ? "page-spec" : data?.kind ?? null;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, findings: [{ severity: "error", message: "契约根节点必须是对象" }], kind };
  }
  if (data.kind === "wl-api-contract") {
    if (data.schemaVersion !== 1) findings.push({ severity: "error", message: `不支持 schemaVersion=${data.schemaVersion}，只支持 1` });
    if (data.protocolVersion !== undefined && data.protocolVersion !== "1.0") findings.push({ severity: "error", message: `不支持 protocolVersion=${data.protocolVersion}，只支持 1.0` });
  }

  if (!isPageSpec) {
    // ── wl-api-contract / bd 契约 ──
    const resource = data?.resource ?? data;
    if (!resource?.entity && !resource?.pageName && !resource?.name) {
      findings.push({ severity: "error", message: "缺少实体标识（resource.entity / pageName / name 均为空）" });
    }
    const operations = data?.operations ?? {};
    const opEntries = Object.entries(operations);
    if (opEntries.length === 0) {
      findings.push({ severity: "warning", message: "未声明任何操作（operations 为空）——契约无执行价值" });
    }
    for (const [key, op] of opEntries) {
      const p = op?.externalPath ?? op?.path;
      if (!p || typeof p !== "string") {
        findings.push({ severity: "error", message: `操作 ${key} 缺少 externalPath/path` });
        continue;
      }
      if (!p.startsWith("/")) {
        findings.push({ severity: "error", message: `操作 ${key} 的路径必须以 / 开头（当前: ${p}）` });
      }
      if (/\{[^}]*\}/.test(p) && !["detail", "update", "remove"].includes(key)) {
        findings.push({ severity: "error", message: `操作 ${key} 不应含路径占位符（{id} 只允许出现在 detail/update/remove）` });
      }
      if (/^\/order\/(queryPage|save)$/.test(p) && !["page", "create"].includes(key)) {
        findings.push({ severity: "warning", message: `操作 ${key} 的路径 ${p} 与键位语义不符（queryPage/save 通常对应 page/create），请核对` });
      }
      const rawMethod = op?.method;
      const method = String(rawMethod || "").toUpperCase();
      if (method && !HTTP_METHODS.has(method)) {
        findings.push({ severity: "error", message: `操作 ${key} 的 method 非法: ${method}（${[...HTTP_METHODS].join("/")}）` });
      } else if (rawMethod !== undefined && String(rawMethod) !== method) {
        findings.push({ severity: "warning", message: `操作 ${key} 的 method 建议大写（当前: ${rawMethod}）` });
      }
    }
    // createRequest 字段
    const fields = data?.models?.createRequest ?? data?.createRequest ?? [];
    if (Array.isArray(fields)) {
      const seen = new Set();
      for (const f of fields) {
        if (!f?.name) findings.push({ severity: "error", message: `createRequest 存在无名字段: ${JSON.stringify(f).slice(0, 60)}` });
        else if (seen.has(f.name)) findings.push({ severity: "error", message: `createRequest 字段重名: ${f.name}` });
        else seen.add(f.name);
        if (f?.required !== undefined && typeof f.required !== "boolean") {
          findings.push({ severity: "warning", message: `字段 ${f?.name} 的 required 应为布尔值（当前: ${JSON.stringify(f.required)}）` });
        }
      }
      if (fields.length === 0) {
        findings.push({ severity: "warning", message: "createRequest 为空——create 步骤将无字段可构造" });
      }
    }
    // transport
    const t = data?.transport ?? {};
    if (t.successCode !== undefined && !Number.isFinite(Number(t.successCode))) {
      findings.push({ severity: "error", message: `transport.successCode 必须是数值（当前: ${JSON.stringify(t.successCode)}）` });
    }
    const pg = t.pagination ?? {};
    if (pg.defaultSize !== undefined && pg.maxSize !== undefined && Number(pg.maxSize) < Number(pg.defaultSize)) {
      findings.push({ severity: "error", message: `transport.pagination.maxSize(${pg.maxSize}) 不得小于 defaultSize(${pg.defaultSize})` });
    }
  } else {
    // ── page-spec ──
    if (data.dir && String(data.dir).includes("\\")) {
      findings.push({ severity: "warning", message: "dir 含反斜杠（将自动归一为 / 路由，建议统一正斜杠）" });
    }
    if (!Array.isArray(data.columns) || data.columns.length === 0) {
      findings.push({ severity: "warning", message: "columns 为空——round1-detail 深度用例将无列可校验" });
    }
    const fields = (data.formSections ?? []).flatMap((s) => s.fields ?? []);
    if (fields.some((f) => f.required && !f.name && !f.field)) {
      findings.push({ severity: "error", message: "formSections 存在必填但无 name/field 的字段" });
    }
  }

  return { valid: findings.every((f) => f.severity !== "error"), findings, kind };
}
