/**
 * executors.js — Playwright + JMeter 执行器（v0.13.0 异步化）
 *
 * 关键约束：
 *  1. 进程以「参数数组 + shell:false」spawn——路径含空格/&/| 不再破坏命令或注入 shell。
 *  2. 进度输出走 stderr——本模块被 MCP stdio server 复用，stdout 是 JSON-RPC 帧。
 *  3. jtl 解析流式读取（readline）+ 整数直方图分位数——百 MB 级结果不再整文件进内存。
 *  4. JMeter 非零退出时也尝试解析已生成的部分 jtl（失败样本仍有统计价值）。
 *
 * 与 jmeter-generator 约定：jmx 线程组使用 ${__P(threads,...)} 属性化，
 * 因此 -Jthreads / -JrampUp / -Jloops 运行时参数可实时生效。
 */

import { existsSync, rmSync, mkdirSync, createReadStream } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const IS_WIN = process.platform === "win32";

// Windows 下 spawn(shell:false) 无法直接执行 npx/jmeter（实际是 .cmd/.bat），需解析候选名
function commandCandidates(cmd) {
  if (!IS_WIN) return [cmd];
  if (cmd === "npx") return ["npx.cmd"];
  if (cmd === "jmeter") return ["jmeter.bat", "jmeter.cmd", "jmeter.exe", "jmeter"];
  return [cmd];
}

/**
 * 以参数数组运行外部命令（不经 shell，天然免疫路径中的 &/| 等注入字符）
 * @returns {Promise<{status:number|null, stdout:string, stderr:string, timedOut:boolean}>}
 */
function runProcess(cmd, args, { timeoutMs = 300000, maxChars = 10 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true });
    } catch (e) {
      resolve({ status: null, stdout: "", stderr: String(e.message), timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Windows 上 kill() 只终止直接子进程，npx→node→playwright 链会留孤儿进程——
      // taskkill /T 终止整棵进程树（其他平台 kill 信号会传导给进程组）
      if (IS_WIN && child.pid) {
        try {
          spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
        } catch {
          // taskkill 不可用时退回 kill
        }
      }
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      if (stdout.length < maxChars) stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < maxChars) stderr += d.toString("utf-8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: stderr + String(e.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr, timedOut });
    });
  });
}

function checkTool(cmd, args) {
  for (const candidate of commandCandidates(cmd)) {
    const r = spawnSync(candidate, args, { encoding: "utf-8", timeout: 30000, windowsHide: true });
    if (r.error) continue; // ENOENT → 试下一个候选
    const output = (r.stdout || "") + (r.stderr || "");
    const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
    return { ok: true, command: candidate, version: versionMatch ? versionMatch[1] : "unknown" };
  }
  return { ok: false, command: null, version: null };
}

/**
 * 执行 Playwright 测试（异步）
 * @param {object} options — { testDir, reporter, headed, browser }
 */
export async function runPlaywright(options = {}) {
  const { testDir = "./tests", reporter = "list", headed = false, browser = "" } = options;

  const versionCheck = checkTool("npx", ["--version"]);
  const pwCheck = checkTool("npx", ["playwright", "--version"]);
  if (!pwCheck.ok) {
    return {
      error: "Playwright 未安装或不在 PATH 中",
      hint: "安装: npm i -D @playwright/test && npx playwright install",
    };
  }

  const args = ["playwright", "test", testDir, `--reporter=${reporter}`];
  if (headed) args.push("--headed");
  if (browser) args.push(`--project=${browser}`); // 未指定时不追加，避免与用户 config 的 projects 冲突

  // 注意：进度信息走 stderr（MCP stdio server 复用本模块，stdout 是协议帧）
  console.error(`[playwright] 执行: npx ${args.join(" ")}\n`);

  const { status, stdout, stderr, timedOut } = await runProcess(pwCheck.command, args, { timeoutMs: 300000 });
  const output = stdout + stderr;
  const stats = parsePlaywrightOutput(output);

  if (status === 0) {
    return { tool: "playwright", version: pwCheck.version, ...stats, output: output.slice(-2000) };
  }
  // Playwright 测试失败时退出码非 0，但 stdout/stderr 有结果
  return { tool: "playwright", version: pwCheck.version, ...stats, output: output.slice(-2000), timedOut };
}

