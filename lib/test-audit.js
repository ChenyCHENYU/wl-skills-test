/**
 * test-audit.js — 测试代码审计引擎（v0.13.0 规则表驱动）
 *
 * 确定性规则扫描器（对标 kit R1-R16 / bd B1-B29 / ui R001-R039）
 * 审计对象：Playwright 脚本、JMeter jmx、测试用例文档
 *
 * 架构：每条规则是自包含对象 { id, severity, desc, target, check(ctx) → messages[] }。
 * 新增 T26+ 只需在对应目标数组追加一个对象（元数据/逻辑/文档单点维护），
 * 单规则异常自动隔离（不影响其他规则与整体扫描）。
 *
 * 规则清单：
 *   T1  Playwright 脚本缺少 beforeEach（测试数据泄漏风险）
 *   T2  Playwright 脚本含硬编码 URL/token（安全违规，对应 standard 11）
 *   T3  Playwright 脚本缺少断言（只操作不验证，块级精确解析）
 *   T4  Playwright 测试名不规范（不以 should/can/验证 等开头）
 *   T5  Playwright 缺少数据清理（无 afterEach/afterAll）
 *   T6  JMeter 脚本缺少聚合报告（无 ResultCollector/SummaryReport）
 *   T7  JMeter 脚本含 ConfigTestElement+TestPlanGui 致命组合
 *   T8  JMeter SteppingThreadGroup 属性名用了驼峰（必须小写空格）
 *   T9  JMeter 脚本缺少响应断言（不验证响应码）
 *   T10 测试用例文档缺少 P0 用例（无最高优先级覆盖）
 *   T11 测试用例缺少断言列（步骤有但预期结果为空）
 *   T12 Playwright 脚本含 waitForTimeout 硬等待
 *   T13 JMeter 缺少参数化数据源（CSVDataSet/__CSVRead/UserParameters 均无）
 *   T14 JMeter ThreadGroup 缺少循环控制器配置
 *   T15 JMeter 缺少 HTTP Header（Content-Type）
 *   T16 JMeter 缺少响应时间 SLA 断言
 *   T17 JMeter PerfMon 监控器配置异常
 *   T18 JMeter 缺少 ramp_time 或 ramp_time=0（瞬间并发）
 *   T19 用例数量低于标准（每功能点 < 10 条）
 *   T20 用例缺少异常场景覆盖
 *   T21 E2E 包含 test.only（假闭环：只跑局部用例）
 *   T22 受控写入 spec 缺安全标记（门禁/账本/清理）
 *   T23 截断 Bearer 前缀（API 验证与清理失去认证方案）
 *   T24 隔离 spec 声明漂移（B 组未 skip/缺声明）
 *   T25 UI 契约 spec 缺 page.route 拦截（真实写入误归模拟）
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SEVERITY = { fatal: "fatal", error: "error", warning: "warning", info: "info" };

// ══ 规则表（新增规则 = 追加对象）════════════════════════════

const PLAYWRIGHT_RULES = [
  {
    id: "T1",
    severity: SEVERITY.warning,
    desc: "Playwright 缺少 beforeEach（测试数据隔离风险）",
    check: ({ content }) =>
      content.includes("beforeEach") || content.includes("beforeAll")
        ? []
        : ["缺少 beforeEach/beforeAll，测试数据可能泄漏"],
  },
  {
    id: "T2",
    severity: SEVERITY.error,
    desc: "Playwright 含硬编码 URL/token（安全违规）",
    check: ({ content }) => {
      const messages = [];
      const urlPattern = /https?:\/\/(?!localhost|127\.0\.0\.1|\$\{|process\.env|BASE_URL)[^\s"'\)]+/g;
      const urlMatches = content.match(urlPattern);
      if (urlMatches) {
        messages.push(`硬编码 URL: ${urlMatches.slice(0, 3).join(", ")}`);
      }
      if (content.match(/token.*['"].{20,}['"]/i) && !content.includes("process.env") && !content.includes("${")) {
        messages.push("硬编码 token（应使用环境变量）");
      }
      return messages;
    },
  },
  {
    id: "T3",
    severity: SEVERITY.error,
    desc: "Playwright 缺少断言（只操作不验证）",
    check: ({ blocks }) => {
      const noExpectBlocks = blocks.filter((b) => !b.hasExpect);
      if (noExpectBlocks.length === 0) return [];
      return [
        `${noExpectBlocks.length}/${blocks.length} 个 test 块缺少 expect 断言${noExpectBlocks[0].name ? `（首个: "${noExpectBlocks[0].name}"）` : ""}`,
      ];
    },
  },
  {
    id: "T4",
    severity: SEVERITY.warning,
    desc: "Playwright 测试名不规范",
    check: ({ blocks }) =>
      blocks
        .filter((b) => b.name !== null && !/^(should|can|test|验证|检查|列表页|新增|编辑|删除|查询|操作|权限|查询列表|恢复|按指定)/.test(b.name))
        .map((b) => `测试名"${b.name}"不规范（建议 should_xxx / 验证_xxx）`),
  },
  {
    id: "T5",
    severity: SEVERITY.warning,
    desc: "Playwright 缺少数据清理（无 afterEach）",
    check: ({ content }) =>
      content.includes("afterEach") || content.includes("afterAll") ? [] : ["缺少 afterEach/afterAll 数据清理"],
  },
  {
    id: "T12",
    severity: SEVERITY.warning,
    desc: "Playwright 含 waitForTimeout 硬等待",
    check: ({ content }) => {
      const waitMatches = content.match(/waitForTimeout\s*\(/g);
      return waitMatches ? [`使用 waitForTimeout 硬等待 ${waitMatches.length} 次（应用 waitForSelector/waitForResponse）`] : [];
    },
  },
  // ── E2E 工程级规则（源自 wl-ui-produce 实战约束，v0.8.0）──
  {
    id: "T21",
    severity: SEVERITY.error,
    desc: "E2E 包含 test.only（假闭环：只跑局部用例）",
    check: ({ content }) =>
      /\btest\.only\s*\(|\btest\.describe\.only\s*\(/.test(content)
        ? ["包含 test.only/describe.only，禁止提交只执行局部用例的测试文件"]
        : [],
  },
  {
    id: "T22",
    severity: SEVERITY.error,
    desc: "受控写入 spec 缺安全标记（门禁/账本/清理）",
    check: ({ base, content }) => {
      const isWriteSpec = /round2|write|controlled/i.test(base) || content.includes("new RunLedger");
      if (!isWriteSpec) return [];
      const absent = ["requireWriteApproval", "new RunLedger", "finally", "cleanupLedger"].filter((marker) => !content.includes(marker));
      return absent.length > 0 ? [`受控写入 spec 缺少安全标记: ${absent.join(", ")}`] : [];
    },
  },
  {
    id: "T23",
    severity: SEVERITY.fatal,
    desc: "截断 Bearer 前缀（API 验证与清理失去认证方案）",
    check: ({ content }) =>
      /\.slice\(\s*["'`]Bearer\s+["'`]\.length\s*\)/.test(content) || /\.substring\(\s*7\s*\)/.test(content)
        ? ["截断 Bearer 前缀会丢失认证方案（应保留完整 Authorization 头）"]
        : [],
  },
  {
    id: "T24",
    severity: SEVERITY.error,
    desc: "隔离 spec 声明漂移（B 组未 skip/缺声明）",
    check: ({ base, content }) => {
      if (!/quarantine|isolat/i.test(base)) return [];
      if (/\btest\(\s*["'`]B\d+/.test(content)) {
        return ["隔离 spec 存在未 skip 的 B 组用例，禁止解除业务流隔离（需先移出隔离清单）"];
      }
      if (!/\btest\.skip\(\s*["'`]B\d+/.test(content)) {
        return ["隔离 spec 未找到明确的 test.skip B 组声明，隔离声明可能已漂移"];
      }
      return [];
    },
  },
  {
    id: "T25",
    severity: SEVERITY.error,
    desc: "UI 契约 spec 缺 page.route 拦截（真实写入误归模拟）",
    check: ({ base, content }) =>
      /ui-contract/i.test(base) && !content.includes("page.route(")
        ? ["UI 契约 spec 未使用 page.route 拦截——若为真实写入请归入 round2 组"]
        : [],
  },
];

const JMETER_RULES = [
  {
    id: "T6",
    severity: SEVERITY.warning,
    desc: "JMeter 缺少聚合报告",
    check: ({ content }) =>
      content.includes("ResultCollector") || content.includes("SummaryReport") ? [] : ["缺少聚合报告/查看结果树"],
  },
  {
    id: "T7",
    severity: SEVERITY.fatal,
    desc: "JMeter ConfigTestElement+TestPlanGui 致命组合",
    check: ({ content }) =>
      content.includes("ConfigTestElement") && content.includes('guiclass="TestPlanGui"')
        ? ["ConfigTestElement 与 TestPlanGui 混用，JMeter 会加载失败"]
        : [],
  },
  {
    id: "T8",
    severity: SEVERITY.fatal,
    desc: "JMeter SteppingThreadGroup 驼峰属性名",
    check: ({ content }) => (checkSteppingThreadGroup(content) ? ["SteppingThreadGroup 属性名用了驼峰（必须小写空格）"] : []),
  },
  {
    id: "T9",
    severity: SEVERITY.warning,
    desc: "JMeter 缺少 JSON 响应码断言",
    check: ({ content }) =>
      content.includes("JSONPathAssertion") || content.includes("ResponseAssertion") ? [] : ["缺少响应断言（不验证响应码/内容）"],
  },
  {
    id: "T13",
    severity: SEVERITY.fatal,
    desc: "JMeter 缺少参数化数据源（CSV/函数/用户参数均无）",
    check: ({ content }) => {
      // 任一参数化形态即合规：CSVDataSet / __CSVRead 函数 / UserParameters（旧实现只认 CSV，误伤合法方案）
      if (content.includes("<CSVDataSet") || content.includes("__CSVRead") || content.includes("<UserParameters")) return [];
      return ["缺少参数化数据源（CSVDataSet/__CSVRead/UserParameters 均无，并发会重复用同一数据）"];
    },
  },
  {
    id: "T14",
    severity: SEVERITY.fatal,
    desc: "JMeter ThreadGroup 缺少循环控制器配置",
    check: ({ content }) => {
      // 精确判定 LoopController 的 loops 配置存在（旧实现"文件任意位置出现 loops 字样"即豁免——注释里提一句就漏检）
      if (!content.includes("<ThreadGroup")) return [];
      if (/name="Loop(Controller)?\.loops"/.test(content) || content.includes("<LoopController")) return [];
      return ["ThreadGroup 缺少 LoopController（每个线程只跑一次）"];
    },
  },
  {
    id: "T15",
    severity: SEVERITY.fatal,
    desc: "JMeter 缺少 HTTP Header（Content-Type）",
    check: ({ content }) =>
      content.includes("HeaderManager") || content.includes("Content-Type") ? [] : ["缺少 HTTP HeaderManager（POST 请求需 Content-Type: application/json）"],
  },
  {
    id: "T16",
    severity: SEVERITY.warning,
    desc: "JMeter 缺少响应时间 SLA 断言",
    check: ({ content }) =>
      content.includes("DurationAssertion") || content.includes("Assertion.response_time") || content.includes("response_time")
        ? []
        : ["缺少响应时间 SLA 断言（建议 P99 < 500ms）"],
  },
  {
    id: "T17",
    severity: SEVERITY.warning,
    desc: "JMeter PerfMon 监控器配置异常",
    check: ({ content }) => {
      if (!content.includes("PerfMonCollector") && !content.includes("PerfMon")) return [];
      return content.includes("4444") || content.includes("tcp-port") ? [] : ["PerfMon 监控器缺少端口配置（默认 4444）"];
    },
  },
  {
    id: "T18",
    severity: SEVERITY.warning,
    desc: "JMeter 缺少 ramp_time 或 ramp_time=0（瞬间并发）",
    check: ({ content }) => {
      // 解析 ramp_time 实际值（支持字面量与 ${__P(rampUp,默认值)} 属性化）；
      // 旧实现只查存在性——ramp_time=0 恰是"瞬时打满"却通过
      const effective = rampUpEffective(content);
      if (effective === null) return ["缺少 ramp_time（瞬间并发冲击服务）"];
      if (effective === 0) return ["ramp_time=0（瞬时打满并发，起压不控速）"];
      return [];
    },
  },
];

const CASES_RULES = [
  {
    id: "T10",
    severity: SEVERITY.error,
    desc: "测试用例缺少 P0 优先级覆盖",
    check: ({ content }) => (content.includes("P0") || content.includes("P1") ? [] : ["缺少 P0/P1 高优先级用例"]),
  },
  {
    id: "T11",
    severity: SEVERITY.warning,
    desc: "测试用例缺少预期结果（断言）",
    check: ({ content }) => {
      const emptyExpect = countEmptyExpectedCells(content);
      const dataRows = countCaseDataRows(content);
      return dataRows > 0 && emptyExpect > dataRows * 0.3 ? [`${emptyExpect}/${dataRows} 行预期结果为空`] : [];
    },
  },
  {
    id: "T19",
    severity: SEVERITY.error,
    desc: "用例数量低于标准（每功能点 < 10 条）",
    check: ({ content }) => {
      const tcCount = (content.match(/TC-\d+/g) || []).length;
      return tcCount > 0 && tcCount < 10 ? [`仅 ${tcCount} 条用例，标准要求每功能点 ≥ 10 条`] : [];
    },
  },
  {
    id: "T20",
    severity: SEVERITY.warning,
    desc: "用例缺少异常场景覆盖",
    check: ({ content }) => {
      const tcCount = (content.match(/TC-\d+/g) || []).length;
      const hasException = content.includes("异常") || content.includes("失败") || content.includes("错误") || content.includes("拒绝") || content.includes("非法") || content.includes("无效");
      return !hasException && tcCount >= 3 ? ["缺少异常场景用例（边界/非法输入/权限拒绝）"] : [];
    },
  },
];

const RULE_TABLE = {
  playwright: PLAYWRIGHT_RULES,
  jmeter: JMETER_RULES,
  cases: CASES_RULES,
};

// 规则元数据（保持旧导出形状：{id, severity, desc, target}）
export const RULES = Object.entries(RULE_TABLE).flatMap(([target, rules]) =>
  rules.map((r) => ({ id: r.id, severity: r.severity, desc: r.desc, target })),
);

// ══ 审计入口 ═══════════════════════════════════
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".tmp", ".cache"]);

export function audit(target, options = {}) {
  if (!existsSync(target)) {
    return { error: `路径不存在: ${target}` };
  }

  const stat = statSync(target);
  const findings = [];
  options = { ...options, executedChecks: [] };

  if (stat.isDirectory()) {
    auditDir(target, findings, options);
  } else {
    auditFile(target, findings, options);
  }

  return { ...summarize(findings), executedChecks: options.executedChecks };
}

function auditDir(dir, findings, options) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue; // 断链/无权限的条目跳过，不让整个递归崩溃
    }
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

  const base = filePath.split(/[\\/]/).pop();
  try {
    if (ext === ".js" || ext === ".ts" || ext === ".mjs" || ext === ".cjs") {
      // 只审计 *.spec.* / *.test.* 文件——防止把 playwright.config / 支撑模块误判为测试脚本
      if (/\.(spec|test)\.[cm]?[jt]s$/.test(base) && content.includes("playwright")) {
        runRules("playwright", { filePath, base, content, blocks: parseTestBlocks(content) }, findings, options.executedChecks);
      }
    } else if (ext === ".jmx" || content.includes("<jmeterTestPlan")) {
      runRules("jmeter", { filePath, base, content }, findings, options.executedChecks);
    } else if (ext === ".md" && (content.includes("测试用例") || content.includes("TC-") || content.includes("| 序号 |"))) {
      runRules("cases", { filePath, base, content }, findings, options.executedChecks);
    }
  } catch {
    // 单文件规则异常不阻断整体扫描
  }
}

function runRules(target, ctx, findings, executedChecks) {
  for (const rule of RULE_TABLE[target]) {
    try {
      const messages = rule.check(ctx) || [];
      executedChecks?.push({ id: `${rule.id}:${ctx.filePath}`, status: messages.length && ["fatal", "error"].includes(rule.severity) ? "failed" : "passed", reason: rule.desc, evidencePaths: [ctx.filePath] });
      for (const message of messages) {
        findings.push({ rule: rule.id, file: ctx.filePath, severity: rule.severity, message });
      }
    } catch {
      executedChecks?.push({ id: `${rule.id}:${ctx.filePath}`, status: "unverified", reason: "规则执行异常，未验证。", evidencePaths: [ctx.filePath] });
      // 单规则异常隔离：跳过该规则继续（规则自身缺陷不阻断整体扫描）
    }
  }
}

// ══ Playwright 块级解析 ═════════════════════════

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

// ══ JMeter 专用解析 ═════════════════════════════

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

// 解析 ThreadGroup.ramp_time 的实际生效值：支持字面量与 ${__P(rampUp,默认值)} 属性化；
// 无法解析（缺失/函数引用）返回 null
function rampUpEffective(content) {
  const m = content.match(/name="ThreadGroup\.ramp_time"[^>]*>([^<]+)</);
  if (!m) return null;
  const v = m[1].trim();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const prop = v.match(/\$\{__P\([^,]+,\s*(\d+)\s*\)\}/);
  if (prop) return parseInt(prop[1], 10);
  return null;
}

// ══ 用例文档表格解析 ════════════════════════════

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

// ══ 汇总 ═══════════════════════════════════════
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

// ══ 自动修复（对标 kit safe-fix / ui fix）══════
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
        result = result.split(url).join("${BASE_URL}");
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
