/**
 * api-executor.js — API 接口测试执行器
 *
 * 从契约生成的用例矩阵，实际发起 HTTP 请求验证接口可用性。
 * 零依赖（Node 内置 fetch）。
 *
 * 成熟模式（对齐 wl-ui-produce e2e 实战经验）：
 * - detail/remove 等需要 {id} 的用例，先调 queryPage 获取真实业务主键再替换
 * - create/update 用例按契约必填字段 + 类型自动构造合法 payload（而非空对象）
 * - 新增成功后记录主键，结束时尝试清理，保证零污染
 */

import { consumeContract, generateTestCaseMatrix } from "./contract-consumer.js";
import { buildCreatePayload as factoryPayload } from "./test-data-factory.js";

// 从 queryPage 响应中提取第一条记录的真实 id
function extractRecordId(body) {
  if (body?.data == null) return null;
  const data = body.data;
  if (typeof data === "string" || typeof data === "number") return String(data);
  for (const key of ["id", "Id", "ID", "pkId", "uuid"]) {
    if (data[key] !== undefined && data[key] !== null) return String(data[key]);
  }
  return null;
}

/**
 * 执行 API 接口测试
 * @param {object} options — { baseUrl, contractPath, token, timeout }
 * @returns {Promise<object>} 执行结果
 */