/**
 * 执行 JMeter 压测（异步）
 * @param {object} options — { jmxPath, threads, resultDir, jmeterPath, rampUp, loops }
 */
export async function runJmeter(options = {}) {
  const { jmxPath, threads = 100, rampUp, loops, resultDir = "./jmeter-results", jmeterPath } = options;

  if (!jmxPath || !existsSync(jmxPath)) {
    return { error: "jmx 文件路径无效或不存在" };
  }

  const jmeterCmd = jmeterPath || "jmeter";
  const versionCheck = checkTool(jmeterCmd, ["--version"]);
  if (!versionCheck.ok) {
    return {
      error: "JMeter 未安装或不在 PATH 中",
      hint: "安装: 下载 JMeter 5.6.3，配置 JMETER_HOME 和 PATH",
    };
  }

  const jtlPath = `${resultDir}/result.jtl`;
  const reportPath = `${resultDir}/report`;

  // JMeter -e -o 要求报告目录必须不存在，重复运行前先清理
  try {
    rmSync(reportPath, { recursive: true, force: true });
    rmSync(jtlPath, { force: true });
    mkdirSync(resultDir, { recursive: true });
  } catch {
    // 清理失败继续尝试执行，由 JMeter 报错兜底
  }

  const args = [
    "-n", // non-GUI
    "-t", jmxPath,
    `-Jthreads=${threads}`,
    ...(rampUp !== undefined ? [`-JrampUp=${rampUp}`] : []),
    ...(loops !== undefined ? [`-Jloops=${loops}`] : []),
    "-l", jtlPath,
    "-e", "-o", reportPath,
  ];

  console.error(`[jmeter] 执行: ${versionCheck.command} ${args.join(" ")}\n`);

  const { status, stdout, stderr, timedOut } = await runProcess(versionCheck.command, args, {
    timeoutMs: 600000,
    maxChars: 20 * 1024 * 1024,
  });
  const output = stdout + stderr;

  // 非零退出也解析已生成的部分 jtl（压测中断时已采样数据仍有统计价值）
  const stats = await parseJtlResults(jtlPath);

  if (status === 0) {
    return { tool: "jmeter", version: versionCheck.version, threads, ...stats, output: output.slice(-3000), reportPath };
  }
  return {
    tool: "jmeter",
    version: versionCheck.version,
    error: `JMeter 退出码 ${status ?? "null"}${timedOut ? "（超时终止）" : ""}`,
    ...(stats && stats.samples > 0 ? stats : {}),
    output: output.slice(-3000),
    timedOut,
  };
}

// ── 辅助函数 ────────────────────────────────────
function parsePlaywrightOutput(output) {
  // 兼容千分位分组数字（"1,234 passed"）
  const count = (re) => {
    const m = output.match(re);
    return m ? parseInt(m[1].replaceAll(",", ""), 10) || 0 : 0;
  };
  const passCount = count(/([\d,]+)\s*passed/i);
  const failCount = count(/([\d,]+)\s*failed/i);
  const skipCount = count(/([\d,]+)\s*skipped/i);
  const flakyCount = count(/([\d,]+)\s*flaky/i);

  const total = passCount + failCount + skipCount;
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const decision = failCount === 0 ? "通过" : passRate >= 95 ? "部分通过（允许）" : "不通过";

  return {
    passed: passCount,
    failed: failCount,
    skipped: skipCount,
    flaky: flakyCount,
    total,
    passRate,
    decision,
    // 布尔判定（CI 门禁消费，勿依赖中文文案判断）
    pass: decision !== "不通过",
  };
}

// 解析 jtl 一行：处理双引号包裹字段与 CSV 双写转义（""→"，failureMessage 常含逗号/引号）
export function splitJtlLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

/**
 * 流式解析 jtl（readline 逐行 + 整数直方图算分位数）
 * 百 MB 级结果不再整文件读入内存（旧实现在默认 100 线程多循环下有 OOM 风险）。
 * v0.18.0 增补：p90 / 吞吐量 TPS（按样本时间窗）/ 错误分布 TopN。
 */
