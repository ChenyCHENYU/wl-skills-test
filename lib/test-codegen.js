/**
 * test-codegen.js — 测试用例生成引擎
 * 从契约摘要或需求文档生成标准化测试用例
 */

import { consumeContract, generateTestCaseMatrix } from "./contract-consumer.js";
import { DI_MAX_DENSITY, MODULE_CONVERGENCE_MAX_RATIO, MODULE_CONVERGENCE_ABS_EXEMPT, SMOKE_PASS_RATE } from "./shared/thresholds.js";
import { escapeMdCell } from "./shared/utils.js";

/**
 * 从契约文件生成测试用例
 * @param {string} contractPath
 * @param {object} options — { type, outputDir }
 */
export function generateFromContract(contractPath, options = {}) {
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
 * @param {Array} defects — [{severity: 'fatal'|'critical'|'general'|'minor', status, module}, ...]
 * @param {number} caseCount — 总用例数
 */
export function calculateDI(defects, caseCount) {
  const weights = { fatal: 10, critical: 3, general: 1, minor: 0.1 };
  const counts = { fatal: 0, critical: 0, general: 0, minor: 0 };
  const byModule = {};

  for (const d of defects) {
    const sev = d.severity || "minor";
    if (counts[sev] !== undefined) counts[sev]++;
    const mod = d.module || "_unknown";
    if (!byModule[mod]) byModule[mod] = { fatal: 0, critical: 0, general: 0, minor: 0, di: 0 };
    if (byModule[mod][sev] !== undefined) byModule[mod][sev]++;
  }

  const di = counts.fatal * weights.fatal + counts.critical * weights.critical + counts.general * weights.general + counts.minor * weights.minor;
  const diDensity = caseCount > 0 ? di / caseCount : di;

  for (const c of Object.values(byModule)) {
    c.di = c.fatal * weights.fatal + c.critical * weights.critical + c.general * weights.general + c.minor * weights.minor;
  }

  // 上线判定 4 指标
  const releaseChecks = {
    diDensity: { value: diDensity, threshold: DI_MAX_DENSITY, pass: diDensity < DI_MAX_DENSITY },
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
    moduleConvergence: {
      worstModule: worstDefectModule(byModule),
      pass: moduleConverged(byModule, di),
    },
  };

  const allPass =
    releaseChecks.diDensity.pass &&
    releaseChecks.criticalClosed.pass &&
    releaseChecks.fatalClosed.pass &&
    releaseChecks.moduleConvergence.pass;

  const level = diDensity < 0.1 ? "green" : diDensity < DI_MAX_DENSITY ? "yellow" : "red";

  return {
    di: Math.round(di * 10) / 10,
    diDensity: Math.round(diDensity * 1000) / 1000,
    counts,
    byModule,
    level,
    releaseChecks,
    releaseDecision: allPass ? "pass" : "blocked",
  };
}

// 最差模块 DI 收敛：单模块占总体 DI 比例 ≤ MODULE_CONVERGENCE_MAX_RATIO，
// 或其 DI 绝对值低于豁免线（小体量项目避免误伤）
function moduleConverged(byModule, totalDI) {
  if (Object.keys(byModule).length === 0 || totalDI === 0) return true;
  const maxModuleDI = Math.max(...Object.values(byModule).map((m) => m.di));
  return maxModuleDI / totalDI <= MODULE_CONVERGENCE_MAX_RATIO || maxModuleDI <= MODULE_CONVERGENCE_ABS_EXEMPT;
}

function worstDefectModule(byModule) {
  const entries = Object.entries(byModule);
  if (entries.length === 0) return null;
  const worst = entries.sort((a, b) => b[1].di - a[1].di)[0];
  return { module: worst[0], di: Math.round(worst[1].di * 10) / 10 };
}

// 冒烟通过率判定共享阈值
export function smokeRatePass(rate) {
  return rate >= SMOKE_PASS_RATE;
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
      `| ${escapeMdCell(c.id)} | ${escapeMdCell(c.name)} | ${escapeMdCell(c.module)} | ${escapeMdCell(c.type)} | ${escapeMdCell(c.priority)} | ${escapeMdCell(c.method)} | ${escapeMdCell(c.path)} | ${escapeMdCell(c.description)} |`,
    );
  }
  return lines.join("\n");
}
