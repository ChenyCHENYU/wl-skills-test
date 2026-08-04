/**
 * api-executor.js — API 接口测试执行器
 *
 * 从契约生成的用例矩阵，实际发起 HTTP 请求验证接口可用性。
 * 零依赖（Node 内置 fetch / http）。
 *
 * 用法:
 *   const { runApiTests } = require("./api-executor.js");
 *   const results = await runApiTests({
 *     baseUrl: "http://localhost:8080",
 *     contractPath: "./wl-contract.json",
 *     token: "Bearer xxx"
 *   });
 */

import { consumeContract, generateTestCaseMatrix } from "./contract-consumer.js";

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

  for (const tc of apiCases) {
    const testResult = {
      id: tc.id,
      name: tc.name,
      method: tc.method,
      path: tc.path,
      status: "pending",
    };

    try {
      // 权限拒绝测试跳过实际请求
      if (tc.name.includes("权限拒绝")) {
        testResult.status = "skipped";
        testResult.reason = "权限测试需无权限 token，跳过";
        results.push(testResult);
        continue;
      }

      const url = tc.path.startsWith("http") ? tc.path : `${baseUrl}${tc.path}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const fetchOptions = {
        method: tc.method || "GET",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (token) {
        fetchOptions.headers["Authorization"] = token;
      }

      // POST/PUT 带请求体
      if (tc.method === "POST" || tc.method === "PUT") {
        if (tc.name.includes("queryPage") || tc.name.includes("page")) {
          fetchOptions.body = JSON.stringify({ current: 1, size: 10 });
        } else {
          fetchOptions.body = JSON.stringify({});
        }
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timer);

      testResult.httpStatus = response.status;

      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        testResult.responseCode = body.code;

        // jh4j-cloud 成功码 2000
        if (body.code === 2000 || body.code === 0 || body.code === 200) {
          testResult.status = "pass";
          passed++;
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

  const passRate = apiCases.length > 0 ? Math.round((passed / apiCases.length) * 100) : 0;

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
