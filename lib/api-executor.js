/**
 * api-executor.js — 深度 API 接口测试执行器（v0.9.0）
 *
 * 从契约构建执行 DAG（前置失败级联 skip + 原因标注），每步四层断言：
 *   L1 成功码（HTTP < 400 且 业务码 = 契约 successCode）
 *   L2 结构（records 数组 / total 数值 / 契约声明字段存在且类型匹配）
 *   L3 数据正确性（写后读回字段级比对、清理后复查不存在）
 *   L4 负例与安全（必填缺失/类型错误/超长必须被拒、重复提交、无权限 token 必须被拒）
 *
 * DAG: smoke-page → create → read-back → update → detail
 *      → neg-required → neg-type → neg-length → duplicate
 *      → perm-page/detail(perm-create/remove 可选探针) → pagination-bound
 *      → remove → verify-gone
 *
 * 其他能力：
 * - 自播种：列表无数据时由 create 产生种子记录供后续步骤使用
 * - 零污染：所有 create（含重复提交意外成功）登记清理，remove 后复查不存在
 * - 契约漂移：响应实际字段 vs 契约 models 全量 diff（missing/extra/typeMismatch）
 * - 报文快照：请求/响应体（截断）进 JSON 报告，失败可回溯
 * - 字典注入：--dict-file 提供枚举字段真实合法值
 */

import { readFileSync } from "node:fs";
import { consumeContract } from "./contract-consumer.js";
import { buildDummyValue } from "./test-data-factory.js";

// ── 工具 ───────────────────────────────────────
function truncateStr(s, n = 400) {
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > n ? str.slice(0, n) + "…(截断)" : str;
}

function extractRecordId(body) {
  if (body?.data == null) return null;
  const data = body.data;
  if (typeof data === "string" || typeof data === "number") return String(data);
  for (const key of ["id", "Id", "ID", "pkId", "uuid"]) {
    if (data[key] !== undefined && data[key] !== null) return String(data[key]);
  }
  return null;
}

// 从 body.data 提取记录列表（兼容 data.records / records / data 为数组）
function extractRecords(body) {
  const d = body?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.records)) return d.records;
  if (Array.isArray(body?.records)) return body.records;
  return [];
}

function extractTotal(body) {
  const d = body?.data;
  const t = d?.total ?? body?.total;
  return typeof t === "number" ? t : null;
}

// ── 契约字段归一（kit 对象式 / bd 平铺式 → 统一 create 字段列表）──
function normalizeCreateFields(summary) {
  if (Array.isArray(summary.fields)) return summary.fields; // bd
  if (summary.fields?.createRequest) return summary.fields.createRequest; // kit
  return [];
}

// 契约声明的"记录字段"（漂移检测基准；kit 优先 listResponse 类模型，bd 用全字段）
function declaredRecordFields(summary) {
  if (summary.fields?.listResponse) return summary.fields.listResponse;
  if (summary.fields?.pageResponse) return summary.fields.pageResponse;
  if (summary.fields?.record) return summary.fields.record;
  if (Array.isArray(summary.fields)) return summary.fields;
  if (summary.fields?.createRequest) return summary.fields.createRequest;
  return [];
}

const JS_TYPE = { number: "number", integer: "number", long: "number", float: "number", double: "number", bigdecimal: "number", decimal: "number", string: "string", char: "string", text: "string", boolean: "boolean", bool: "boolean" };
function declaredJsType(f) {
  const t = String(f.type || f.javaType || "").toLowerCase();
  return JS_TYPE[t] || null;
}
function actualJsType(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "array";
  return "object";
}

const AUDIT_FIELDS = /^(create_?time|update_?time|creator|updater|create_?by|update_?by|deleted|revision|tenant_?id|version)$/i;

/**
 * 执行深度 API 接口测试
 * @param {object} options
 *   baseUrl / contractPath / token / timeout(10s)
 *   noPermToken — 无权限账号 token（启用权限验证步骤）
 *   permWriteProbe — 允许对写操作做权限探针（意外成功会自动清理）
 *   lenientCoercion — 类型负例被后端宽恕时记 warn 而非 fail
 *   dictFile — 字典 JSON 文件路径（{字段名/字典码: [合法值]}）
 */
