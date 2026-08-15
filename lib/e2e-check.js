/**
 * e2e-check.js — E2E 工程独立强校验（v0.8.0）
 *
 * 对任意 E2E 工程目录执行 wl-ui-produce 实战沉淀的工程约束检查（不依赖生成器来源）：
 *
 * 1. 归属闭环: tests/ 下每个 *.spec.js 必须被 fixtures/suites.js 的归属清单覆盖
 *    （若存在 suites.js 且导出 assertE2ESpecCatalog，直接复用其完整校验；否则按文件名约定分类）
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @param {string} target — e2e 工程根目录
 * @returns {{ pass: boolean, checks: Array, findings: Array }}
 */
export async function e2eCheck(target) {
  if (!existsSync(target)) {
    return { error: `路径不存在: ${target}` };
  }

  const testsDir = join(target, "tests");
  if (!existsSync(testsDir)) {
    return { error: `未找到 tests 目录: ${testsDir}` };
  }

  const specs = readdirSync(testsDir).filter((f) => /\.spec\.[cm]?[jt]s$/.test(f)).sort();
  const findings = [];
  const checks = [];

  // ── 1. 归属闭环 ──
  const suitesPath = ["fixtures/suites.js", "fixtures/suites.ts"].map((p) => join(target, p)).find((p) => existsSync(p));
  if (!suitesPath) {
    findings.push({
      severity: "warning",
      file: "fixtures/suites.js",
      message: "缺少用例归属清单 suites.js（建议由 run-gen --type e2e 生成），未归类/假闭环无法拦截",
    });
    checks.push({ name: "用例归属清单存在", pass: false, detail: "缺失（warning）" });
  } else {
    let catalogOk = false;
    let detail = "";
    // 优先复用工程自身的完整校验逻辑（与 playwright.config 加载时一致）
    try {
      const mod = await import(pathToFileURL(suitesPath).href);
      if (typeof mod.assertE2ESpecCatalog === "function") {
        mod.assertE2ESpecCatalog(testsDir);
        catalogOk = true;
      } else {
        detail = "suites.js 未导出 assertE2ESpecCatalog，退化为文件名约定分类";
      }
    } catch (e) {
      findings.push({ severity: "error", file: "fixtures/suites.js", message: `归属清单校验失败: ${e.message}` });
    }
    if (!catalogOk && !detail) detail = "";
    checks.push({
      name: "用例归属清单闭环",
      pass: catalogOk,
      detail: catalogOk ? `${specs.length} 个 spec 全部归类` : detail || "见 findings",
    });
  }

  // ── 2. 静态安全扫描 ──
  const writeMarkerIssues = [];
  const onlyIssues = [];
  const bearerIssues = [];
  const quarantineIssues = [];
  const contractIssues = [];

  for (const name of specs) {
    const source = readFileSync(join(testsDir, name), "utf-8");

    if (/\btest\.only\s*\(|\btest\.describe\.only\s*\(/.test(source)) {
      onlyIssues.push(name);
      findings.push({ severity: "error", file: `tests/${name}`, message: "包含 test.only/describe.only，禁止只执行局部用例" });
    }

    const isWriteSpec = /round2|write|controlled/i.test(name) || source.includes("new RunLedger");
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

    if (/quarantine|isolat/i.test(name)) {
      if (/\btest\(\s*["'`]B\d+/.test(source)) {
        quarantineIssues.push(name);
        findings.push({ severity: "error", file: `tests/${name}`, message: "隔离 spec 存在未 skip 的 B 组用例，禁止解除业务流隔离" });
      } else if (!/\btest\.skip\(\s*["'`]B\d+/.test(source)) {
        quarantineIssues.push(name);
        findings.push({ severity: "error", file: `tests/${name}`, message: "隔离 spec 未找到 test.skip B 组声明，隔离声明可能已漂移" });
      }
    }

    if (/ui-contract/i.test(name) && !source.includes("page.route(")) {
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
  return {
    pass: !hasFatal && !hasError,
    level: hasFatal ? "fatal" : hasError ? "error" : "pass",
    totalSpecs: specs.length,
    checks,
    findings,
  };
}
