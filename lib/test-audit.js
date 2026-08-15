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
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".tmp", ".cache"]);

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
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      auditDir(full, findings, options);
    } else {
      auditFile(full, findings, options);
    }
  }
}

// 二进制/资源扩展名直接跳过，避免 readFileSync 崩溃或误报
const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
  ".xlsx", ".xls", ".docx", ".doc", ".pdf", ".zip", ".gz", ".jar", ".war",
  ".ttf", ".woff", ".woff2", ".eot", ".mp4", ".mp3", ".csv", ".jtl",
  ".json", ".lock",
]);

function auditFile(filePath, findings, options) {
  const ext = extname(filePath).toLowerCase();
  if (SKIP_EXTS.has(ext)) return;

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    // 无权限/编码异常的文件跳过，不让整个审计崩溃
    return;
  }

  try {
    if (ext === ".js" || ext === ".ts" || ext === ".mjs" || ext === ".cjs") {
      // 只审计 *.spec.* / *.test.* 文件——防止把 playwright.config / 支撑模块误判为测试脚本
      const base = filePath.split(/[\\/]/).pop();
      if (/\.(spec|test)\.[cm]?[jt]s$/.test(base) && content.includes("playwright")) {
        auditPlaywright(filePath, content, findings);
      }
    } else if (ext === ".jmx" || content.includes("<jmeterTestPlan")) {
      auditJmeter(filePath, content, findings);
    } else if (ext === ".md" && (content.includes("测试用例") || content.includes("TC-") || content.includes("| 序号 |"))) {
      auditCases(filePath, content, findings);
    }
  } catch {
    // 单文件规则异常不阻断整体扫描
  }
}

// ── Playwright 审计 ────────────────────────────

/**
 * 块级解析 test() 调用（字符串/模板串/注释感知），返回 [{ name, hasExpect, start }]
 * 精确到 test 块：T3/T4 不再受文件级计数稀释（多 describe、字符串里出现 test( 等场景不误判/漏判）
 */
