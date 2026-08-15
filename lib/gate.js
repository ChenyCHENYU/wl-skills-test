/**
 * gate.js — 质量门聚合入口（v0.10.0）
 *
 * 一条命令聚合全部卡门检查（复用各 lib，不再拼 4 条命令）：
 *   wl-skills-test gate --audit-dir ./tests --e2e-dir ./e2e \
 *     --smoke-result smoke.json --defects defects.json --cases 150 \
 *     --perf-current result.jtl --perf-baseline baseline.jtl [--webhook <url>]
 *
 * 检查项（提供的才执行，全部通过 exit 0，任一失败 exit 1）:
 *   1. 测试代码审计（fatal=0 且 error=0）
 *   2. E2E 工程强校验（e2eCheck）
 *   3. 冒烟通过率 ≥95%
 *   4. DI 质量门（密度<0.3 / 致命严重全关闭 / 模块收敛）
 *   5. 性能基线对比（劣化即失败）
 *   6. （可选）webhook 推送结论
 */

import { readFileSync, existsSync } from "node:fs";
import { audit } from "./test-audit.js";
import { e2eCheck } from "./e2e-check.js";
import { perfCompare } from "./perf-compare.js";
import { calculateDI } from "./test-codegen.js";

export async function runGate(opts = {}) {
  const checks = [];
  const inputErrors = [];

  // 1. 测试代码审计
  if (opts.auditDir) {
    if (!existsSync(opts.auditDir)) {
      inputErrors.push(`审计目录不存在: ${opts.auditDir}`);
    } else {
      const r = audit(opts.auditDir);
      if (r.error) inputErrors.push(`审计失败: ${r.error}`);
      else {
        checks.push({ name: "测试代码审计（fatal=0）", pass: r.bySeverity.fatal === 0, detail: `fatal=${r.bySeverity.fatal} error=${r.bySeverity.error} warning=${r.bySeverity.warning}` });
        checks.push({ name: "测试代码审计（error=0）", pass: r.bySeverity.error === 0, detail: `T 规则违规 ${r.total} 项` });
      }
    }
  }

  // 2. E2E 工程强校验
  if (opts.e2eDir) {
    if (!existsSync(opts.e2eDir)) {
      inputErrors.push(`E2E 目录不存在: ${opts.e2eDir}`);
    } else {
      const r = await e2eCheck(opts.e2eDir);
      if (r.error) inputErrors.push(`e2e-check 失败: ${r.error}`);
      else {
        for (const c of r.checks) checks.push({ name: `E2E: ${c.name}`, pass: c.pass, detail: c.detail });
      }
    }
  }

  // 3. 冒烟通过率
  if (opts.smokeResult) {
    if (!existsSync(opts.smokeResult)) {
      inputErrors.push(`冒烟结果不存在: ${opts.smokeResult}`);
    } else {
      try {
        const smoke = JSON.parse(readFileSync(opts.smokeResult, "utf-8"));
        const rate = smoke.summary?.passRate ?? smoke.passRate;
        if (typeof rate !== "number") throw new Error("缺少 passRate");
        checks.push({ name: "冒烟通过率 ≥ 95%", pass: rate >= 95, detail: `${rate}%` });
      } catch (e) {
        inputErrors.push(`冒烟结果解析失败: ${e.message}`);
      }
    }
  }

  // 4. DI 质量门
  if (opts.defects) {
    if (!existsSync(opts.defects)) {
      inputErrors.push(`缺陷文件不存在: ${opts.defects}`);
    } else {
      try {
        const defects = JSON.parse(readFileSync(opts.defects, "utf-8"));
        if (!Array.isArray(defects)) throw new Error("必须是 JSON 数组");
        const di = calculateDI(defects, opts.cases || 50);
        checks.push({ name: "DI 密度 < 0.3", pass: di.releaseChecks.diDensity.pass, detail: String(di.diDensity) });
        checks.push({ name: "致命缺陷全部关闭", pass: di.releaseChecks.fatalClosed.pass, detail: `未关闭: ${di.releaseChecks.fatalClosed.value}` });
        checks.push({ name: "严重缺陷全部关闭", pass: di.releaseChecks.criticalClosed.pass, detail: `未关闭: ${di.releaseChecks.criticalClosed.value}` });
      } catch (e) {
        inputErrors.push(`缺陷数据解析失败: ${e.message}`);
      }
    }
  }

  // 5. 性能基线
  if (opts.perfCurrent || opts.perfBaseline) {
    if (!opts.perfCurrent || !opts.perfBaseline) {
      inputErrors.push("性能对比需要同时提供 --perf-current 与 --perf-baseline");
    } else {
      const r = perfCompare({ currentPath: opts.perfCurrent, baselinePath: opts.perfBaseline, threshold: opts.perfThreshold });
      if (r.error) inputErrors.push(`性能对比失败: ${r.error}`);
      else {
        checks.push({ name: "性能基线（无劣化）", pass: !r.regressed, detail: r.summary.verdict });
      }
    }
  }

  if (inputErrors.length > 0) {
    return { pass: false, inputErrors, checks };
  }
  if (checks.length === 0) {
    return { error: "未提供任何检查项（--audit-dir/--e2e-dir/--smoke-result/--defects/--perf-current）" };
  }

  const pass = checks.every((c) => c.pass);
  return {
    pass,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.pass).length,
      failed: checks.filter((c) => !c.pass).length,
      verdict: pass ? "✅ 质量门通过，允许上线" : "❌ 质量门未通过，阻断上线",
    },
  };
}