export async function runApiTests(options = {}) {
  const {
    baseUrl = "http://localhost:8080",
    contractPath,
    token,
    noPermToken,
    timeout = 10000,
    permWriteProbe = false,
    lenientCoercion = false,
    dictFile,
  } = options;

  if (!contractPath) return { error: "需要 contractPath 参数" };

  const result = consumeContract(contractPath);
  const summary = result.summary;
  const opByKey = Object.fromEntries((summary.operations || []).map((o) => [o.key, o]));
  const createFields = normalizeCreateFields(summary);
  const successCode = summary.transport?.successCode ?? 2000;
  const maxSize = summary.transport?.maxSize ?? 200;

  // 字典注入（枚举字段真实合法值）
  let dict = null;
  if (dictFile) {
    try {
      dict = JSON.parse(readFileSync(dictFile, "utf-8"));
    } catch {
      return { error: `字典文件解析失败: ${dictFile}` };
    }
  }

  const businessKey = `AT_${Date.now().toString(36).toUpperCase()}`;
  const runId = businessKey;

  // ── HTTP 封装（超时 + 快照）─────────────────
  const http = async (path, { method = "GET", body, useToken = token, extraHeaders = {} } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (useToken) {
      headers["Authorization"] = /^(bearer|basic)\s/i.test(useToken) ? useToken : `Bearer ${useToken}`;
    }
    const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 非 JSON 由状态码兜底
      }
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        json,
        durationMs: Date.now() - started,
        snapshot: { url, method, requestBody: body !== undefined ? truncateStr(body) : undefined, httpStatus: res.status, responseBody: truncateStr(text) },
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        json: null,
        durationMs: Date.now() - started,
        error: e.name === "AbortError" ? `超时 (${timeout}ms)` : e.message,
        snapshot: { url, method, requestBody: body !== undefined ? truncateStr(body) : undefined, error: e.message },
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const isSuccess = (r) => r.ok && (r.json?.code === successCode || r.json?.code === 0 || r.json?.code === 200 || r.json?.code === undefined);
  const rejected = (r) => !isSuccess(r);
  // "被拒绝"必须是后端真实响应（HTTP>=1）；网络错误/超时（status=0）不算拒绝，防负例假通过
  const refused = (r) => r.status > 0 && rejected(r);
  // 负例/权限/幂等步骤遇到网络错误时标记 error（而非误判为"拒绝"）
  const guardTransport = (entry, r) => {
    if (r.status === 0) {
      entry.status = "error";
      entry.reason = `网络错误: ${r.error || "无响应"}`;
      return false;
    }
    return true;
  };

  // ── 断言收集器 ─────────────────────────────
  const results = [];
  const drift = { missing: [], extra: [], typeMismatch: [] };
  const cleanupRegistry = []; // {id, label}

  async function runStep(step) {
    const entry = {
      id: step.id,
      name: step.name,
      kind: step.kind,
      status: "pass",
      assertions: [],
      durationMs: 0,
    };
    const gate = step.gate ? step.gate() : null;
    if (gate) {
      entry.status = "skip";
      entry.reason = `前置失败: ${gate}`;
      results.push(entry);
      return entry;
    }
    const started = Date.now();
    try {
      await step.execute(entry);
    } catch (e) {
      entry.status = "error";
      entry.reason = e.message;
    }
    entry.durationMs = Date.now() - started;
    if (entry.snapshot) entry.snapshot = truncateStr(entry.snapshot, 600);
    results.push(entry);
    return entry;
  }

  const assert = (entry, name, pass, detail = "") => {
    entry.assertions.push({ name, pass, detail: String(detail) });
    if (!pass && entry.status === "pass") {
      entry.status = "fail";
      entry.reason = `断言失败: ${name}${detail ? ` — ${detail}` : ""}`;
    }
  };

  // ── 共享状态 ───────────────────────────────
  const ctx = {
    createdId: null,
    createdRecord: null,
    payload: null,
    pageFailed: false,
    createFailed: false,
    seedUsed: false,
  };

  // 构造合法 payload（数据工厂 + 字典注入；runIdOverride 用于负例独立业务键，
  // 避免与正例 create 的重复校验相互掩盖）
  const buildPayload = (mutate = {}, runIdOverride) => {
    const effRunId = runIdOverride || runId;
    const payload = {};
    for (const f of createFields) {
      if (f.required || f.requiredOnCreate) {
        payload[f.name] = buildDummyValue(f, { runId: effRunId });
      }
    }
    if (Object.keys(payload).length === 0) {
      for (const f of createFields.slice(0, 3)) payload[f.name] = buildDummyValue(f, { runId: effRunId });
    }
    if (dict) {
      for (const key of Object.keys(payload)) {
        const dv = dict[key] || dict[createFields.find((f) => f.name === key)?.enum];
        if (Array.isArray(dv) && dv.length > 0) payload[key] = dv[0];
      }
    }
    return { ...payload, ...mutate };
  };

  const replaceId = (path, id) => path.replace(/\{id\}/g, encodeURIComponent(id));
  const queryRecords = async (extra = {}) => {
    const r = await http(opByKey.page.externalPath, {
      method: opByKey.page.method || "POST",
      body: { current: 1, size: 100, ...extra },
    });
    return { r, records: isSuccess(r) ? extractRecords(r.json) : [] };
  };

  const findRecordById = (records, id) =>
    records.find((rec) => JSON.stringify(rec).includes(String(id))) || null;

  // 漂移检测（首个成功列表响应的记录 vs 契约声明）
  const collectDrift = (record) => {
    if (!record || typeof record !== "object") return;
    const declared = declaredRecordFields(summary);
    if (declared.length === 0) return;
    const declaredNames = new Set(declared.map((f) => f.name).filter(Boolean));
    for (const key of Object.keys(record)) {
      if (!declaredNames.has(key) && !AUDIT_FIELDS.test(key)) {
        if (!drift.extra.some((d) => d.field === key)) {
          drift.extra.push({ field: key, detail: "响应有但契约未声明" });
        }
      }
    }
    for (const f of declared) {
      if (!f.name) continue;
      if (!(f.name in record)) {
        if (!drift.missing.some((d) => d.field === f.name)) {
          drift.missing.push({ field: f.name, detail: "契约声明但响应缺失" });
        }
        continue;
      }
      const want = declaredJsType(f);
      const got = actualJsType(record[f.name]);
      if (want && got && want !== got) {
        drift.typeMismatch.push({ field: f.name, declared: want, actual: got });
      }
    }
  };

  // ══ DAG 步骤定义 ═════════════════════════════
  const steps = [];
  let seq = 0;
  const S = (kind, name, gate, execute) => steps.push({ id: `S${String(++seq).padStart(2, "0")}`, kind, name, gate, execute });

  // S01 列表冒烟 + 结构断言 + 漂移基准
  if (opByKey.page) {
    S("smoke", "列表查询冒烟（结构断言）", null, async (entry) => {
      const { r, records } = await queryRecords();
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) {
        ctx.pageFailed = true;
        return;
      }
      assert(entry, "成功信封", isSuccess(r), `HTTP=${r.status} code=${r.json?.code}`);
      if (isSuccess(r)) {
        assert(entry, "records 为数组", Array.isArray(records), `实际 ${typeof records}`);
        const total = extractTotal(r.json);
        assert(entry, "total 为数值", total !== null, `实际 ${total}`);
        if (records.length > 0) collectDrift(records[0]);
      } else {
        ctx.pageFailed = true;
      }
    });
  }

  // S02 新增（正例）
  if (opByKey.create) {
    S("create", "新增（合法 payload）", null, async (entry) => {
      ctx.payload = buildPayload();
      const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: ctx.payload });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) {
        ctx.createFailed = true;
        return;
      }
      assert(entry, "成功信封", isSuccess(r), `HTTP=${r.status} code=${r.json?.code} msg=${r.json?.message ?? ""}`);
      if (isSuccess(r)) {
        const id = extractRecordId(r.json);
        assert(entry, "返回真实业务主键", Boolean(id), "新增未返回主键，后续读回/清理无法执行");
        if (id) {
          ctx.createdId = id;
          cleanupRegistry.push({ id, label: "create" });
        }
      } else {
        ctx.createFailed = true;
      }
    });
  }

  // S03 写后读回（数据正确性）
  if (opByKey.page && opByKey.create) {
    S("readback", "写后读回字段比对", () => (ctx.pageFailed ? "列表查询失败" : ctx.createFailed || !ctx.createdId ? "新增失败" : null), async (entry) => {
      const { records } = await queryRecords();
      const rec = findRecordById(records, ctx.createdId);
      assert(entry, "列表可查到新增主键", Boolean(rec), `queryPage 未查到 ${ctx.createdId}，疑似未真实落库`);
      if (rec) {
        ctx.createdRecord = rec;
        collectDrift(rec); // 空库时冒烟无记录可比，读回阶段补齐漂移基准
        let compared = 0;
        for (const [k, v] of Object.entries(ctx.payload)) {
          if (!(k in rec) || rec[k] === null || rec[k] === undefined) continue;
          const same = typeof v === "number" ? Number(rec[k]) === v : String(rec[k]).trim() === String(v).trim();
          assert(entry, `字段回读一致: ${k}`, same, `写入 ${JSON.stringify(v)} → 读回 ${JSON.stringify(rec[k])}`);
          compared++;
        }
        assert(entry, "至少比对一个字段", compared > 0, "payload 字段均未出现在记录中");
      }
    });
  }

  // S04 更新
  if (opByKey.update) {
    S("update", "更新（含主键）", () => (!ctx.createdId ? "无可用主键（新增失败或缺失）" : null), async (entry) => {
      const r = await http(opByKey.update.externalPath, {
        method: opByKey.update.method || "PUT",
        body: { ...ctx.payload, id: ctx.createdId },
      });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      assert(entry, "成功信封", isSuccess(r), r.error || `HTTP=${r.status} code=${r.json?.code}`);
    });
  }

  // S05 详情
  if (opByKey.detail) {
    S("detail", "详情（真实主键）", () => (!ctx.createdId ? "无可用主键（新增失败或缺失）" : null), async (entry) => {
      const r = await http(replaceId(opByKey.detail.externalPath, ctx.createdId), { method: opByKey.detail.method || "GET" });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      assert(entry, "成功信封", isSuccess(r), r.error || `HTTP=${r.status} code=${r.json?.code}`);
    });
  }

  // S06-S08 负例：必填缺失 / 类型错误 / 超长越界
  const requiredField = createFields.find((f) => f.required || f.requiredOnCreate);
  const numericField = createFields.find((f) => ["number", "integer", "long", "float", "double", "bigdecimal", "decimal"].includes(String(f.type || f.javaType || "").toLowerCase()));
  const maxLengthField = createFields.find((f) => f.constraints?.maxLength || f.constraints?.length || f.maxLength);

  if (opByKey.create && requiredField) {
    S("negative", `负例：必填缺失（${requiredField.name}）`, () => (ctx.createFailed ? "新增正例失败，负例无判别力" : null), async (entry) => {
      const payload = buildPayload({ [requiredField.name]: undefined }, `${runId}_NEGR`);
      delete payload[requiredField.name];
      const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: payload });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      assert(entry, "后端拒绝缺失必填", refused(r), `缺失 ${requiredField.name} 仍返回成功（校验缺口）`);
      if (isSuccess(r)) {
        const id = extractRecordId(r.json);
        if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: "neg-required 意外成功" });
      }
    });
  }

  if (opByKey.create && numericField) {
    S("negative", `负例：类型错误（${numericField.name} 传字符串）`, () => (ctx.createFailed ? "新增正例失败，负例无判别力" : null), async (entry) => {
      const payload = buildPayload({ [numericField.name]: "AT_NOT_A_NUMBER" }, `${runId}_NEGT`);
      const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: payload });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      if (refused(r)) {
        assert(entry, "后端拒绝非法类型", true);
      } else {
        // 意外成功 → 登记清理防污染（无论严格还是宽松模式）
        const id = extractRecordId(r.json);
        if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: "neg-type 意外成功" });
        if (lenientCoercion) {
          entry.status = "warn";
          entry.reason = `后端宽恕了 ${numericField.name} 的类型（隐式转换），记 warn（--lenient-coercion）`;
          assert(entry, "类型校验（宽松）", true, "后端隐式转换");
        } else {
          assert(entry, "后端拒绝非法类型", false, `传入字符串仍成功（用 --lenient-coercion 容忍隐式转换）`);
        }
      }
    });
  }

  if (opByKey.create && maxLengthField) {
    S("negative", `负例：超长越界（${maxLengthField.name}）`, () => (ctx.createFailed ? "新增正例失败，负例无判别力" : null), async (entry) => {
      const limit = maxLengthField.constraints?.maxLength || maxLengthField.constraints?.length || maxLengthField.maxLength;
      const payload = buildPayload({ [maxLengthField.name]: "X".repeat(Number(limit) + 10) }, `${runId}_NEGL`);
      const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: payload });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      assert(entry, "后端拒绝超长输入", refused(r), `超过 maxLength=${limit} 仍返回成功（校验缺口）`);
      if (isSuccess(r)) {
        const id = extractRecordId(r.json);
        if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: "neg-length 意外成功" });
      }
    });
  }

  // S09 重复提交（幂等性）
  if (opByKey.create) {
    S("duplicate", "重复提交（拒绝或幂等）", () => (ctx.createFailed ? "新增正例失败" : null), async (entry) => {
      const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: ctx.payload });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      if (refused(r)) {
        assert(entry, "重复提交被拒绝", true);
      } else {
        const dupId = extractRecordId(r.json);
        if (dupId && dupId === ctx.createdId) {
          assert(entry, "幂等返回同一主键", true);
        } else {
          assert(entry, "重复提交未产生脏数据", false, `重复 create 返回新主键 ${dupId}（业务键重复未拦截，数据污染风险）`);
          if (dupId) cleanupRegistry.push({ id: dupId, label: "duplicate 意外成功" });
        }
      }
    });
  }

  // S10-S13 权限（读默认 / 写探针可选）
  if (noPermToken) {
    const permProbe = (op, useId) =>
      S("permission", `权限拒绝（${op.key}）`, null, async (entry) => {
        const path = useId && ctx.createdId ? replaceId(op.externalPath, ctx.createdId) : op.externalPath;
        const r = await http(path, {
          method: op.method || "GET",
          body: (op.method || "GET") === "GET" || op.method === "DELETE" ? undefined : ctx.payload ?? { current: 1, size: 10 },
          useToken: noPermToken,
        });
        entry.httpStatus = r.status;
        entry.responseCode = r.json?.code;
        entry.snapshot = JSON.stringify(r.snapshot);
        if (!guardTransport(entry, r)) return;
        assert(
          entry,
          "无权限账号被拒绝",
          r.status === 401 || r.status === 403 || refused(r),
          `无权限 token 仍成功（HTTP=${r.status} code=${r.json?.code}）— 权限未拦截`,
        );
        // 写探针意外成功 → 登记 cleanup 防污染
        if ((op.key === "create" || op.key === "remove") && isSuccess(r)) {
          const id = op.key === "create" ? extractRecordId(r.json) : ctx.createdId;
          if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: `perm-${op.key} 意外成功` });
        }
      });
    if (opByKey.page) permProbe(opByKey.page, false);
    if (opByKey.detail && ctx.createdId) permProbe(opByKey.detail, true);
    if (permWriteProbe) {
      if (opByKey.create) permProbe(opByKey.create, false);
      if (opByKey.remove && ctx.createdId) permProbe(opByKey.remove, true);
    }
  }

  // S14 分页边界（鲁棒性探针）
  if (opByKey.page) {
    S("pagination", "分页边界（size 超 max / current=0）", () => (ctx.pageFailed ? "列表查询失败" : null), async (entry) => {
      const over = await http(opByKey.page.externalPath, {
        method: opByKey.page.method || "POST",
        body: { current: 1, size: maxSize + 100000 },
      });
      entry.snapshot = JSON.stringify(over.snapshot);
      if (over.status === 0) {
        entry.status = "error";
        entry.reason = `网络错误: ${over.error || "无响应"}`;
        return;
      }
      assert(entry, "size 超限无 5xx", over.status < 500, `HTTP=${over.status}`);
      if (isSuccess(over)) {
        assert(entry, "超限响应 total 仍为数值", extractTotal(over.json) !== null, "total 缺失");
      }
      const zero = await http(opByKey.page.externalPath, {
        method: opByKey.page.method || "POST",
        body: { current: 0, size: 10 },
      });
      entry.httpStatus = zero.status;
      entry.responseCode = zero.json?.code;
      if (zero.status === 0) {
        entry.status = "error";
        entry.reason = `网络错误: ${zero.error || "无响应"}`;
        return;
      }
      assert(entry, "current=0 无 5xx", zero.status < 500, `HTTP=${zero.status}`);
    });
  }

  // S15 清理（零污染）
  if (opByKey.remove) {
    S("remove", "清理（精确主键删除）", () => (cleanupRegistry.length === 0 ? "无待清理记录" : null), async (entry) => {
      const failedIds = [];
      for (const { id } of cleanupRegistry) {
        const r = await http(replaceId(opByKey.remove.externalPath, id), { method: opByKey.remove.method || "DELETE" });
        if (!isSuccess(r)) failedIds.push(id);
        entry.httpStatus = r.status;
        entry.snapshot = JSON.stringify(r.snapshot);
      }
      assert(entry, "全部登记记录删除成功", failedIds.length === 0, `失败主键: ${failedIds.join(", ") || "-"}`);
    });
  }

  // S16 清理复核（零污染验证）
  if (opByKey.page && opByKey.remove) {
    S("verify-gone", "清理后复查（零污染）", () => (cleanupRegistry.length === 0 ? "无登记记录" : null), async (entry) => {
      const { records } = await queryRecords();
      const remain = cleanupRegistry.filter(({ id }) => records.some((rec) => JSON.stringify(rec).includes(String(id))));
      assert(entry, "清理后列表无残留", remain.length === 0, `残留主键: ${remain.map((r) => r.id).join(", ") || "-"}`);
    });
  }

  // ══ 执行 ═══════════════════════════════════
  for (const step of steps) {
    await runStep(step);
  }

  // ── 汇总（兼容旧字段 + 新维度）─────────────
  const passed = results.filter((r) => r.status === "pass" || r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const errors = results.filter((r) => r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const executed = results.filter((r) => r.status !== "skip").length;
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;

  const negatives = results.filter((r) => r.kind === "negative");
  const permissions = results.filter((r) => r.kind === "permission");
  const totalAssertions = results.reduce((n, r) => n + (r.assertions?.length || 0), 0);
  const failedAssertions = results.reduce((n, r) => n + (r.assertions?.filter((a) => !a.pass).length || 0), 0);

  return {
    summary: {
      entity: summary.entity || summary.pageName,
      // 旧字段（quality-gate / report-generator 兼容）
      total: results.length,
      passed,
      failed,
      errors,
      skipped,
      passRate,
      decision: passRate >= 95 && failed === 0 && errors === 0 ? "通过（可转测）" : passRate >= 80 ? "部分通过（需修复）" : "不通过（阻断转测）",
      cleanup: {
        created: cleanupRegistry.length,
        cleaned: cleanupRegistry.length > 0 && results.find((r) => r.kind === "remove")?.status === "pass" ? cleanupRegistry.length : 0,
        verified: results.find((r) => r.kind === "verify-gone")?.status === "pass",
      },
      // 新维度
      warned,
      assertions: { total: totalAssertions, failed: failedAssertions },
      negatives: { total: negatives.length, passed: negatives.filter((r) => r.status === "pass").length, failed: negatives.filter((r) => r.status === "fail").length },
      permissions: { total: permissions.length, passed: permissions.filter((r) => r.status === "pass").length, failed: permissions.filter((r) => r.status === "fail").length, skipped: noPermToken ? 0 : 1 },
      drift,
      businessKey: runId,
    },
    results,
  };
}

/**
 * 生成冒烟测试报告（Markdown，含负例/权限/漂移/清理复核章节）
 */
export function generateSmokeReport(execResult, title = "接口测试执行报告") {
  const s = execResult.summary;
  const lines = [
    `# ${title}`,
    ``,
    `## 执行概览`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 实体 | ${s.entity} |`,
    `| 执行步骤 | ${s.total}（断言 ${s.assertions.total} 条，失败 ${s.assertions.failed} 条） |`,
    `| 通过 / 失败 / 错误 / 跳过 / 警告 | ${s.passed} / ${s.failed} / ${s.errors} / ${s.skipped} / ${s.warned ?? 0} |`,
    `| 通过率 | ${s.passRate}% |`,
    `| 业务键 | ${s.businessKey} |`,
    `| 结论 | ${s.decision} |`,
    ``,
  ];

  if (s.negatives) {
    lines.push(`## 负例执行`, ``, `| 类别 | 数量 | 通过 | 失败 |`, `|------|------|------|------|`);
    lines.push(`| 必填缺失/类型错误/超长 | ${s.negatives.total} | ${s.negatives.passed} | ${s.negatives.failed} |`, ``);
  }

  if (s.permissions) {
    lines.push(
      `## 权限验证`,
      ``,
      `| 数量 | 通过 | 失败 | 说明 |`,
      `|------|------|------|------|`,
      `| ${s.permissions.total} | ${s.permissions.passed} | ${s.permissions.failed} | ${s.permissions.skipped > 0 ? "未提供 --token-no-perm，已跳过" : "双账号验证"} |`,
      ``,
    );
  }

  if (s.drift && (s.drift.missing.length > 0 || s.drift.extra.length > 0 || s.drift.typeMismatch.length > 0)) {
    lines.push(`## 契约漂移检测`, ``, `| 类别 | 字段 | 说明 |`, `|------|------|------|`);
    for (const d of s.drift.missing) lines.push(`| 契约声明但缺失 | ${d.field} | ${d.detail} |`);
    for (const d of s.drift.extra) lines.push(`| 响应未声明 | ${d.field} | ${d.detail} |`);
    for (const d of s.drift.typeMismatch) lines.push(`| 类型不符 | ${d.field} | 契约 ${d.declared} / 实际 ${d.actual} |`);
    lines.push(``);
  }

  if (s.cleanup) {
    lines.push(
      `## 零污染清理`,
      ``,
      `- 登记 ${s.cleanup.created} 条写入，清理 ${s.cleanup.cleaned} 条，复查${s.cleanup.verified ? "✅ 无残留" : "⚠️ 未验证/有残留"}`,
      ``,
    );
  }

  lines.push(`## 步骤详情`, ``, `| 步骤 | 名称 | 类别 | HTTP | 结果 | 原因 |`, `|------|------|------|------|------|------|`);
  for (const r of execResult.results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : r.status === "error" ? "⚠️" : r.status === "warn" ? "🟡" : "⏭️";
    lines.push(`| ${r.id} | ${r.name} | ${r.kind} | ${r.httpStatus ?? "-"} | ${icon} ${r.status} | ${r.reason ?? ""} |`);
  }
  lines.push(``);

  return lines.join("\n");
}
