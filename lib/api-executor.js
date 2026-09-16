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
import { declaredJsType, isNumericField } from "./shared/types.js";
import { normalizeAuthHeader, escapeMdCell } from "./shared/utils.js";
import { SMOKE_PASS_RATE } from "./shared/thresholds.js";
import { loginForToken } from "./auth.js";
import { validateContractFile } from "./contract-validate.js";

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

// declaredJsType 统一取自 lib/shared/types.js（生成/执行同一分类口径）
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
    // 认证适配（v0.16.0）：{ loginPath, username, password, successCode } —— 无 token 自动登录，
    // 401/token 过期自动重登重试一次（由 wl-test.config.json 的 auth 段或显式参数提供）
    auth = null,
    // 严格成功码（v0.22.0）：true 时只认契约 transport.successCode——
    // 默认宽松兼容多后端生态（0/200/缺省信封均视为成功），严格模式用于 jh4j 单一体系统一口径
    strictCode = false,
    // 总时长保护（v0.23.0）：超限后未执行步骤标 skip 并收尾，保证 CI 不挂死（慢环境/大契约兜底）
    maxDurationMs = 10 * 60 * 1000,
  } = options;

  // 数值参数下限夹紧（非法输入不产生"全超时"之类的怪诊断，而是可解释的行为）
  const requestTimeout = Math.max(1000, Number(timeout) || 10000);
  const durationBudget = Math.max(30_000, Number(maxDurationMs) || 10 * 60 * 1000);

  if (!contractPath) return { error: "需要 contractPath 参数" };

  // 契约前置校验（error 级直接拒跑——契约写错不该跑到一半才炸且被误诊为服务问题）
  const validation = validateContractFile(contractPath);
  if (!validation.valid) {
    return {
      error: `契约校验未通过（${validation.findings.filter((f) => f.severity === "error").length} 项错误）:\n${validation.findings.filter((f) => f.severity === "error").map((f) => `  - ${f.message}`).join("\n")}`,
    };
  }

  const result = consumeContract(contractPath);
  const summary = result.summary;
  const opByKey = Object.fromEntries((summary.operations || []).map((o) => [o.key, o]));
  const createFields = normalizeCreateFields(summary);
  const successCode = summary.transport?.successCode ?? 2000;
  const maxSize = summary.transport?.maxSize ?? 200;

  // 字典注入（枚举字段真实合法值；统一 BOM 剥离 + 结构错误 fail-fast）
  let dict = null;
  if (dictFile) {
    try {
      dict = JSON.parse(readFileSync(dictFile, "utf-8").replace(/^\uFEFF/, ""));
    } catch {
      return { error: `字典文件解析失败: ${dictFile}` };
    }
    if (!dict || typeof dict !== "object") {
      return { error: `字典文件结构无效（应为 {字典码: [合法值]}）: ${dictFile}` };
    }
  }

  const businessKey = `AT_${Date.now().toString(36).toUpperCase()}`;
  const runId = businessKey;

  // ── 认证适配：无 token 自动登录；401 自动重登重试一次 ──
  let activeToken = token;
  let authNotice = null;
  const relogin = async () => {
    const t = await loginForToken({ baseUrl, successCode, ...(auth || {}) });
    if (typeof t !== "string") {
      authNotice = t.error;
      return null;
    }
    activeToken = t;
    return t;
  };
  if (!activeToken && auth && auth.username && auth.password) {
    const t = await relogin();
    if (t === null && authNotice) {
      return { error: `自动登录失败: ${authNotice}` };
    }
  }

  // ── HTTP 封装（超时 + 快照 + 401 重登重试）─────────
  const httpRaw = async (path, { method = "GET", body, useToken, extraHeaders = {} } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    const effectiveToken = useToken !== undefined ? useToken : activeToken;
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (effectiveToken) {
      headers["Authorization"] = normalizeAuthHeader(effectiveToken);
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
        error: e.name === "AbortError" ? `超时 (${requestTimeout}ms)` : e.message,
        snapshot: { url, method, requestBody: body !== undefined ? truncateStr(body) : undefined, error: e.message },
      };
    } finally {
      clearTimeout(timer);
    }
  };
  // 主账号请求遇 401/过期 → 重登一次后重试（useToken 为无权限探针时不重登）
  const http = async (path, opts = {}) => {
    const r = await httpRaw(path, opts);
    if (
      opts.useToken === undefined &&
      auth &&
      auth.username &&
      auth.password &&
      !opts.__authRetried &&
      (r.status === 401 || r.json?.code === 401)
    ) {
      const t = await relogin();
      if (t) return httpRaw(path, { ...opts, __authRetried: true });
    }
    return r;
  };

  const isSuccess = (r) =>
    strictCode
      ? r.ok && r.json?.code === successCode
      : r.ok && (r.json?.code === successCode || r.json?.code === 0 || r.json?.code === 200 || r.json?.code === undefined);

  // 软失败检出（v0.25.0）：业务码报成功但 message 提示异常/失败——吞异常后端最典型的假成功。
  // 关键词保守（正常成功提示如"操作成功/ok"不会命中），命中即 fail 并给出专属诊断。
  const SOFT_FAIL_HINT = /(异常|失败|错误|不存在|已存在|重复提交|超时|禁止|拒绝|无效|非法|回滚)/;
  const softFailed = (r) => isSuccess(r) && SOFT_FAIL_HINT.test(String(r.json?.message ?? ""));
  const assertNoSoftFailure = (entry, r, opLabel) => {
    if (softFailed(r)) {
      assert(
        entry,
        `${opLabel} 无异常提示（软失败检出）`,
        false,
        `code=${r.json?.code} 报成功但 message="${r.json?.message}"——业务码与实际结果矛盾（吞异常/半成功），不得按通过处理`,
      );
      return false;
    }
    return true;
  };
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

  // 幂等读重试（抖动退避）：一次网络抖动不再让冒烟/详情/分页步骤 error 并级联 skip 大半链路。
  // 只重试传输层错误（status=0），业务失败/HTTP 4xx/5xx 原样返回。
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const httpRetry = async (path, opts = {}) => {
    let r = await http(path, opts);
    for (let attempt = 1; attempt <= 2 && r.status === 0; attempt++) {
      await sleep(300 * attempt + Math.floor(Math.random() * 200));
      r = await http(path, opts);
    }
    return r;
  };

  // ── 断言收集器 ─────────────────────────────
  const results = [];
  const drift = { missing: [], extra: [], typeMismatch: [] };
  const cleanupRegistry = []; // {id, label}

  // 失败诊断映射：按步骤类别 + 失败内容给出「下一步动作」（报告/摘要/MCP 均带出）
  function diagnose(kind, reason, entry) {
    if (/软失败/.test(reason ?? "")) {
      return "业务码报成功但 message 提示异常（吞异常/半成功）：转后端定位——该请求大概率未真正生效，确认事务是否回滚、异常是否被 catch 后继续返回成功码";
    }
    if (entry?.httpStatus === 401 || /401|token|认证/i.test(reason)) {
      return "认证失败：检查 --token 是否过期，或在 wl-test.config.json 配置 auth 段（账号密码自动登录/自动重登）";
    }
    if (entry?.httpStatus >= 500 || /网络错误|超时|ECONNREFUSED|无响应/.test(reason)) {
      return "服务不可用/网络问题：先确认目标环境健康（base-url 是否正确、服务是否发布），再重跑；与本代码变更无关";
    }
    switch (kind) {
      case "smoke":
        return "最基础的列表查询都不通：先人工打开页面/调一次接口确认服务状态，再检查契约的 externalPath 与 successCode 是否写对";
      case "create":
      case "update":
        return "写操作失败：查看 snapshot 里的响应报文——若为业务校验拒绝，核对 payload 字段（可用 --dict-file 提供合法枚举值）；若为系统错误，转后端排查";
      case "readback":
        return "写后读回不一致（数据正确性问题）：对比断言中不一致的字段，确认是写入丢失还是查询投影缺字段——涉及事务/一致性，转后端定位";
      case "negative":
        return "负例未被拒绝 = 后端校验缺口：按失败步骤中的字段名，找后端补对应校验（必填/类型/长度/枚举），这是被测系统的缺陷而不是测试问题";
      case "duplicate":
        return "重复提交产生了脏数据：后端缺少业务键唯一约束或幂等控制，转后端加唯一索引/幂等键；本测试已登记清理，无残留";
      case "duplicate-concurrent":
        return "并发窗口重复落库：后端唯一约束缺失（顺序重复被拦截不代表并发安全），必须加数据库唯一索引而非仅应用层校验；本测试已登记清理";
      case "permission":
        return "无权限 token 仍能访问 = 越权风险：检查后端权限拦截配置（注解/网关规则）是否覆盖该接口，转后端修复";
      case "pagination":
        return "分页边界处理不当（current=0 / 超大 size）：后端应钳制或拒绝非法分页参数而非 5xx";
      case "detail":
      case "remove":
        return "主键操作失败：确认新增步骤是否成功返回真实业务主键（create 步骤的 snapshot），以及 detail/remove 的路径参数替换是否正确";
      case "verify-gone":
        return "清理后仍有残留 = 零污染被破坏：检查 remove 是否真正删除（软删除？），残留主键见失败详情";
      default:
        return null;
    }
  }

  async function runStep(step) {
    const entry = {
      id: step.id,
      name: step.name,
      kind: step.kind,
      status: "pass",
      assertions: [],
      durationMs: 0,
      ...(step.dimension ? { dimension: step.dimension } : {}),
    };
    const gate = step.gate ? step.gate() : null;
    if (gate) {
      entry.status = "skip";
      entry.reason = `前置失败: ${gate}`;
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
    // 失败诊断指引：让开发/测试拿到结果就知道下一步找谁、做什么（v0.16.0）
    if (entry.status === "fail" || entry.status === "error") {
      entry.hint = diagnose(step.kind, entry.reason ?? "", entry);
    }
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
      const fieldMap = dict.__fieldMap__ && typeof dict.__fieldMap__ === "object" ? dict.__fieldMap__ : null;
      for (const key of Object.keys(payload)) {
        const field = createFields.find((f) => f.name === key);
        // 字段级映射优先（dict-sync --map 写入 __fieldMap__），其次字段名直配，再退契约枚举码
        const mappedCode = fieldMap?.[key];
        const dv = (mappedCode && dict[mappedCode]) || dict[key] || (field?.enum ? dict[field.enum] : undefined);
        if (Array.isArray(dv) && dv.length > 0) payload[key] = dv[0];
      }
    }
    return { ...payload, ...mutate };
  };

  const replaceId = (path, id) => path.replace(/\{id\}/g, encodeURIComponent(id));
  const queryRecords = async (extra = {}) => {
    const r = await httpRetry(opByKey.page.externalPath, {
      method: opByKey.page.method || "POST",
      body: { current: 1, size: 100, ...extra },
    });
    return { r, records: isSuccess(r) ? extractRecords(r.json) : [] };
  };

  // 精确主键匹配：优先显式主键字段全等比较，兜底任意字段值全等（不做子串匹配，
  // 防 id=123 命中含 "1234" 记录的假通过）
  const ID_KEYS = ["id", "Id", "ID", "pkId", "uuid", "pk", "guid"];
  const matchesId = (rec, target) => {
    if (!rec || typeof rec !== "object") return false;
    for (const key of ID_KEYS) {
      if (rec[key] !== null && rec[key] !== undefined && String(rec[key]) === target) return true;
    }
    return Object.values(rec).some((v) => v !== null && v !== undefined && typeof v !== "object" && String(v) === target);
  };
  const findRecordById = (records, id) => records.find((rec) => matchesId(rec, String(id))) || null;

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
  // parallel=true 的连续步骤在执行期并发执行（有界并发），报告仍按定义顺序输出。
  // dimension 与细粒度用例（case-fine-gen）的 dimension 字符串一致——summary.dimensionCoverage
  // 提供"声明 ↔ 实际执行"的追溯闭环。
  const steps = [];
  let seq = 0;
  const S = (kind, name, gate, execute, { parallel = false, dimension = null } = {}) =>
    steps.push({ id: `S${String(++seq).padStart(2, "0")}`, kind, name, gate, execute, parallel, dimension });

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
        assertNoSoftFailure(entry, r, "新增");
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

  // S04 更新（差异化字段值 + 读回验证）
  if (opByKey.update) {
    S("update", "更新（含主键）", () => (!ctx.createdId ? "无可用主键（新增失败或缺失）" : null), async (entry) => {
      // 用不同 runId 构造差异化 payload（业务键字段保持原值——真实系统业务键更新时不可变，
      // 字典/枚举字段保持合法值），读回验证非业务键字段确实生效——
      // 此前回放 create payload，"改没改成一样"测不出（更新链路假覆盖）
      const updated = buildPayload(undefined, `${runId}_UPD`);
      const isBusinessKey = (k) => /(^|_)(id|no|code|key)$/.test(k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
      for (const k of Object.keys(updated)) {
        if (isBusinessKey(k) && ctx.payload?.[k] !== undefined) updated[k] = ctx.payload[k];
      }
      ctx.updatedPayload = { ...updated, id: ctx.createdId };
      ctx.updatedDiffFields = Object.keys(updated).filter((k) => String(updated[k]) !== String(ctx.payload?.[k] ?? ""));
      const r = await http(opByKey.update.externalPath, {
        method: opByKey.update.method || "PUT",
        body: ctx.updatedPayload,
      });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      assert(entry, "成功信封", isSuccess(r), r.error || `HTTP=${r.status} code=${r.json?.code}`);
      assertNoSoftFailure(entry, r, "更新");
      if (!isSuccess(r)) ctx.updateFailed = true;
    }, { dimension: "op-update" });
  }

  // S05 详情（若发生过更新，读回验证差异化字段确实生效）
  if (opByKey.detail) {
    S("detail", "详情（真实主键 + 更新生效校验）", () => (!ctx.createdId ? "无可用主键（新增失败或缺失）" : null), async (entry) => {
      const r = await httpRetry(replaceId(opByKey.detail.externalPath, ctx.createdId), { method: opByKey.detail.method || "GET" });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      assert(entry, "成功信封", isSuccess(r), r.error || `HTTP=${r.status} code=${r.json?.code}`);
      const rec = r.json?.data && typeof r.json.data === "object" && !Array.isArray(r.json.data) ? r.json.data : null;
      // detail 响应同样参与契约漂移检测（详情投影常与列表投影不同，覆盖面翻倍）
      if (isSuccess(r) && rec) collectDrift(rec);
      if (isSuccess(r) && rec && ctx.updatedPayload && !ctx.updateFailed) {
        let compared = 0;
        for (const k of ctx.updatedDiffFields ?? []) {
          if (k === "id" || !(k in rec) || rec[k] === null || rec[k] === undefined) continue;
          const want = ctx.updatedPayload[k];
          const same = typeof want === "number" ? Number(rec[k]) === want : String(rec[k]).trim() === String(want).trim();
          assert(entry, `更新生效回读一致: ${k}`, same, `更新为 ${JSON.stringify(want)} → 读回 ${JSON.stringify(rec[k])}（疑似更新未落库/被忽略）`);
          compared++;
        }
        if ((ctx.updatedDiffFields ?? []).length > 0) {
          assert(entry, "至少比对一个更新字段", compared > 0, "差异化字段均未出现在详情响应中");
        }
      }
    });
  }

  // S05b 不存在主键探针（op-notfound）：确定性不存在的主键，断言"业务拒绝或空数据 + 非 5xx"
  // ——细粒度用例早已声明（此前 autoExec:false 人工执行，实则执行器数据齐备）
  const notFoundKey = `NOT_EXIST_${runId}`;
  if (opByKey.detail) {
    S("notfound", `不存在主键（detail ${notFoundKey}）`, null, async (entry) => {
      const r = await httpRetry(replaceId(opByKey.detail.externalPath, notFoundKey), { method: opByKey.detail.method || "GET" });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      const emptyData = r.json?.data === null || r.json?.data === undefined || (Array.isArray(r.json?.data) && r.json.data.length === 0);
      assert(
        entry,
        "不存在主键返回业务拒绝/空数据且非 5xx",
        r.status < 500 && (refused(r) || emptyData),
        `HTTP=${r.status} code=${r.json?.code}（对确定性不存在的主键返回了数据或 5xx）`,
      );
    }, { dimension: "op-notfound" });
  }
  if (opByKey.update) {
    S("notfound", `不存在主键（update ${notFoundKey}）`, null, async (entry) => {
      const body = { ...(ctx.payload ?? {}), id: notFoundKey };
      const r = await http(opByKey.update.externalPath, { method: opByKey.update.method || "PUT", body });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      assert(entry, "更新不存在主键被拒绝且非 5xx", r.status < 500 && refused(r), `HTTP=${r.status} code=${r.json?.code}（更新不存在主键仍返回成功——可能误写脏数据）`);
    }, { dimension: "op-notfound" });
  }
  if (opByKey.remove) {
    S("notfound", `不存在主键（remove ${notFoundKey}）`, null, async (entry) => {
      const r = await http(replaceId(opByKey.remove.externalPath, notFoundKey), { method: opByKey.remove.method || "DELETE" });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      assert(entry, "删除不存在主键拒绝或幂等且非 5xx", r.status < 500, `HTTP=${r.status}（对不存在主键的删除返回 5xx）`);
    }, { dimension: "op-notfound" });
  }

  // S06-S08 负例：必填缺失 / 类型错误 / 超长越界
  // 每类覆盖全部符合条件字段（上限 8，防超大契约拖垮运行时）——
  // 与细粒度用例的 autoExec 声明一致（此前每类只采样第一个字段，声明与执行不符）
  const NEG_FIELD_CAP = 8;
  const requiredFields = createFields.filter((f) => f.required || f.requiredOnCreate).slice(0, NEG_FIELD_CAP);
  const numericFields = createFields.filter((f) => isNumericField(f)).slice(0, NEG_FIELD_CAP);
  const maxLengthFields = createFields.filter((f) => f.constraints?.maxLength || f.constraints?.length || f.maxLength).slice(0, NEG_FIELD_CAP);

  for (const requiredField of requiredFields) {
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
    }, { parallel: true, dimension: "field-required" });
  }

  for (const numericField of numericFields) {
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
    }, { parallel: true, dimension: "field-type" });
  }

  for (const maxLengthField of maxLengthFields) {
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
    }, { parallel: true, dimension: "field-length" });
  }

  // S08b 数值边界负例（field-numeric-boundary）：契约 constraints.min/max 驱动——
  // 越界值(min-1/max+1)必须被拒绝；边界值意外成功则登记清理。此前该维度留人工，实则数据齐备
  if (opByKey.create) {
    const boundedFields = createFields
      .filter((f) => {
        const min = f.constraints?.min ?? f.constraints?.minimum;
        const max = f.constraints?.max ?? f.constraints?.maximum;
        return isNumericField(f) && (min !== undefined || max !== undefined);
      })
      .slice(0, 4);
    for (const bField of boundedFields) {
      const min = bField.constraints?.min ?? bField.constraints?.minimum;
      const max = bField.constraints?.max ?? bField.constraints?.maximum;
      for (const [label, value] of [
        ...(min !== undefined ? [[`下界-1（${min - 1}）`, min - 1]] : []),
        ...(max !== undefined ? [[`上界+1（${max + 1}）`, max + 1]] : []),
      ]) {
        S("negative", `负例：数值越界（${bField.name} ${label}）`, () => (ctx.createFailed ? "新增正例失败，负例无判别力" : null), async (entry) => {
          const payload = buildPayload({ [bField.name]: value }, `${runId}_NEGB${value < 0 ? "L" : "H"}`);
          const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: payload });
          entry.httpStatus = r.status;
          entry.responseCode = r.json?.code;
          entry.snapshot = JSON.stringify(r.snapshot);
          if (!guardTransport(entry, r)) return;
          assert(entry, "后端拒绝数值越界", refused(r), `${bField.name}=${value}（越出 [${min ?? "-"}, ${max ?? "-"}]）仍成功——范围校验缺口`);
          if (isSuccess(r)) {
            const id = extractRecordId(r.json);
            if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: "neg-boundary 意外成功" });
          }
        }, { parallel: true, dimension: "field-numeric-boundary" });
      }
    }
  }

  // S08c 非法枚举负例：字典注入了合法值的字段 → 传确定性非法值，后端必须拒绝
  // （此前 field-enum 只在细粒度用例里人工执行——dictFile 已有合法值，自动执行零成本）
  if (opByKey.create && dict) {
    const dictBackedFields = createFields
      .filter((f) => {
        const fieldMap = dict.__fieldMap__ && typeof dict.__fieldMap__ === "object" ? dict.__fieldMap__ : null;
        const mappedCode = fieldMap?.[f.name];
        const values = (mappedCode && dict[mappedCode]) || dict[f.name] || (f.enum ? dict[f.enum] : undefined);
        return Array.isArray(values) && values.length > 0;
      })
      .slice(0, 4);
    for (const enumField of dictBackedFields) {
      S("negative", `负例：非法枚举值（${enumField.name}）`, () => (ctx.createFailed ? "新增正例失败，负例无判别力" : null), async (entry) => {
        const payload = buildPayload({ [enumField.name]: "__WL_INVALID_ENUM__" }, `${runId}_NEGE`);
        const r = await http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: payload });
        entry.httpStatus = r.status;
        entry.responseCode = r.json?.code;
        entry.snapshot = JSON.stringify(r.snapshot);
        if (!guardTransport(entry, r)) return;
        assert(entry, "后端拒绝非法枚举值", refused(r), `${enumField.name} 传 __WL_INVALID_ENUM__ 仍成功（枚举校验缺口）`);
        if (isSuccess(r)) {
          const id = extractRecordId(r.json);
          if (id && id !== ctx.createdId) cleanupRegistry.push({ id, label: "neg-enum 意外成功" });
        }
      }, { parallel: true, dimension: "field-enum" });
    }
  }

  // S09 重复提交（幂等性，顺序）
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
    }, { parallel: true, dimension: "op-duplicate" });
  }

  // S09b 重复提交-并发（唯一约束/race 探针）：同业务键 5 并发，
  // 顺序 duplicate 测不出并发窗口的重复落库——本步骤直接暴露唯一约束缺失
  if (opByKey.create) {
    S("duplicate-concurrent", "重复提交-并发（同业务键 ×5）", () => (ctx.createFailed ? "新增正例失败" : null), async (entry) => {
      const rs = await Promise.all(
        Array.from({ length: 5 }, () => http(opByKey.create.externalPath, { method: opByKey.create.method || "POST", body: ctx.payload })),
      );
      const transportFail = rs.find((r) => r.status === 0);
      if (transportFail) {
        entry.status = "error";
        entry.reason = `网络错误: ${transportFail.error || "无响应"}`;
        return;
      }
      const newIds = rs.filter(isSuccess).map((r) => extractRecordId(r.json)).filter((id) => id && id !== ctx.createdId);
      const distinct = [...new Set(newIds)];
      const idempotentSame = rs.filter(isSuccess).every((r) => {
        const id = extractRecordId(r.json);
        return id === ctx.createdId;
      });
      assert(
        entry,
        "并发同键至多一条新记录或幂等同键",
        distinct.length === 0 || idempotentSame,
        `并发提交同业务键产生 ${distinct.length} 个重复主键（${distinct.slice(0, 3).join(", ")}）— 唯一约束/幂等缺失，race 窗口数据污染风险`,
      );
      for (const id of distinct) cleanupRegistry.push({ id, label: "dup-concurrent 意外成功" });
    }, { parallel: true, dimension: "op-duplicate-concurrent" });
  }

  // S10-S13 权限（读默认 / 写探针可选）
  // 注意：步骤在执行前同步构建，依赖运行期状态的判断必须放在 gate 闭包里，
  // 否则 ctx.createdId 构建期恒为 null，探针永不注册（权限覆盖虚报）
  if (noPermToken) {
    const permProbe = (op, useId) =>
      S(
        "permission",
        `权限拒绝（${op.key}）`,
        useId ? () => (!ctx.createdId ? "无可用主键（新增失败或缺失）" : null) : null,
        async (entry) => {
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
        },
        { parallel: true, dimension: "op-permission" },
      );
    if (opByKey.page) permProbe(opByKey.page, false);
    if (opByKey.detail) permProbe(opByKey.detail, true);
    if (permWriteProbe) {
      if (opByKey.create) permProbe(opByKey.create, false);
      if (opByKey.remove) permProbe(opByKey.remove, true);
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
    }, { dimension: "op-pagination" });
  }

  // S14b 组合查询收敛探针（op-query-combine）：显式声明 ≥2 个查询字段才执行（page-spec 的 query
  // 或 gen-contract 导入的 models.queryRequest），现有无声明契约自动跳过。
  // 用本次创建的记录验证查询条件真实生效：按字段A查 → 必命中；A+改值的字段B查 → 必不命中
  // （后者若命中 = 查询条件被后端忽略，列表过滤失真——典型的"查询没生效"缺陷）
  const querySource =
    (summary.queryFields || []).filter((q) => q.name).length >= 2
      ? (summary.queryFields || []).filter((q) => q.name)
      : (summary.fields?.queryRequest || []).map((f) => ({ name: f.name }));
  const qFields = querySource.slice(0, 2);
  if (opByKey.page && opByKey.create && qFields.length === 2) {
    S("query-combine", `组合查询收敛（${qFields[0].name} + ${qFields[1].name}）`, () => {
      if (ctx.createFailed) return "新增失败，无锚定记录";
      if (!ctx.payload) return "无 create payload";
      const [qa0, qb0] = qFields;
      if (ctx.payload[qa0.name] === undefined || ctx.payload[qb0.name] === undefined) {
        return `create payload 未包含查询字段（${qa0.name}/${qb0.name}），无法锚定`;
      }
      return null;
    }, async (entry) => {
      const [qa, qb] = qFields;
      const aValue = ctx.payload[qa.name];
      const bValue = ctx.payload[qb.name];
      // 1. 仅按 A 查 → 本次主键应命中
      const ra = await queryRecords({ [qa.name]: aValue });
      if (!guardTransport(entry, ra.r)) return;
      const hitA = findRecordById(ra.records, ctx.createdId) !== null;
      assert(entry, `按 ${qa.name} 查询命中本次记录`, hitA, `查询值 ${JSON.stringify(aValue)} 未过滤出本次记录——条件可能未生效`);
      // 2. A + 与本次记录不同的 B 值 → 不应命中（B 条件必须收敛结果集）
      const rb = await queryRecords({ [qa.name]: aValue, [qb.name]: `${String(bValue)}_NO_MATCH_X` });
      if (!guardTransport(entry, rb.r)) return;
      const hitAB = findRecordById(rb.records, ctx.createdId) !== null;
      assert(
        entry,
        `${qb.name} 条件收敛结果集`,
        !hitAB,
        `B 值不匹配仍返回本次记录——${qb.name} 查询条件被后端忽略（列表过滤失真）`,
      );
    }, { dimension: "op-query-combine" });
  }

  // S15 清理（零污染）
  if (opByKey.remove) {
    S("remove", "清理（精确主键删除）", () => (cleanupRegistry.length === 0 ? "无待清理记录" : null), async (entry) => {
      const failedIds = [];
      const softFails = [];
      for (const { id } of cleanupRegistry) {
        const r = await http(replaceId(opByKey.remove.externalPath, id), { method: opByKey.remove.method || "DELETE" });
        if (!isSuccess(r)) failedIds.push(id);
        if (softFailed(r)) softFails.push(`${id}: ${r.json?.message}`);
        entry.httpStatus = r.status;
        entry.snapshot = JSON.stringify(r.snapshot);
      }
      assert(entry, "全部登记记录删除成功", failedIds.length === 0, `失败主键: ${failedIds.join(", ") || "-"}`);
      assert(entry, "删除无异常提示（软失败检出）", softFails.length === 0, `code 报成功但提示异常: ${softFails.slice(0, 3).join("; ")}`);
    });
  }

  // S15b 删除幂等探针（op-idempotent）：对已删除的本次主键重复 remove——
  // 细粒度用例已声明（此前人工），拒绝或幂等均可，核心是非 5xx 且不误删（误删由 verify-gone 兜底）
  if (opByKey.remove && opByKey.page) {
    S("idempotent", "删除后重复删除（幂等）", () => (ctx.createFailed ? "新增失败，无已删主键" : null), async (entry) => {
      const r = await http(replaceId(opByKey.remove.externalPath, ctx.createdId), { method: opByKey.remove.method || "DELETE" });
      entry.httpStatus = r.status;
      entry.responseCode = r.json?.code;
      entry.snapshot = JSON.stringify(r.snapshot);
      if (!guardTransport(entry, r)) return;
      const behavior = refused(r) ? "拒绝" : "幂等成功";
      entry.detail = `重复删除行为: ${behavior}`;
      assert(entry, "重复删除非 5xx（拒绝或幂等）", r.status < 500, `HTTP=${r.status}`);
    }, { dimension: "op-idempotent" });
  }

  // S16 清理复核（零污染验证）
  if (opByKey.page && opByKey.remove) {
    S("verify-gone", "清理后复查（零污染）", () => (cleanupRegistry.length === 0 ? "无登记记录" : null), async (entry) => {
      const { records } = await queryRecords();
      const remain = cleanupRegistry.filter(({ id }) => records.some((rec) => matchesId(rec, String(id))));
      assert(entry, "清理后列表无残留", remain.length === 0, `残留主键: ${remain.map((r) => r.id).join(", ") || "-"}`);
    });
  }

  // ══ 执行 ═══════════════════════════════════
  // 主干（冒烟→新增→读回→更新→详情）严格顺序；连续 parallel 标记的步骤
  // （负例×N + 重复提交 + 权限探针，均用独立业务键/只读探针，互不依赖）
  // 以有界并发执行（默认全并发，组内天然有界：≤3+1+操作数），报告仍按定义顺序输出。
  // 总时长保护：超 budget 后未执行步骤标 skip 收尾（CI 不挂死；skipped 拉低通过率 → 判定不通过，诚实呈现）
  const deadline = Date.now() + durationBudget;
  let durationExceeded = false;
  for (let i = 0; i < steps.length; ) {
    if (Date.now() > deadline) {
      durationExceeded = true;
    }
    if (durationExceeded) {
      for (let j = i; j < steps.length; j++) {
        results.push({
          id: steps[j].id,
          name: steps[j].name,
          kind: steps[j].kind,
          status: "skip",
          reason: `总时长超限（${Math.round(durationBudget / 1000)}s）——未执行步骤跳过，检查环境健康度或 --max-duration`,
          ...(steps[j].dimension ? { dimension: steps[j].dimension } : {}),
        });
      }
      break;
    }
    if (!steps[i].parallel) {
      results.push(await runStep(steps[i]));
      i++;
      continue;
    }
    let j = i;
    while (j < steps.length && steps[j].parallel) j++;
    const group = steps.slice(i, j);
    const entries = await Promise.all(group.map((s) => runStep(s)));
    results.push(...entries);
    i = j;
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

  // 零污染约束：有登记写入但清理步骤未成功执行（缺 remove 操作 / 清理失败）时不允许"通过"
  const cleanupDone = cleanupRegistry.length === 0 || results.some((r) => r.kind === "remove" && r.status === "pass");
  const decisionPass = passRate >= SMOKE_PASS_RATE && failed === 0 && errors === 0 && cleanupDone;

  // 维度覆盖（声明 ↔ 执行追溯）：细粒度用例标注 autoExec 的 dimension 在此可对照实际执行数与通过数
  const dimensionCoverage = {};
  for (const r of results) {
    if (!r.dimension || r.status === "skip") continue;
    const c = (dimensionCoverage[r.dimension] ??= { executed: 0, passed: 0 });
    c.executed++;
    if (r.status === "pass" || r.status === "warn") c.passed++;
  }

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
      // 布尔判定（CI 门禁消费，勿依赖中文文案判断）
      pass: decisionPass,
      decision: decisionPass ? "通过（可转测）" : passRate >= 80 ? "部分通过（需修复）" : "不通过（阻断转测）",
      cleanup: {
        created: cleanupRegistry.length,
        cleaned: cleanupRegistry.length > 0 && results.find((r) => r.kind === "remove")?.status === "pass" ? cleanupRegistry.length : 0,
        verified: results.find((r) => r.kind === "verify-gone")?.status === "pass",
        pending: !cleanupDone,
      },
      // 新维度
      warned,
      assertions: { total: totalAssertions, failed: failedAssertions },
      negatives: { total: negatives.length, passed: negatives.filter((r) => r.status === "pass").length, failed: negatives.filter((r) => r.status === "fail").length },
      permissions: { total: permissions.length, passed: permissions.filter((r) => r.status === "pass").length, failed: permissions.filter((r) => r.status === "fail").length, skipped: noPermToken ? 0 : 1 },
      drift,
      dimensionCoverage,
      businessKey: runId,
      auth: auth ? { mode: activeToken && !token ? "auto-login" : "token+relogin", notice: authNotice } : undefined,
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

  lines.push(`## 步骤详情`, ``, `| 步骤 | 名称 | 类别 | HTTP | 结果 | 原因 | 诊断指引 |`, `|------|------|------|------|------|------|------|`);
  for (const r of execResult.results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : r.status === "error" ? "⚠️" : r.status === "warn" ? "🟡" : "⏭️";
    lines.push(`| ${r.id} | ${escapeMdCell(r.name)} | ${r.kind} | ${r.httpStatus ?? "-"} | ${icon} ${r.status} | ${escapeMdCell(r.reason ?? "")} | ${escapeMdCell(r.hint ?? "")} |`);
  }
  lines.push(``);

  return lines.join("\n");
}
