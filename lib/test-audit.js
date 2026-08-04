/**
 * test-audit.js — 测试代码审计引擎
 *
 * 确定性规则扫描器（对标 kit R1-R16 / bd B1-B29 / ui R001-R039）
 * 审计对象：Playwright 脚本、JMeter jmx、测试用例文档
 *
 * 规则 T1-T12：
 *   T1  Playwright 脚本缺少 beforeEach（测试数据泄漏风险）
 *   T2  Playwright 脚本含硬编码 URL/token（安全违规，对应 standard 11）
 *   T3  Playwright 脚本缺少断言（只操作不验证）
 *   T4  Playwright 测试名不规范（不以 should/can/test 开头）
 *   T5  Playwright 缺少数据清理（无 afterEach/afterAll）
 *   T6  JMeter 脚本缺少聚合报告（无 ResultCollector/SummaryReport）
 *   T7  JMeter 脚本含 ConfigTestElement+TestPlanGui 致命组合
 *   T8  JMeter SteppingThreadGroup 属性名用了驼峰（必须小写空格）
 *   T9  JMeter 脚本缺少 JSON 断言（不验证响应码）
 *   T10 测试用例文档缺少 P0 用例（无最高优先级覆盖）
 *   T11 测试用例缺少断言列（步骤有但预期结果为空）
 *   T12 Playwright 脚本含 waitForTimeout 硬等待（应用 waitForSelector/Response）
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SEVERITY = { fatal: "fatal", error: "error", warning: "warning", info: "info" };

// ── 规则定义 ──────────────────────────────────
export const RULES = [
  { id: "T1", severity: SEVERITY.warning, desc: "Playwright 缺少 beforeEach（测试数据隔离风险）", target: "playwright" },
  { id: "T2", severity: SEVERITY.error, desc: "Playwright 含硬编码 URL/token（安全违规）", target: "playwright" },
  { id: "T3", severity: SEVERITY.error, desc: "Playwright 缺少断言（只操作不验证）", target: "playwright" },
  { id: "T4", severity: SEVERITY.warning, desc: "Playwright 测试名不规范", target: "playwright" },
  { id: "T5", severity: SEVERITY.warning, desc: "Playwright 缺少数据清理（无 afterEach）", target: "playwright" },
  { id: "T6", severity: SEVERITY.warning, desc: "JMeter 缺少聚合报告", target: "jmeter" },
  { id: "T7", severity: SEVERITY.fatal, desc: "JMeter ConfigTestElement+TestPlanGui 致命组合", target: "jmeter" },
  { id: "T8", severity: SEVERITY.fatal, desc: "JMeter SteppingThreadGroup 驼峰属性名", target: "jmeter" },
  { id: "T9", severity: SEVERITY.warning, desc: "JMeter 缺少 JSON 响应码断言", target: "jmeter" },
  { id: "T10", severity: SEVERITY.error, desc: "测试用例缺少 P0 优先级覆盖", target: "cases" },
  { id: "T11", severity: SEVERITY.warning, desc: "测试用例缺少预期结果（断言）", target: "cases" },
  { id: "T12", severity: SEVERITY.warning, desc: "Playwright 含 waitForTimeout 硬等待", target: "playwright" },
  // JMeter 全 11 条 XML 强制规则（T13-T18 补齐剩余 6 条）
  { id: "T13", severity: SEVERITY.fatal, desc: "JMeter 缺少 CSV 数据源（无参数化）", target: "jmeter" },
  { id: "T14", severity: SEVERITY.fatal, desc: "JMeter ThreadGroup 缺少 LoopController（只跑一次）", target: "jmeter" },
  { id: "T15", severity: SEVERITY.fatal, desc: "JMeter 缺少 HTTP Header（Content-Type）", target: "jmeter" },
  { id: "T16", severity: SEVERITY.warning, desc: "JMeter 缺少响应时间 SLA 断言", target: "jmeter" },
  { id: "T17", severity: SEVERITY.warning, desc: "JMeter PerfMon 监控器配置异常", target: "jmeter" },
  { id: "T18", severity: SEVERITY.warning, desc: "JMeter 缺少线程组 ramp_time（瞬间并发）", target: "jmeter" },
  // 用例覆盖率
  { id: "T19", severity: SEVERITY.error, desc: "用例数量低于标准（每功能点 < 10 条）", target: "cases" },
  { id: "T20", severity: SEVERITY.warning, desc: "用例缺少异常场景覆盖", target: "cases" },
];

// ── 审计入口 ──────────────────────────────────
export function audit(target, options = {}) {
  if (!existsSync(target)) {
    return { error: `路径不存在: ${target}` };
  }

  const stat = statSync(target);
  const findings = [];

  if (stat.isDirectory()) {
    auditDir(target, findings, options);
  } else {
    auditFile(target, findings, options);
  }

  return summarize(findings);
}

function auditDir(dir, findings, options) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      auditDir(full, findings, options);
    } else {
      auditFile(full, findings, options);
    }
  }
}

function auditFile(filePath, findings, options) {
  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, "utf-8");

  if (ext === ".js" || ext === ".ts") {
    if (content.includes("playwright") || content.includes("@playwright/test") || content.includes("import { test")) {
      auditPlaywright(filePath, content, findings);
    }
  } else if (ext === ".jmx" || content.includes("<jmeterTestPlan")) {
    auditJmeter(filePath, content, findings);
  } else if (ext === ".md" && (content.includes("测试用例") || content.includes("TC-") || content.includes("| 序号 |"))) {
    auditCases(filePath, content, findings);
  }
}

// ── Playwright 审计 ────────────────────────────
function auditPlaywright(filePath, content, findings) {
  const lines = content.split("\n");

  // T1: 缺少 beforeEach
  if (!content.includes("beforeEach") && !content.includes("beforeAll")) {
    findings.push({ rule: "T1", file: filePath, severity: SEVERITY.warning, message: "缺少 beforeEach/beforeAll，测试数据可能泄漏" });
  }

  // T2: 硬编码 URL/token
  const urlPattern = /https?:\/\/(?!localhost|127\.0\.0\.1|\$\{|process\.env|BASE_URL)[^\s"'\)]+/g;
  const urlMatches = content.match(urlPattern);
  if (urlMatches) {
    findings.push({ rule: "T2", file: filePath, severity: SEVERITY.error, message: `硬编码 URL: ${urlMatches.slice(0, 3).join(", ")}` });
  }
  if (content.match(/token.*['"].{20,}['"]/i) && !content.includes("process.env") && !content.includes("${")) {
    findings.push({ rule: "T2", file: filePath, severity: SEVERITY.error, message: "硬编码 token（应使用环境变量）" });
  }

  // T3: 缺少断言
  const testBlocks = content.match(/test\s*\(/g) || [];
  const expectCalls = content.match(/expect\s*\(/g) || [];
  if (testBlocks.length > 0 && expectCalls.length < testBlocks.length) {
    findings.push({ rule: "T3", file: filePath, severity: SEVERITY.error, message: `${testBlocks.length} 个 test 但仅 ${expectCalls.length} 个 expect 断言` });
  }

  // T4: 测试名不规范
  const testNames = content.matchAll(/test\s*\(\s*["'`]([^"'`]+)["'`]/g);
  for (const m of testNames) {
    const name = m[1];
    if (!/^(should|can|test|验证|检查|列表页|新增|编辑|删除|查询|操作|权限|查询列表)/.test(name)) {
      findings.push({ rule: "T4", file: filePath, severity: SEVERITY.warning, message: `测试名"${name}"不规范（建议 should_xxx / 验证_xxx）` });
    }
  }

  // T5: 缺少清理
  if (!content.includes("afterEach") && !content.includes("afterAll")) {
    findings.push({ rule: "T5", file: filePath, severity: SEVERITY.warning, message: "缺少 afterEach/afterAll 数据清理" });
  }

  // T12: 硬等待
  const waitMatches = content.match(/waitForTimeout\s*\(/g);
  if (waitMatches) {
    findings.push({ rule: "T12", file: filePath, severity: SEVERITY.warning, message: `使用 waitForTimeout 硬等待 ${waitMatches.length} 次（应用 waitForSelector/waitForResponse）` });
  }
}

// ── JMeter 审计 ────────────────────────────────
function auditJmeter(filePath, content, findings) {
  // T6: 缺少聚合报告
  if (!content.includes("ResultCollector") && !content.includes("SummaryReport")) {
    findings.push({ rule: "T6", file: filePath, severity: SEVERITY.warning, message: "缺少聚合报告/查看结果树" });
  }

  // T7: ConfigTestElement 致命组合
  if (content.includes("ConfigTestElement") && content.includes('guiclass="TestPlanGui"')) {
    findings.push({ rule: "T7", file: filePath, severity: SEVERITY.fatal, message: "ConfigTestElement 与 TestPlanGui 混用，JMeter 会加载失败" });
  }

  // T8: SteppingThreadGroup 驼峰
  const steppingMatch = content.match(/<SteppingThreadGroup[\s\S]*?>/);
  if (steppingMatch) {
    const block = steppingMatch[0];
    if (/[a-z][a-z]+[A-Z]/.test(block) && !block.includes("'Thread Group'")) {
      findings.push({ rule: "T8", file: filePath, severity: SEVERITY.fatal, message: "SteppingThreadGroup 属性名用了驼峰（必须小写空格）" });
    }
  }

  // T9: 缺少 JSON 断言
  if (!content.includes("JSONPathAssertion") && !content.includes("ResponseAssertion")) {
    findings.push({ rule: "T9", file: filePath, severity: SEVERITY.warning, message: "缺少响应断言（不验证响应码/内容）" });
  }

  // T13: 缺少 CSV 数据源
  if (!content.includes("CSVDataSet") && !content.includes("CSV")) {
    findings.push({ rule: "T13", file: filePath, severity: SEVERITY.fatal, message: "缺少 CSV 数据源（无参数化，并发会重复用同一数据）" });
  }

  // T14: ThreadGroup 缺少 LoopController
  if (content.includes("<ThreadGroup") && !content.includes("LoopController") && !content.includes("loops")) {
    findings.push({ rule: "T14", file: filePath, severity: SEVERITY.fatal, message: "ThreadGroup 缺少 LoopController（每个线程只跑一次）" });
  }

  // T15: 缺少 HTTP Header
  if (!content.includes("HeaderManager") && !content.includes("Content-Type")) {
    findings.push({ rule: "T15", file: filePath, severity: SEVERITY.fatal, message: "缺少 HTTP HeaderManager（POST 请求需 Content-Type: application/json）" });
  }

  // T16: 缺少响应时间 SLA 断言
  if (!content.includes("Assertion.response_time") && !content.includes("response_time")) {
    findings.push({ rule: "T16", file: filePath, severity: SEVERITY.warning, message: "缺少响应时间 SLA 断言（建议 P99 < 500ms）" });
  }

  // T17: PerfMon 配置
  if (content.includes("PerfMonCollector") || content.includes("PerfMon")) {
    if (!content.includes("4444") && !content.includes("tcp-port")) {
      findings.push({ rule: "T17", file: filePath, severity: SEVERITY.warning, message: "PerfMon 监控器缺少端口配置（默认 4444）" });
    }
  }

  // T18: 缺少 ramp_time
  const rampMatch = content.match(/ramp_time["\s>]*(\d+)/);
  if (!rampMatch) {
    findings.push({ rule: "T18", file: filePath, severity: SEVERITY.warning, message: "缺少 ramp_time（瞬间并发冲击服务）" });
  }
}

// ── 测试用例文档审计 ────────────────────────────
function auditCases(filePath, content, findings) {
  // T10: 缺少 P0
  if (!content.includes("P0") && !content.includes("P1")) {
    findings.push({ rule: "T10", file: filePath, severity: SEVERITY.error, message: "缺少 P0/P1 高优先级用例" });
  }

  // T11: 缺少预期结果
  const rows = content.match(/\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|/g) || [];
  let emptyExpect = 0;
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    // 预期结果通常在最后几列
    if (cells.length >= 5 && cells[cells.length - 1] === "" || cells[cells.length - 2] === "") {
      emptyExpect++;
    }
  }
  if (emptyExpect > rows.length * 0.3) {
    findings.push({ rule: "T11", file: filePath, severity: SEVERITY.warning, message: `${emptyExpect}/${rows.length} 行预期结果为空` });
  }

  // T19: 用例数量不足（每功能点 < 10 条）
  const tcCount = (content.match(/TC-\d+/g) || []).length;
  if (tcCount > 0 && tcCount < 10) {
    findings.push({ rule: "T19", file: filePath, severity: SEVERITY.error, message: `仅 ${tcCount} 条用例，标准要求每功能点 ≥ 10 条` });
  }

  // T20: 缺少异常场景
  const hasException = content.includes("异常") || content.includes("失败") || content.includes("错误") || content.includes("拒绝") || content.includes("非法") || content.includes("无效");
  const tcCount2 = (content.match(/TC-\d+/g) || []).length;
  if (!hasException && tcCount2 >= 3) {
    findings.push({ rule: "T20", file: filePath, severity: SEVERITY.warning, message: "缺少异常场景用例（边界/非法输入/权限拒绝）" });
  }
}

// ── 汇总 ──────────────────────────────────────
function summarize(findings) {
  const bySeverity = { fatal: 0, error: 0, warning: 0, info: 0 };
  const byRule = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  }

  return {
    total: findings.length,
    bySeverity,
    byRule,
    findings,
    pass: bySeverity.fatal === 0 && bySeverity.error === 0,
    level: bySeverity.fatal > 0 ? "red" : bySeverity.error > 0 ? "yellow" : bySeverity.warning > 0 ? "yellow" : "green",
  };
}

// ── 自动修复（对标 kit safe-fix / ui fix）──────
export function autoFix(filePath, options = {}) {
  if (!existsSync(filePath)) return { error: "文件不存在" };

  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, "utf-8");
  const fixes = [];
  let result = content;

  if (ext === ".js" || ext === ".ts") {
    // F1: ::v-deep → :deep()（同 kit F2）
    if (result.includes("::v-deep")) {
      result = result.replace(/::v-deep\s+([^{]+)/g, ":deep($1)");
      fixes.push({ rule: "F1", desc: "::v-deep → :deep()" });
    }

    // F2: 补齐 beforeEach（如果缺失）
    if (!result.includes("beforeEach") && (result.includes("test.describe(") || result.includes("test("))) {
      if (result.includes("test.describe(")) {
        result = result.replace(
          /(test\.describe\([^)]+\)\s*=>\s*{)/,
          `$1\n  test.beforeEach(async ({ page }) => {\n    // TODO: 补充测试前置（登录/导航/数据准备）\n  });\n`,
        );
      } else {
        // 无 describe，在第一个 test 之前插入
        result = `test.beforeEach(async ({ page }) => {\n  // TODO: 补充测试前置（登录/导航/数据准备）\n});\n\n` + result;
      }
      fixes.push({ rule: "F2", desc: "补齐 beforeEach 模板" });
    }

    // F3: waitForTimeout → waitForSelector
    if (result.includes("waitForTimeout")) {
      result = result.replace(/waitForTimeout\(\s*(\d+)\s*\)/g, 'waitForSelector("table", { state: "visible" }) /* 替换自 waitForTimeout($1) */');
      fixes.push({ rule: "F3", desc: "waitForTimeout → waitForSelector（需人工确认选择器）" });
    }

    // F4: 硬编码 URL 替换为环境变量
    const hardcodedUrl = result.match(/https?:\/\/(?!localhost|127\.0\.0\.1|\$\{|process\.env|BASE_URL)[^\s"'\)]+/g);
    if (hardcodedUrl) {
      for (const url of [...new Set(hardcodedUrl)]) {
        result = result.split(url).join('${BASE_URL}');
      }
      // 如果还没有 BASE_URL 定义，在文件头加一行
      if (!result.includes("BASE_URL")) {
        result = `const BASE_URL = process.env.BASE_URL || "http://localhost:8080";\n` + result;
      }
      fixes.push({ rule: "F4", desc: `硬编码 URL 替换为 BASE_URL 环境变量 (${hardcodedUrl.length} 处)` });
    }

    // F5: 补齐 afterEach 清理
    if (!result.includes("afterEach") && !result.includes("afterAll") && result.includes("test(")) {
      const afterBlock = `\ntest.afterEach(async ({ page }) => {\n  // TODO: 清理测试数据\n  await page.context().clearCookies();\n});\n`;
      if (result.includes("test.describe(")) {
        result = result.replace(/(test\.describe\([^)]+\)\s*=>\s*{)/, `$1${afterBlock}`);
      } else {
        result = afterBlock + result;
      }
      fixes.push({ rule: "F5", desc: "补齐 afterEach 数据清理模板" });
    }

    // F6: 规范化测试名（给无前缀的 test 加 should 前缀）
    const badNames = result.matchAll(/test\s*\(\s*["'`]([^"'`]+)["'`]/g);
    let nameFixed = 0;
    for (const m of badNames) {
      const oldName = m[1];
      if (!/^(should|can|test|验证|检查|列表页|新增|编辑|删除|查询|操作|权限)/.test(oldName) && oldName.length < 30) {
        const newName = `should ${oldName}`;
        result = result.split(`"${oldName}"`).join(`"${newName}"`).split(`'${oldName}'`).join(`'${newName}'`);
        nameFixed++;
      }
    }
    if (nameFixed > 0) {
      fixes.push({ rule: "F6", desc: `规范化测试名（加 should 前缀，${nameFixed} 个）` });
    }
  }

  return {
    content: result,
    fixes,
    changed: fixes.length > 0,
  };
}
