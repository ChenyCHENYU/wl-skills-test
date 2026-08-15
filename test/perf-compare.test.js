/**
 * perf-compare 测试 — 基线对比与劣化判定
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { perfCompare } from "../lib/perf-compare.js";

const TMP = join(process.cwd(), ".tmp-perf-compare");

function writeJtl(name, times, allSuccess = true) {
  const lines = [
    "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect",
  ];
  times.forEach((t, i) => {
    lines.push(`1700000000000,${t},sample,200,OK,thread-1,text,${allSuccess ? "true" : "false"},${allSuccess ? "" : `"assert failed, code=5000"`},100,50,1,1,${t},0,5`);
  });
  const p = join(TMP, name);
  writeFileSync(p, lines.join("\n"), "utf-8");
  return p;
}

test("perf-compare: 无劣化时通过", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const base = writeJtl("base.jtl", [100, 110, 120, 130, 140, 150]);
    const curr = writeJtl("curr.jtl", [100, 112, 118, 128, 138, 150]);
    const result = perfCompare({ currentPath: curr, baselinePath: base, threshold: 15 });
    assert.equal(result.error, undefined);
    assert.equal(result.regressed, false, `metrics: ${JSON.stringify(result.metrics)}`);
    assert.ok(result.markdown.includes("无劣化"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("perf-compare: P99 劣化超阈值判定失败", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const base = writeJtl("base.jtl", [100, 110, 120, 130, 140, 150]);
    const curr = writeJtl("curr.jtl", [100, 110, 120, 130, 240, 250]); // +60%+
    const result = perfCompare({ currentPath: curr, baselinePath: base, threshold: 15 });
    assert.equal(result.regressed, true);
    assert.ok(result.worst.some((w) => /p9[59]/.test(w) || w === "p99" || w === "p95"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("perf-compare: 错误率上升超 1pp 判定失败", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const base = writeJtl("base.jtl", [100, 100, 100, 100], true);
    const curr = writeJtl("curr.jtl", [100, 100, 100, 100], false); // 全失败
    const result = perfCompare({ currentPath: curr, baselinePath: base, threshold: 15 });
    assert.equal(result.regressed, true);
    assert.ok(result.worst.includes("errorRate"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("perf-compare: JSON 基线（本工具导出的 summary 结构）", () => {
  mkdirSync(TMP, { recursive: true });
  try {
    const curr = writeJtl("curr.jtl", [100, 110, 120, 130, 140, 150]);
    const baseline = join(TMP, "baseline.json");
    // 与 6 样本解析口径一致（p50=times[2]=120, p95=p99=times[5]=150）
    writeFileSync(baseline, JSON.stringify({ summary: { samples: 6, p50: 120, p95: 150, p99: 150, errorRate: 0 } }));
    const result = perfCompare({ currentPath: curr, baselinePath: baseline });
    assert.equal(result.error, undefined);
    assert.equal(result.regressed, false);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("perf-compare: 文件缺失返回错误", () => {
  const result = perfCompare({ currentPath: "./no.jtl", baselinePath: "./no2.jtl" });
  assert.ok(result.error);
});
