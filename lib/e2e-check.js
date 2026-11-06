/**
 * e2e-check.js — E2E 工程独立强校验（v0.8.0）
 *
 * 对任意 E2E 工程目录执行 wl-ui-produce 实战沉淀的工程约束检查（不依赖生成器来源）：
 *
 * 1. 归属闭环: tests/ 下的 spec/test 文件须被 fixtures/suites.js 的归属清单覆盖
 *    （只读取 suites.js/ts 中的字面量归属清单）
 * 2. 静态安全扫描（逐 spec 文件）:
 *    - test.only / describe.only（假闭环）
 *    - 受控写入 spec 缺安全标记（requireWriteApproval / new RunLedger / finally / cleanupLedger）
 *    - 截断 Bearer 前缀（.slice("Bearer ".length) / .substring(7)）
 *    - 隔离 spec 声明漂移（有未 skip 的 B 组 / 缺 test.skip B 声明）
 *    - UI 契约 spec 缺 page.route 拦截
 *
 * 用法: wl-skills-test e2e-check --target ./e2e
 * 退出码: 0=通过 / 1=发现违规（CI 卡门）
 */

import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GROUP_NAME = /^[A-Z][A-Z0-9_]*$/;
const TEST_FILENAME = /\.(?:spec|test)\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_PATH = /^(["'])((?:[\w.-]+\/)*[\w.-]+)\1$/;

function declaredTestPath(item) {
  const file = TEST_PATH.exec(item)?.[2];
  return file && TEST_FILENAME.test(file) && file.split('/').every(part => part !== '.' && part !== '..') ? file : null;
}

function discoverTests(directory) {
  const files = [], links = [], pending = [''];
  while (pending.length) {
    const prefix = pending.pop();
    for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(file);
      else if (entry.isDirectory()) pending.push(file);
      else if (TEST_FILENAME.test(entry.name)) files.push(file);
    }
  }
  return { files: files.sort(), links: links.sort() };
}

function literalArray(source, name, parseItem) {
  const declarations = [...source.matchAll(new RegExp(`^[ \\t]*(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]\\s*(?:as\\s+const\\b)?[ \\t]*(?:;|$)`, "gm"))];
  if (declarations.length !== 1) throw new Error(`归属清单 ${name} 须使用可静态核验的字面量数组`);
  const text = declarations[0][1].trim().replace(/,\s*$/, "");
  return text ? text.split(",").map(item => {
    const parsed = parseItem(item.trim());
    if (!parsed) throw new Error(`归属清单 ${name} 包含无法静态核验的成员`);
    return parsed;
  }) : [];
}

function readOwnership(suitesPath, specs) {
  if (!lstatSync(suitesPath).isFile()) throw new Error("归属清单须为普通文件");
  const source = readFileSync(suitesPath, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, " ");
  const groups = literalArray(source, "OWNED_SPEC_GROUPS", item => GROUP_NAME.test(item) && item);
  const owner = new Map();
  for (const group of groups) {
    for (const spec of literalArray(source, group, declaredTestPath)) {
      if (owner.has(spec)) throw new Error(`重复归属：${spec}`);
      owner.set(spec, group);
    }
  }
  const actual = new Set(specs);
  const unclassified = specs.filter(name => !owner.has(name));
  const missing = [...owner.keys()].filter(name => !actual.has(name));
  if (unclassified.length || missing.length) throw new Error(`未归类：${unclassified.join(", ")}；清单存在但文件缺失：${missing.join(", ")}`);
  return owner;
}

/**
 * @param {string} target — e2e 工程根目录
 * @returns {{ pass: boolean, checks: Array, findings: Array }}
 */
export async function e2eCheck(target) {
  if (!existsSync(target)) {
    return { error: `路径不存在: ${target}` };
  }

  const testsDir = join(target, "tests");
  if (!existsSync(testsDir) || !lstatSync(testsDir).isDirectory()) {
    return { error: `未找到 tests 目录: ${testsDir}` };
  }

  const { files: specs, links } = discoverTests(testsDir);
  const findings = [];
  const checks = [];
  const checkedFiles = [];
  if (!specs.length) checks.push({ name: "测试文件覆盖", pass: null, detail: "没有可检查的测试文件" });
  if (links.length) checks.push({ name: "测试文件路径", pass: null, detail: `未跟随符号链接：${links.join(", ")}` });
  let owner = new Map();

  // ── 1. 归属闭环 ──
  const fixturesDir = join(target, "fixtures");
  const suitesPath = existsSync(fixturesDir) && lstatSync(fixturesDir).isDirectory()
    && ["suites.js", "suites.ts"].map((p) => join(fixturesDir, p)).find((p) => existsSync(p));
  if (!suitesPath) {
    // fail-closed：归属清单是"防假闭环"的核心约束，缺失时门禁必须拦截
    // （否则未归类/重复归属/文件缺失全部不可见，恰好在本该最严的地方放行）
    findings.push({
      severity: "error",
      file: "fixtures/suites.js",
      message: "缺少用例归属清单 suites.js（由 run-gen --type e2e 生成）——未归类/假闭环无法拦截，CI 阻断",
    });
    checks.push({ name: "用例归属清单存在", pass: false, detail: "缺失（阻断）" });
  } else {
    let catalogOk = false;
    try {
      owner = readOwnership(suitesPath, specs);
      catalogOk = true;
    } catch (e) {
      findings.push({ severity: "error", file: "fixtures/suites.js", message: `归属清单校验失败: ${e.message}` });
    }
    checks.push({
      name: "用例归属清单闭环",
      pass: catalogOk,
      detail: catalogOk ? `${specs.length} 个 spec 全部归类` : "见 findings",
    });
  }

  // ── 2. 静态安全扫描 ──
  const writeMarkerIssues = [];
  const onlyIssues = [];
  const bearerIssues = [];
  const quarantineIssues = [];
  const contractIssues = [];

  for (const name of specs) {
    const file = join(testsDir, name);
    if (!lstatSync(file).isFile()) {
      findings.push({ severity: "error", file: `tests/${name}`, message: "测试脚本须为普通文件" });
      continue;
    }
    const source = readFileSync(file, "utf-8");
    checkedFiles.push(file);
    const group = owner.get(name) || "";

    if (/\btest\.only\s*\(|\btest\.describe\.only\s*\(/.test(source)) {
      onlyIssues.push(name);
      findings.push({ severity: "error", file: `tests/${name}`, message: "包含 test.only/describe.only，禁止只执行局部用例" });
    }

    const isWriteSpec = /round2|write|controlled/i.test(name) || /ROUND2|WRITE|CONTROLLED/.test(group) || source.includes("new RunLedger");
    if (isWriteSpec) {
      const absent = ["requireWriteApproval", "new RunLedger", "finally", "cleanupLedger"].filter((m) => !source.includes(m));
      if (absent.length > 0) {
        writeMarkerIssues.push(name);
        findings.push({ severity: "error", file: `tests/${name}`, message: `受控写入 spec 缺少安全标记: ${absent.join(", ")}` });
      }
    }

    if (/\.slice\(\s*["'`]Bearer\s+["'`]\.length\s*\)/.test(source) || /\.substring\(\s*7\s*\)/.test(source)) {
      bearerIssues.push(name);
      findings.push({ severity: "fatal", file: `tests/${name}`, message: "截断 Bearer 前缀，真实 API 验证和清理请求将失去认证方案" });
    }

    if (/quarantine|isolat/i.test(name) || /QUARANTINE|ISOLAT/.test(group)) {
      if (/\btest\(\s*["'`]B\d+/.test(source)) {
        quarantineIssues.push(name);
        findings.push({ severity: "error", file: `tests/${name}`, message: "隔离 spec 存在未 skip 的 B 组用例，禁止解除业务流隔离" });
      } else if (!/\btest\.skip\(\s*["'`]B\d+/.test(source)) {
        quarantineIssues.push(name);
        findings.push({ severity: "error", file: `tests/${name}`, message: "隔离 spec 未找到 test.skip B 组声明，隔离声明可能已漂移" });
      }
    }

    if ((/ui-contract/i.test(name) || /UI_CONTRACT|WORKSTATION/.test(group)) && !source.includes("page.route(")) {
      contractIssues.push(name);
      findings.push({ severity: "error", file: `tests/${name}`, message: "UI 契约 spec 未使用 page.route 拦截——若为真实写入请归入 round2 组" });
    }
  }

  checks.push(
    { name: "无 test.only（假闭环）", pass: onlyIssues.length === 0, detail: onlyIssues.join(", ") || "通过" },
    { name: "写入组安全标记完整", pass: writeMarkerIssues.length === 0, detail: writeMarkerIssues.join(", ") || "通过" },
    { name: "无 Bearer 前缀截断", pass: bearerIssues.length === 0, detail: bearerIssues.join(", ") || "通过" },
    { name: "隔离声明无漂移", pass: quarantineIssues.length === 0, detail: quarantineIssues.join(", ") || "通过" },
    { name: "UI 契约含 page.route", pass: contractIssues.length === 0, detail: contractIssues.join(", ") || "通过" },
  );

  const hasFatal = findings.some((f) => f.severity === "fatal");
  const hasError = findings.some((f) => f.severity === "error");
  const validationStatus = hasFatal || hasError ? "failed" : !checkedFiles.length || links.length ? "unverified" : "passed";
  return {
    pass: validationStatus === 'unverified' ? null : validationStatus === 'passed',
    validationStatus,
    level: hasFatal ? "fatal" : hasError ? "error" : validationStatus === "passed" ? "pass" : "unverified",
    totalSpecs: specs.length,
    checkedFiles,
    checks,
    findings,
  };
}
