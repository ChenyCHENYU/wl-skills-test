/**
 * contract-diff.js — 契约变更影响面分析（v0.17.0）
 *
 * 契约升级后回答三个问题：改了什么 / 哪些用例受影响要重跑 / 哪些用例新增或作废。
 * 供 CLI `diff` 与 MCP `wls_test_contract_diff` 使用（AI 消费结构化结果，token 友好）。
 */

import { consumeContract } from "./contract-consumer.js";
import { generateTestCaseMatrix } from "./contract-consumer.js";
import { generateFineGrainedCases } from "./case-fine-gen.js";
import { escapeMdCell } from "./shared/utils.js";

function opMap(summary) {
  return Object.fromEntries((summary.operations || []).map((o) => [o.key, o]));
}

function fieldMap(summary) {
  const fields = Array.isArray(summary.fields) ? summary.fields : summary.fields?.createRequest ?? [];
  return Object.fromEntries(fields.map((f) => [f.name, f]));
}

/**
 * @param {string} oldPath 旧契约路径
 * @param {string} newPath 新契约路径
 * @returns {{changes: Array, affected: {addedCases, removedCases, rerunFields}, summaryOld, summaryNew, markdown}}
 */
export function diffContracts(oldPath, newPath) {
  const a = consumeContract(oldPath);
  const b = consumeContract(newPath);
  const sa = a.summary;
  const sb = b.summary;
  const changes = [];

  // ── 操作级 ──
  const opsA = opMap(sa);
  const opsB = opMap(sb);
  for (const key of Object.keys(opsB)) {
    if (!opsA[key]) {
      changes.push({ level: "op", type: "added", target: key, detail: `新增操作 ${opsB[key].method || ""} ${opsB[key].externalPath}` });
    } else if (opsA[key].externalPath !== opsB[key].externalPath || opsA[key].method !== opsB[key].method) {
      changes.push({
        level: "op",
        type: "changed",
        target: key,
        detail: `${opsA[key].method} ${opsA[key].externalPath} → ${opsB[key].method} ${opsB[key].externalPath}`,
      });
    }
  }
  for (const key of Object.keys(opsA)) {
    if (!opsB[key]) changes.push({ level: "op", type: "removed", target: key, detail: `删除操作 ${opsA[key].externalPath}` });
  }

  // ── 字段级（create 模型）──
  const fieldsA = fieldMap(sa);
  const fieldsB = fieldMap(sb);
  const changedFields = [];
  for (const name of Object.keys(fieldsB)) {
    const fb = fieldsB[name];
    if (!fieldsA[name]) {
      changes.push({ level: "field", type: "added", target: name, detail: `新增字段（required=${Boolean(fb.required || fb.requiredOnCreate)}，type=${fb.type ?? fb.javaType ?? "?"}）` });
      changedFields.push(name);
    } else {
      const fa = fieldsA[name];
      const diffs = [];
      const reqA = Boolean(fa.required || fa.requiredOnCreate);
      const reqB = Boolean(fb.required || fb.requiredOnCreate);
      if (reqA !== reqB) diffs.push(`必填 ${reqA}→${reqB}`);
      const typeA = String(fa.type ?? fa.javaType ?? "");
      const typeB = String(fb.type ?? fb.javaType ?? "");
      if (typeA !== typeB) diffs.push(`类型 ${typeA}→${typeB}`);
      const lenA = fa.constraints?.maxLength ?? fa.constraints?.length ?? fa.maxLength;
      const lenB = fb.constraints?.maxLength ?? fb.constraints?.length ?? fb.maxLength;
      if (String(lenA ?? "") !== String(lenB ?? "")) diffs.push(`长度 ${lenA ?? "-"}→${lenB ?? "-"}`);
      const enumA = JSON.stringify(fa.enum ?? fa.enumValues ?? null);
      const enumB = JSON.stringify(fb.enum ?? fb.enumValues ?? null);
      if (enumA !== enumB) diffs.push("枚举取值变化");
      if (diffs.length > 0) {
        changes.push({ level: "field", type: "changed", target: name, detail: diffs.join("；") });
        changedFields.push(name);
      }
    }
  }
  for (const name of Object.keys(fieldsA)) {
    if (!fieldsB[name]) {
      changes.push({ level: "field", type: "removed", target: name, detail: "删除字段" });
      changedFields.push(name);
    }
  }

  // ── 传输层 ──
  if ((sa.transport?.successCode ?? 2000) !== (sb.transport?.successCode ?? 2000)) {
    changes.push({
      level: "transport",
      type: "changed",
      target: "successCode",
      detail: `${sa.transport?.successCode ?? 2000} → ${sb.transport?.successCode ?? 2000}（run-api 全链路判定口径变化）`,
    });
  }

  // ── 用例影响面 ──
  const casesA = generateTestCaseMatrix(sa).map((c) => c.id);
  const casesB = generateTestCaseMatrix(sb).map((c) => c.id);
  const fineA = new Map(generateFineGrainedCases(sa).map((c) => [c.id, c]));
  const fineB = new Map(generateFineGrainedCases(sb).map((c) => [c.id, c]));

  const addedCases = [...casesB.filter((id) => !casesA.includes(id)), ...[...fineB.keys()].filter((id) => !fineA.has(id))];
  const removedCases = [...casesA.filter((id) => !casesB.includes(id)), ...[...fineA.keys()].filter((id) => !fineB.has(id))];

  // 变更字段 → 关联的细粒度用例（field 命中）需要重跑
  const rerunCases = [];
  for (const [id, c] of fineB) {
    if (c.field && changedFields.includes(c.field)) rerunCases.push(id);
  }

  const affected = {
    addedCases: addedCases.slice(0, 200),
    removedCases: removedCases.slice(0, 200),
    rerunCases: rerunCases.slice(0, 200),
    changedFields,
  };

  return {
    entity: sb.entity || sb.pageName,
    changes,
    affected,
    markdown: renderDiffMarkdown({ entity: sb.entity || sb.pageName, changes, affected }),
  };
}

function renderDiffMarkdown({ entity, changes, affected }) {
  const lines = [`# 契约变更影响面 — ${entity}`, "", `变更共 ${changes.length} 项：`, ""];
  lines.push(`| 级别 | 类型 | 对象 | 说明 |`);
  lines.push(`|------|------|------|------|`);
  for (const c of changes) {
    const icon = c.type === "added" ? "➕" : c.type === "removed" ? "➖" : "✏️";
    lines.push(`| ${c.level} | ${icon} ${c.type} | ${escapeMdCell(c.target)} | ${escapeMdCell(c.detail)} |`);
  }
  lines.push("");
  lines.push(`## 用例影响`, "");
  lines.push(`- 新增用例 ${affected.addedCases.length} 条：${affected.addedCases.slice(0, 20).join(", ") || "无"}${affected.addedCases.length > 20 ? " …" : ""}`);
  lines.push(`- 作废用例 ${affected.removedCases.length} 条：${affected.removedCases.slice(0, 20).join(", ") || "无"}${affected.removedCases.length > 20 ? " …" : ""}`);
  lines.push(`- 变更字段关联、需重跑的细粒度用例 ${affected.rerunCases.length} 条：${affected.rerunCases.slice(0, 20).join(", ") || "无"}${affected.rerunCases.length > 20 ? " …" : ""}`);
  lines.push("");
  lines.push(`> 建议：重跑 \`wl-skills-test run-api --contract <新契约>\`（负例/读回/并发链路自动覆盖变更字段），E2E 按变更字段核对定位器与断言。`);
  return lines.join("\n");
}