export function parseTestBlocks(content) {
  const blocks = [];
  const n = content.length;
  let i = 0;
  let state = "code"; // code | line | block | squote | dquote | template

  const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);

  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];

    if (state === "line") {
      if (ch === "\n") state = "code";
      i++;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") { state = "code"; i += 2; continue; }
      i++;
      continue;
    }
    if (state === "squote" || state === "dquote" || state === "template") {
      if (ch === "\\") { i += 2; continue; }
      if (
        (state === "squote" && ch === "'") ||
        (state === "dquote" && ch === '"') ||
        (state === "template" && ch === "`")
      ) {
        state = "code";
      }
      i++;
      continue;
    }

    // code 状态
    if (ch === "/" && next === "/") { state = "line"; i += 2; continue; }
    if (ch === "/" && next === "*") { state = "block"; i += 2; continue; }
    if (ch === "'") { state = "squote"; i++; continue; }
    if (ch === '"') { state = "dquote"; i++; continue; }
    if (ch === "`") { state = "template"; i++; continue; }

    // 识别 test / test.skip / test.only / test.fixme 调用（跳过 test.describe）
    if (isIdentStart(ch) && (i === 0 || !isIdentStart(content[i - 1]))) {
      const rest = content.slice(i);
      const m = rest.match(/^test(\.(skip|only|fixme|fail))?\s*\(/);
      if (m) {
        let j = i + m[0].length;
        // 解析第一个参数（测试名字符串）
        while (j < n && /\s/.test(content[j])) j++;
        let name = null;
        const q = content[j];
        if (q === "'" || q === '"' || q === "`") {
          let k = j + 1;
          let buf = "";
          while (k < n) {
            const c = content[k];
            if (c === "\\") { buf += content[k + 1] ?? ""; k += 2; continue; }
            if (c === q) break;
            buf += c;
            k++;
          }
          name = buf;
          j = k + 1;
        }
        // 括号配平扫描块体（字符串/注释感知），统计 expect( 调用
        let depth = 1;
        let k = j;
        let innerState = "code";
        let hasExpect = false;
        while (k < n && depth > 0) {
          const c = content[k];
          const nx = content[k + 1];
          if (innerState === "line") { if (c === "\n") innerState = "code"; k++; continue; }
          if (innerState === "block") { if (c === "*" && nx === "/") { innerState = "code"; k += 2; continue; } k++; continue; }
          if (innerState === "squote" || innerState === "dquote" || innerState === "template") {
            if (c === "\\") { k += 2; continue; }
            if ((innerState === "squote" && c === "'") || (innerState === "dquote" && c === '"') || (innerState === "template" && c === "`")) innerState = "code";
            k++;
            continue;
          }
          if (c === "/" && nx === "/") { innerState = "line"; k += 2; continue; }
          if (c === "/" && nx === "*") { innerState = "block"; k += 2; continue; }
          if (c === "'" ) { innerState = "squote"; k++; continue; }
          if (c === '"') { innerState = "dquote"; k++; continue; }
          if (c === "`") { innerState = "template"; k++; continue; }
          if (c === "(") {
            depth++;
            // expect( / expect.soft( / expect.poll( 计为断言（任意嵌套深度）
            const before = content.slice(Math.max(0, k - 20), k);
            if (/(^|[^A-Za-z_$])expect(\.(soft|poll|wrap))?\s*$/.test(before)) {
              hasExpect = true;
            }
          }
          if (c === ")") depth--;
          k++;
        }
        blocks.push({ name, hasExpect, start: i });
        i = k;
        continue;
      }
    }
    i++;
  }
  return blocks;
}

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

  // T3: 缺少断言（块级精确解析：每个 test 块必须至少一个 expect，字符串/注释里的不计数）
  const blocks = parseTestBlocks(content);
  const noExpectBlocks = blocks.filter((b) => !b.hasExpect);
  if (noExpectBlocks.length > 0) {
    findings.push({
      rule: "T3",
      file: filePath,
      severity: SEVERITY.error,
      message: `${noExpectBlocks.length}/${blocks.length} 个 test 块缺少 expect 断言${noExpectBlocks[0].name ? `（首个: "${noExpectBlocks[0].name}"）` : ""}`,
    });
  }

  // T4: 测试名不规范（块级解析，不再误判字符串中的 test( 字样）
  for (const b of blocks) {
    if (b.name === null) continue;
    if (!/^(should|can|test|验证|检查|列表页|新增|编辑|删除|查询|操作|权限|查询列表|恢复|按指定)/.test(b.name)) {
      findings.push({ rule: "T4", file: filePath, severity: SEVERITY.warning, message: `测试名"${b.name}"不规范（建议 should_xxx / 验证_xxx）` });
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
/**
 * 检查 SteppingThreadGroup 属性名是否为驼峰（必须用小写空格格式）。
 * 只检查属性名（name="..." 的值），不检查 XML 标签名本身（标签名 SteppingThreadGroup 天然含大写）。
 */
export function checkSteppingThreadGroup(content) {
  const blockMatch = content.match(/<SteppingThreadGroup[\s\S]*?(?:<\/SteppingThreadGroup>|\/>)/);
  if (!blockMatch) return false;
  const block = blockMatch[0];
  // 插件正确属性名白名单（小写空格格式）
  const knownGood = [
    "Threads initial delay",
    "Start users count",
    "Start users ramp up (sec)",
    "Start users count offset",
    "Stop users count",
    "Stop users ramp up (sec)",
    "flight time",
    "Ramp Up Time Between threads",
  ];
  const attrNames = [...block.matchAll(/name="([^"]*)"/g)].map((m) => m[1]);
  for (const attr of attrNames) {
    if (knownGood.includes(attr)) continue;
    // 通用属性（guiclass/testclass/testname/enabled）与 JMeter 基础属性放行
    if (/^(gui|test)class$|^testname$|^enabled$|^TestPlan\.comments$/.test(attr)) continue;
    // 其余属性名中若含小写→大写的驼峰特征，即为违规
    if (/[a-z][a-z]*[A-Z]/.test(attr)) return true;
  }
  return false;
}

function auditJmeter(filePath, content, findings) {
  // T6: 缺少聚合报告
  if (!content.includes("ResultCollector") && !content.includes("SummaryReport")) {
    findings.push({ rule: "T6", file: filePath, severity: SEVERITY.warning, message: "缺少聚合报告/查看结果树" });
  }

  // T7: ConfigTestElement 致命组合
  if (content.includes("ConfigTestElement") && content.includes('guiclass="TestPlanGui"')) {
    findings.push({ rule: "T7", file: filePath, severity: SEVERITY.fatal, message: "ConfigTestElement 与 TestPlanGui 混用，JMeter 会加载失败" });
  }

  // T8: SteppingThreadGroup 驼峰属性名（仅检查属性名，避免标签名误报）
  if (checkSteppingThreadGroup(content)) {
    findings.push({ rule: "T8", file: filePath, severity: SEVERITY.fatal, message: "SteppingThreadGroup 属性名用了驼峰（必须小写空格）" });
  }

  // T9: 缺少 JSON 断言
  if (!content.includes("JSONPathAssertion") && !content.includes("ResponseAssertion")) {
    findings.push({ rule: "T9", file: filePath, severity: SEVERITY.warning, message: "缺少响应断言（不验证响应码/内容）" });
  }

  // T13: 缺少 CSV 数据源（精确匹配元素，注释中出现 CSV 字样不算）
  if (!content.includes("<CSVDataSet")) {
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

  // T16: 缺少响应时间 SLA 断言（DurationAssertion 为 JMeter 实际元素）
  if (!content.includes("DurationAssertion") && !content.includes("Assertion.response_time") && !content.includes("response_time")) {
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

  // T11: 缺少预期结果（按表头定位"预期结果/预期"列，逐行检查该列是否为空）
  const emptyExpect = countEmptyExpectedCells(content);
  const dataRows = countCaseDataRows(content);
  if (dataRows > 0 && emptyExpect > dataRows * 0.3) {
    findings.push({ rule: "T11", file: filePath, severity: SEVERITY.warning, message: `${emptyExpect}/${dataRows} 行预期结果为空` });
  }

  // T19: 用例数量不足（每功能点 < 10 条）
  const tcCount = (content.match(/TC-\d+/g) || []).length;
  if (tcCount > 0 && tcCount < 10) {
    findings.push({ rule: "T19", file: filePath, severity: SEVERITY.error, message: `仅 ${tcCount} 条用例，标准要求每功能点 ≥ 10 条` });
  }

  // T20: 缺少异常场景
  const hasException = content.includes("异常") || content.includes("失败") || content.includes("错误") || content.includes("拒绝") || content.includes("非法") || content.includes("无效");
  if (!hasException && tcCount >= 3) {
    findings.push({ rule: "T20", file: filePath, severity: SEVERITY.warning, message: "缺少异常场景用例（边界/非法输入/权限拒绝）" });
  }
}

// 解析 Markdown 表格，定位"预期结果/预期"列并统计为空的用例行
function countEmptyExpectedCells(content) {
  const lines = content.split("\n").map((l) => l.trim());
  let headerIdx = -1;
  let expectCol = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const cells = splitTableRow(lines[i]);
    const idx = cells.findIndex((c) => /预期结果|预期输出|^预期$/.test(c.trim()));
    if (idx >= 0 && lines[i + 1] && /^\|[\s:|-]+\|?$/.test(lines[i + 1])) {
      headerIdx = i;
      expectCol = idx;
      break;
    }
  }
  if (headerIdx < 0) return 0;

  let empty = 0;
  for (let i = headerIdx + 2; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) {
      if (lines[i] === "") break;
      continue;
    }
    const cells = splitTableRow(lines[i]);
    if (!cells.some((c) => c.trim() !== "")) continue; // 空行跳过
    if (!cells[0]?.trim().startsWith("TC-") && !/^\d+$/.test(cells[0]?.trim() || "")) continue; // 只统计用例行
    const expect = cells[expectCol]?.trim();
    if (!expect || expect === "-" || expect === "无") empty++;
  }
  return empty;
}

function countCaseDataRows(content) {
  const lines = content.split("\n").map((l) => l.trim());
  let count = 0;
  for (const l of lines) {
    if (!l.startsWith("|")) continue;
    const cells = splitTableRow(l);
    if (cells.length === 0) continue;
    if (cells[0]?.trim().startsWith("TC-")) count++;
  }
  return count;
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
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
