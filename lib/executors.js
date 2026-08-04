/**
 * executors.js — Playwright + JMeter 执行器
 *
 * 调用系统已安装的 Playwright/JMeter 执行测试并解析结果。
 * 如果工具未安装则优雅降级为提示。
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";

/**
 * 执行 Playwright 测试
 * @param {object} options — { testDir, reporter, headed, browser }
 * @returns {object} 执行结果
 */
export function runPlaywright(options = {}) {
  const { testDir = "./tests", reporter = "list", headed = false, browser = "chromium" } = options;

  // 检查 Playwright 是否可用
  const versionCheck = checkTool("npx playwright --version");
  if (!versionCheck.ok) {
    return {
      error: "Playwright 未安装或不在 PATH 中",
      hint: "安装: npm i -D @playwright/test && npx playwright install",
    };
  }

  const cmd = [
    "npx playwright test",
    testDir,
    `--reporter=${reporter}`,
    headed ? "--headed" : "",
    browser ? `--project=${browser}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`[playwright] 执行: ${cmd}\n`);

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 300000, // 5 分钟
      maxBuffer: 10 * 1024 * 1024,
    });

    // 解析输出统计
    const stats = parsePlaywrightOutput(output);
    return {
      tool: "playwright",
      version: versionCheck.version,
      ...stats,
      output: output.slice(-2000),
    };
  } catch (e) {
    // Playwright 测试失败时退出码非 0，但 stdout/stderr 有结果
    const output = (e.stdout || "") + (e.stderr || "");
    const stats = parsePlaywrightOutput(output);
    return {
      tool: "playwright",
      version: versionCheck.version,
      ...stats,
      output: output.slice(-2000),
      timedOut: e.status === null,
    };
  }
}

/**
 * 执行 JMeter 压测
 * @param {object} options — { jmxPath, threads, resultDir, jmeterPath }
 * @returns {object} 执行结果
 */
export function runJmeter(options = {}) {
  const { jmxPath, threads = 100, resultDir = "./jmeter-results", jmeterPath } = options;

  if (!jmxPath || !existsSync(jmxPath)) {
    return { error: "jmx 文件路径无效或不存在" };
  }

  // 检查 JMeter 是否可用
  const jmeterCmd = jmeterPath || "jmeter";
  const versionCheck = checkTool(`${jmeterCmd} --version`);
  if (!versionCheck.ok) {
    return {
      error: "JMeter 未安装或不在 PATH 中",
      hint: "安装: 下载 JMeter 5.6.3，配置 JMETER_HOME 和 PATH",
    };
  }

  const jtlPath = `${resultDir}/result.jtl`;
  const reportPath = `${resultDir}/report`;
  const cmd = [
    jmeterCmd,
    "-n", // non-GUI
    `-t "${jmxPath}"`,
    `-Jthreads=${threads}`,
    `-l "${jtlPath}"`,
    `-e -o "${reportPath}"`,
  ].join(" ");

  console.log(`[jmeter] 执行: ${cmd}\n`);

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 600000, // 10 分钟
      maxBuffer: 20 * 1024 * 1024,
    });

    // 解析 jtl 结果
    const stats = parseJtlResults(jtlPath);
    return {
      tool: "jmeter",
      version: versionCheck.version,
      threads,
      ...stats,
      output: output.slice(-3000),
      reportPath,
    };
  } catch (e) {
    const output = (e.stdout || "") + (e.stderr || "");
    return {
      tool: "jmeter",
      version: versionCheck.version,
      error: e.message,
      output: output.slice(-3000),
      timedOut: e.status === null,
    };
  }
}

// ── 辅助函数 ────────────────────────────────────
function checkTool(cmd) {
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return { ok: true, version: versionMatch ? versionMatch[1] : "unknown" };
  } catch {
    return { ok: false, version: null };
  }
}

function parsePlaywrightOutput(output) {
  const passed = (output.match(/(\d+)\s*passed/i) || [])[1];
  const failed = (output.match(/(\d+)\s*failed/i) || [])[1];
  const skipped = (output.match(/(\d+)\s*skipped/i) || [])[1];
  const flaky = (output.match(/(\d+)\s*flaky/i) || [])[1];

  const passCount = parseInt(passed) || 0;
  const failCount = parseInt(failed) || 0;
  const total = passCount + failCount + (parseInt(skipped) || 0);
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return {
    passed: passCount,
    failed: failCount,
    skipped: parseInt(skipped) || 0,
    flaky: parseInt(flaky) || 0,
    total,
    passRate,
    decision: failCount === 0 ? "通过" : passRate >= 95 ? "部分通过（允许）" : "不通过",
  };
}

function parseJtlResults(jtlPath) {
  if (!existsSync(jtlPath)) {
    return { error: "结果文件未生成" };
  }

  const content = readFileSync(jtlPath, "utf-8");
  const lines = content.trim().split("\n").filter((l) => l.trim());

  if (lines.length < 2) {
    return { samples: 0 };
  }

  // JMeter jtl CSV 格式：timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect
  const header = lines[0].split(",").map((h) => h.trim());
  const successIdx = header.indexOf("success");
  const elapsedIdx = header.indexOf("elapsed");
  const codeIdx = header.indexOf("responseCode");

  let total = 0;
  let success = 0;
  let fail = 0;
  const times = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    total++;
    if (successIdx >= 0 && cols[successIdx] === "true") success++;
    else fail++;
    if (elapsedIdx >= 0 && cols[elapsedIdx]) times.push(parseInt(cols[elapsedIdx]));
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;
  const p99 = times[Math.floor(times.length * 0.99)] || 0;
  const errorRate = total > 0 ? (fail / total) * 100 : 0;

  return {
    samples: total,
    passed: success,
    failed: fail,
    errorRate: Math.round(errorRate * 100) / 100,
    p50,
    p95,
    p99,
    sla: p99 < 500 ? "达标" : p99 < 1000 ? "峰值放宽" : "超标",
    decision: errorRate < 1 && p99 < 1000 ? "通过" : errorRate < 5 ? "部分通过" : "不通过",
  };
}