export async function parseJtlResults(jtlPath) {
  if (!existsSync(jtlPath)) {
    return { error: "结果文件未生成" };
  }

  // JMeter jtl CSV 格式：timeStamp,elapsed,label,responseCode,...,success,failureMessage,bytes,...
  let total = 0;
  let success = 0;
  let fail = 0;
  let successIdx = -1;
  let elapsedIdx = -1;
  let labelIdx = -1;
  let tsIdx = -1;
  let headerSeen = false;
  let minTs = Number.POSITIVE_INFINITY;
  let maxEnd = 0;
  const errorsByLabel = new Map();
  // elapsed 为整数 → 直方图（Map<value,count>），内存与样本数解耦
  const histogram = new Map();

  const rl = createInterface({ input: createReadStream(jtlPath, "utf-8"), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!headerSeen) {
      const header = splitJtlLine(trimmed).map((h) => h.trim().replace(/^"|"$/g, ""));
      successIdx = header.indexOf("success");
      elapsedIdx = header.indexOf("elapsed");
      labelIdx = header.indexOf("label");
      tsIdx = header.indexOf("timeStamp");
      headerSeen = true;
      continue;
    }
    const cols = splitJtlLine(trimmed);
    total++;
    const ok = successIdx >= 0 && cols[successIdx] === "true";
    if (ok) success++;
    else {
      fail++;
      const label = labelIdx >= 0 ? (cols[labelIdx] || "unknown").slice(0, 60) : "unknown";
      errorsByLabel.set(label, (errorsByLabel.get(label) || 0) + 1);
    }
    if (elapsedIdx >= 0 && cols[elapsedIdx] !== undefined && cols[elapsedIdx] !== "") {
      const v = parseInt(cols[elapsedIdx], 10);
      if (Number.isFinite(v)) histogram.set(v, (histogram.get(v) || 0) + 1);
    }
    if (tsIdx >= 0 && cols[tsIdx]) {
      const ts = parseInt(cols[tsIdx], 10);
      const el = elapsedIdx >= 0 ? parseInt(cols[elapsedIdx], 10) || 0 : 0;
      if (Number.isFinite(ts)) {
        if (ts < minTs) minTs = ts;
        if (ts + el > maxEnd) maxEnd = ts + el;
      }
    }
  }

  if (!headerSeen) return { samples: 0 };

  // 直方图分位数（n-1 索引，与旧实现口径一致）
  const distinct = [...histogram.keys()].sort((a, b) => a - b);
  const sampleCount = [...histogram.values()].reduce((a, b) => a + b, 0);
  const percentile = (p) => {
    if (sampleCount === 0) return 0;
    const target = Math.min(sampleCount, Math.ceil((p / 100) * sampleCount));
    let acc = 0;
    for (const v of distinct) {
      acc += histogram.get(v);
      if (acc >= target) return v;
    }
    return distinct[distinct.length - 1];
  };
  const p50 = percentile(50);
  const p90 = percentile(90);
  const p95 = percentile(95);
  const p99 = percentile(99);
  const errorRate = total > 0 ? (fail / total) * 100 : 0;
  const decision = errorRate < 1 && p99 < 1000 ? "通过" : errorRate < 5 ? "部分通过" : "不通过";
  // 吞吐量：样本数 / 样本时间窗（首样本开始 → 末样本结束）
  const windowSec = maxEnd > minTs ? (maxEnd - minTs) / 1000 : 0;
  const throughput = windowSec > 0 ? Math.round((total / windowSec) * 100) / 100 : 0;
  const errorsTop = [...errorsByLabel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, count]) => ({ label, count }));

  return {
    samples: total,
    passed: success,
    failed: fail,
    errorRate: Math.round(errorRate * 100) / 100,
    p50,
    p90,
    p95,
    p99,
    throughput,
    errorsTop: fail > 0 ? errorsTop : [],
    sla: p99 < 500 ? "达标" : p99 < 1000 ? "峰值放宽" : "超标",
    decision,
    // 布尔判定（CI 门禁消费，勿依赖中文文案判断）
    pass: decision !== "不通过",
  };
}
