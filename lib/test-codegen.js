/**
 * test-codegen.js — 测试用例生成引擎
 * 从契约摘要或需求文档生成标准化测试用例
 */

import { readFileSync } from "node:fs";
import { generateTestCaseMatrix } from "./contract-consumer.js";

/**
 * 从契约文件生成测试用例
 * @param {string} contractPath
 * @param {object} options — { type, outputDir }
 */
export function generateFromContract(contractPath, options = {}) {
  const { consumeContract } = require("./contract-consumer.js");
  const result = consumeContract(contractPath);
  const cases = generateTestCaseMatrix(result.summary);

  return {
    source: contractPath,
    contractType: result.type,
    caseCount: cases.length,
    cases,
    summary: {
      entity: result.summary.entity || result.summary.pageName,
      module: result.summary.module,
      permissionTests: cases.filter((c) => c.type === "permission").length,
      boundaryTests: cases.filter((c) => c.type === "boundary").length,
      apiTests: cases.filter((c) => c.type === "api").length,
    },
  };
}

/**
 * 生成冒烟测试套件（从全量用例中筛选 P0/P1 主干用例）
 * @param {Array} cases — 全量用例
 * @param {object} options — { complexity: 'simple'|'medium'|'complex' }
 */
export function generateSmokeSuite(cases, options = {}) {
  const limits = {
    simple: 8,
    medium: 15,
    complex: 25,
  };
  const limit = limits[options.complexity] || limits.medium;

  // 纳入规则：仅 P0 和 P1 的 api 类型
  const smoke = cases.filter(
    (c) =>
      (c.priority === "P0" || c.priority === "P1") &&
      c.type === "api" &&
      c.name.includes("正常路径"),
  );

  return {
    total: cases.length,
    smokeCount: Math.min(smoke.length, limit),
    passRate: smoke.length > 0 ? Math.round((Math.min(smoke.length, limit) / smoke.length) * 100) : 0,
    cases: smoke.slice(0, limit),
    complexity: options.complexity || "medium",
  };
}

/**
 * DI 缺陷指数质量评估
 * @param {Array} defects — [{severity: 'fatal'|'critical'|'general'|'minor'}, ...]
 * @param {number} caseCount — 总用例数
 */
export function calculateDI(defects, caseCount) {
  const weights = { fatal: 10, critical: 3, general: 1, minor: 0.1 };
  const counts = { fatal: 0, critical: 0, general: 0, minor: 0 };

  for (const d of defects) {
    const sev = d.severity || "minor";
    if (counts[sev] !== undefined) counts[sev]++;
  }

  const di = counts.fatal * 10 + counts.critical * 3 + counts.general * 1 + counts.minor * 0.1;
  const diDensity = caseCount > 0 ? di / caseCount : di;

  // 上线判定 4 指标
  const releaseChecks = {
    diDensity: { value: diDensity, threshold: 0.3, pass: diDensity < 0.3 },
    criticalClosed: {
      value: defects.filter((d) => d.severity === "critical" && d.status === "closed").length,
      required: counts.critical,
      pass: defects.filter((d) => d.severity === "critical" && d.status !== "closed").length === 0,
    },
    fatalClosed: {
      value: defects.filter((d) => d.severity === "fatal" && d.status === "closed").length,
      required: counts.fatal,
      pass: defects.filter((d) => d.severity === "fatal" && d.status !== "closed").length === 0,
    },
  };

  const allPass =
    releaseChecks.diDensity.pass &&
    releaseChecks.criticalClosed.pass &&
    releaseChecks.fatalClosed.pass;

  const level = diDensity < 0.1 ? "green" : diDensity < 0.3 ? "yellow" : "red";

  return {
    di: Math.round(di * 10) / 10,
    diDensity: Math.round(diDensity * 1000) / 1000,
    counts,
    level,
    releaseChecks,
    releaseDecision: allPass ? "pass" : "blocked",
  };
}

/**
 * 导出用例为 Markdown 表格
 */
export function exportCasesMarkdown(cases, title = "测试用例") {
  const lines = [`# ${title}`, "", `共 ${cases.length} 条用例`, ""];
  lines.push("| 序号 | 名称 | 模块 | 类型 | 优先级 | 方法 | 路径 | 描述 |");
  lines.push("|------|------|------|------|--------|------|------|------|");
  for (const c of cases) {
    lines.push(
      `| ${c.id} | ${c.name} | ${c.module} | ${c.type} | ${c.priority} | ${c.method} | ${c.path} | ${c.description} |`,
    );
  }
  return lines.join("\n");
}