export async function runApiTests(options = {}) {
  const { baseUrl = "http://localhost:8080", contractPath, token, timeout = 10000 } = options;

  if (!contractPath) {
    return { error: "需要 contractPath 参数" };
  }

  const result = consumeContract(contractPath);
  const summary = result.summary;
  const cases = generateTestCaseMatrix(summary);

  // 只执行 API 类型用例（非权限矩阵、非边界校验）
  const apiCases = cases.filter((c) => c.type === "api");

  const results = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;

  // 共享状态：queryPage 拿到的真实主键（detail/remove 复用），create 产生的主键（清理用）
  let cachedRecordId = null;
  const createdRecordIds = [];
  const successCode = summary.transport?.successCode || 2000;

  const doFetch = async (url, fetchOptions) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...fetchOptions, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const buildHeaders = () => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = token.startsWith("Bearer") || token.startsWith("bearer") ? token : `Bearer ${token}`;
    return headers;
  };

  // 从 queryPage 响应中提取第一条记录的真实 id
  const fetchRecordId = async (tc) => {
    if (cachedRecordId) return cachedRecordId;
    const pageOp = (summary.operations || []).find((o) => o.key === "page");
    if (!pageOp) return null;
    try {
      const url = `${baseUrl}${pageOp.externalPath}`;
      const res = await doFetch(url, {
        method: pageOp.method || "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ current: 1, size: 1 }),
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      const records = body?.data?.records || body?.records || [];
      if (Array.isArray(records) && records.length > 0) {
        const rec = records[0];
        for (const key of ["id", "Id", "ID", "pkId", "uuid"]) {
          if (rec[key] !== undefined && rec[key] !== null) {
            cachedRecordId = String(rec[key]);
            return cachedRecordId;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  // 按契约必填字段构造合法 create/update payload（数据工厂：类型/枚举/约束/字段名语义）
  const buildCreatePayload = () => {
    const fields = Array.isArray(summary.fields)
      ? summary.fields
      : summary.fields?.createRequest || [];
    return factoryPayload(fields, { runId: `AT_${Date.now() % 100000}` });
  };

  for (const tc of apiCases) {
    const testResult = {
      id: tc.id,
      name: tc.name,
      method: tc.method,
      path: tc.path,
      status: "pending",
    };

    try {
      // 权限拒绝测试跳过实际请求（需要无权限 token）
      if (tc.type === "permission" || tc.name.includes("权限拒绝")) {
        testResult.status = "skipped";
        testResult.reason = "权限测试需无权限 token，跳过";
        results.push(testResult);
        continue;
      }

      // 路径含 {id} 占位符时，先查真实主键再替换（否则必然 404）
      let requestPath = tc.path || "";
      if (requestPath.includes("{id}")) {
        const realId = await fetchRecordId(tc);
        if (!realId) {
          testResult.status = "error";
          testResult.reason = "无法获取真实业务主键（queryPage 无数据或失败），无法执行 {id} 用例";
          errors++;
          results.push(testResult);
          continue;
        }
        requestPath = requestPath.replace("{id}", encodeURIComponent(realId));
      }

      const url = requestPath.startsWith("http") ? requestPath : `${baseUrl}${requestPath}`;

      const fetchOptions = {
        method: tc.method || "GET",
        headers: buildHeaders(),
      };

      // POST/PUT 带请求体：分页用分页参数，写操作用契约必填字段构造合法 payload
      if (tc.method === "POST" || tc.method === "PUT") {
        if (tc.opKey === "page" || /queryPage/.test(requestPath)) {
          fetchOptions.body = JSON.stringify({ current: 1, size: 10 });
        } else {
          fetchOptions.body = JSON.stringify(buildCreatePayload());
        }
      }

      const response = await doFetch(url, fetchOptions);

      testResult.httpStatus = response.status;

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        testResult.responseCode = body.code;

        // jh4j-cloud 成功码 2000（兼容 0/200）
        if (body.code === successCode || body.code === 0 || body.code === 200) {
          testResult.status = "pass";
          passed++;
          // 记录 create 产生的主键用于清理；同时缓存给 detail/remove 复用
          const rid = extractRecordId(body);
          if (rid) cachedRecordId = rid;
          if (/\/save|\/create/.test(requestPath) && rid) {
            createdRecordIds.push({ id: rid, path: requestPath });
          }
        } else {
          testResult.status = "fail";
          testResult.reason = `业务码 ${body.code}: ${body.message || ""}`;
          failed++;
        }
      } else {
        testResult.status = "fail";
        testResult.reason = `HTTP ${response.status}`;
        failed++;
      }
    } catch (e) {
      testResult.status = "error";
      testResult.reason = e.name === "AbortError" ? `超时 (${timeout}ms)` : e.message;
      errors++;
    }

    results.push(testResult);
  }

  // 零污染：清理本轮流产生的测试数据（尽力而为，不阻塞结果）
  const removeOp = (summary.operations || []).find((o) => o.key === "remove");
  let cleaned = 0;
  if (removeOp && createdRecordIds.length > 0) {
    for (const { id } of createdRecordIds) {
      try {
        const delPath = (removeOp.externalPath || "").replace("{id}", encodeURIComponent(id));
        await doFetch(`${baseUrl}${delPath}`, { method: removeOp.method || "DELETE", headers: buildHeaders() });
        cleaned++;
      } catch {
        // 清理失败记录在报告里
      }
    }
  }

  const executed = results.filter((r) => r.status !== "skipped").length;
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;

  return {
    summary: {
      entity: summary.entity || summary.pageName,
      total: apiCases.length,
      passed,
      failed,
      errors,
      skipped: results.filter((r) => r.status === "skipped").length,
      passRate,
      decision: passRate >= 95 ? "通过（可转测）" : passRate >= 80 ? "部分通过（需修复）" : "不通过（阻断转测）",
      cleanup: { created: createdRecordIds.length, cleaned },
    },
    results,
  };
}

/**
 * 生成冒烟测试报告（Markdown）
 */
export function generateSmokeReport(execResult, title = "冒烟测试执行报告") {
  const s = execResult.summary;
  const lines = [
    `# ${title}`,
    ``,
    `## 执行概览`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 实体 | ${s.entity} |`,
    `| 总用例 | ${s.total} |`,
    `| 通过 | ${s.passed} |`,
    `| 失败 | ${s.failed} |`,
    `| 错误 | ${s.errors} |`,
    `| 跳过 | ${s.skipped} |`,
    `| 通过率 | ${s.passRate}% |`,
    `| 结论 | ${s.decision} |`,
    ``,
    `## 详情`,
    ``,
    `| 序号 | 用例名 | 方法 | 路径 | HTTP状态 | 结果 | 原因 |`,
    `|------|--------|------|------|---------|------|------|`,
  ];

  for (const r of execResult.results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : r.status === "error" ? "⚠️" : "⏭️";
    lines.push(`| ${r.id} | ${r.name} | ${r.method} | ${r.path} | ${r.httpStatus || "-"} | ${icon} ${r.status} | ${r.reason || ""} |`);
  }

  return lines.join("\n");
}
