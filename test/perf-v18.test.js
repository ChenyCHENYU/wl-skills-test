/**
 * v0.18.0 性能工程化回归 — p90/TPS/错误TopN / 基线自动管理 / 混合场景 jmx
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v18");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

const HEADER = "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect";

function writeJtl(name, rows) {
  const p = join(TMP, name);
  writeFileSync(p, [HEADER, ...rows].join("\n") + "\n");
  return p;
}

// ── p90 / TPS / 错误 TopN ──
test("v18: jtl 解析输出 p90 / 吞吐量 / 错误分布 TopN", async () => {
  setupTmp();
  // 10 个样本跨 1 秒窗口（100ms 间隔），2 个失败（label=queryPage / save 各若干）
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const ts = 1700000000000 + i * 100;
    const elapsed = 100 + i * 10;
    const ok = i < 8;
    const label = i < 5 ? "queryPage" : "save";
    rows.push(`1700000000000,${elapsed},${label},200,OK,t1,text,${ok ? "true" : "false"},${ok ? "" : '"boom, bad"'},512,64,1,1,${elapsed},0,5`.replace("1700000000000", String(ts)));
  }
  const jtl = writeJtl("stats.jtl", rows);
  try {
    const { parseJtlResults } = await import(pathToFileURL(join(__dirname, "..", "lib", "executors.js")).href);
    const stats = await parseJtlResults(jtl);
    assert.equal(stats.samples, 10);
    // p90: 排序后第 9 个（ceil(0.9*10)=9）= 100+8*10=180
    assert.equal(stats.p90, 180, `p90=${stats.p90}`);
    // 窗口: min ts=0 → maxEnd = ts(9)+elapsed(190) = 900+190=1090ms
    assert.ok(stats.throughput > 8 && stats.throughput < 10, `TPS≈9.17 实际 ${stats.throughput}`);
    assert.equal(stats.failed, 2);
    assert.deepEqual(stats.errorsTop, [{ label: "save", count: 2 }], "失败样本按标签归类（两个失败均为 save）");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 基线自动管理 ──
test("v18: auto-baseline 首次存档 → 此后自动对比 → update-baseline 人工更新", async () => {
  setupTmp();
  const dir = join(TMP, "reports");
  mkdirSync(dir, { recursive: true });
  const base = writeJtl("base.jtl", [0, 1, 2, 3, 4, 5].map((i) => `1700000000000,${100 + i * 10},sample,200,OK,t1,text,true,,512,64,1,1,${100 + i * 10},0,5`));
  const { perfCompare } = await import(pathToFileURL(join(__dirname, "..", "lib", "perf-compare.js")).href);
  const store = join(dir, "perf-baseline.json");
  try {
    // 首次：存档不对比
    const first = await perfCompare({ currentPath: base, autoBaseline: true, baselineStorePath: store });
    assert.equal(first.baselineCreated, true);
    assert.equal(first.regressed, false);
    assert.ok(existsSync(store), "基线存档应生成");
    assert.ok(JSON.parse(readFileSync(store, "utf-8")).summary.p50 === 120, "p50=120（100..150 六样本，ceil 序）");

    // 第二次（轻微波动，无劣化）：自动对比存档
    const curr2 = writeJtl("curr2.jtl", [0, 1, 2, 3, 4, 5].map((i) => `1700000000000,${105 + i * 10},sample,200,OK,t1,text,true,,512,64,1,1,${105 + i * 10},0,5`));
    const second = await perfCompare({ currentPath: curr2, autoBaseline: true, baselineStorePath: store });
    assert.equal(second.baselineCreated, undefined);
    assert.equal(second.regressed, false, JSON.stringify(second.metrics));

    // 第三次（劣化 60%）：检出且不自动更新基线
    const curr3 = writeJtl("curr3.jtl", [0, 1, 2, 3, 4, 5].map((i) => `1700000000000,${160 + i * 10},sample,200,OK,t1,text,true,,512,64,1,1,${160 + i * 10},0,5`));
    const third = await perfCompare({ currentPath: curr3, autoBaseline: true, baselineStorePath: store });
    assert.equal(third.regressed, true);
    assert.equal(third.baselineUpdated, undefined, "未显式确认不得更新基线（防慢性漂移）");
    assert.ok(JSON.parse(readFileSync(store, "utf-8")).summary.p50 === 120, "基线不被劣化结果污染");

    // 人工确认更新
    const fourth = await perfCompare({ currentPath: curr3, autoBaseline: true, updateBaseline: true, baselineStorePath: store });
    assert.equal(fourth.baselineUpdated, true);
    assert.ok(JSON.parse(readFileSync(store, "utf-8")).summary.p50 === 180);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 混合场景 jmx ──
const MIX_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v18", module: "order", entity: "Order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage" },
    create: { method: "POST", externalPath: "/order/save" },
    update: { method: "PUT", externalPath: "/order/updateById" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}" },
  },
  models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
  transport: { successCode: 2000 },
};

test("v18: --scenario mixed 生成读写权重混合 jmx（ThroughputController + 自审计通过）", async () => {
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(MIX_CONTRACT));
  try {
    const { generateJmeterScript } = await import(pathToFileURL(join(__dirname, "..", "lib", "jmeter-generator.js")).href);
    const { audit } = await import(pathToFileURL(join(__dirname, "..", "lib", "test-audit.js")).href);
    const jmx = generateJmeterScript(contract, { scenario: "mixed" });
    const jmxPath = join(TMP, "mixed.jmx");
    writeFileSync(jmxPath, jmx);

    // 三个读写操作被权重包装（remove 不参与），权重和归一为 100
    const pcts = [...jmx.matchAll(/percentThroughput">([\d.]+)</g)].map((m) => parseFloat(m[1]));
    assert.equal(pcts.length, 3, `应含 3 个 ThroughputController（page/create/update）: ${pcts}`);
    const sum = Math.round(pcts.reduce((a, b) => a + b, 0));
    assert.ok(Math.abs(sum - 100) <= 1, `权重和应为 100（实际 ${sum}）`);
    assert.ok(pcts[0] > pcts[1] && pcts[1] > pcts[2], "查询权重最高（80/15/5）");
    assert.ok(!jmx.includes("deleteById"), "remove 不参与混合压测");

    // 生成物自审计（T1-T25）
    const r = audit(jmxPath);
    assert.equal(r.pass, true, `混合场景 jmx 应通过自审计: ${JSON.stringify(r.findings.map((f) => f.rule + ":" + f.message))}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── CLI 端到端 ──
test("v18: perf-compare --auto-baseline CLI 首次存档零退出", () => {
  setupTmp();
  const jtl = writeJtl("first.jtl", [0, 1, 2, 3, 4, 5].map((i) => `1700000000000,${100 + i},sample,200,OK,t1,text,true,,512,64,1,1,${100 + i},0,5`));
  try {
    const r = spawnSync(process.execPath, [BIN, "perf-compare", "--current", jtl, "--auto-baseline"], {
      encoding: "utf-8",
      cwd: TMP,
      timeout: 30000,
    });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("基线存档") || r.stdout.includes("基线已建立") || r.stdout.includes("首次"));
    assert.ok(existsSync(join(TMP, "test-reports", "perf-baseline.json")));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
