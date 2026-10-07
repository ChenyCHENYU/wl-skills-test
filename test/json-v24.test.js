/**
 * v0.24.0 产物 JSON 化回归 — 用例/diff/perf 的 --json 输出 / report --plan-input / case_generate 紧凑
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v24");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}
function runCli(args, cwd = TMP) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8", cwd, timeout: 30000 });
}

const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v24", module: "order", entity: "Order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage" },
    create: { method: "POST", externalPath: "/order/save" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}" },
  },
  models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
  transport: { successCode: 2000 },
};

test("v24: run-gen cases --json 输出结构化用例（平台/AI 消费零失真）", () => {
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  const out = join(TMP, "cases.md");
  const jsonOut = join(TMP, "cases.json");
  try {
    const r = runCli(["run-gen", "--contract", contract, "--granularity", "field", "--output", out, "--json", jsonOut]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(jsonOut));
    const data = JSON.parse(readFileSync(jsonOut, "utf-8"));
    assert.equal(data.entity, "Order");
    assert.ok(Array.isArray(data.cases) && data.cases.length > 0);
    assert.ok(Array.isArray(data.fineCases) && data.fineCases.length > 0);
    assert.ok(data.cases[0].id && data.cases[0].name);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v24: diff --json 输出变更/受影响用例结构", () => {
  setupTmp();
  const oldC = { ...CONTRACT, models: { createRequest: [{ name: "orderNo", required: true, type: "string" }, { name: "amount", required: false, type: "number" }] } };
  writeFileSync(join(TMP, "old.json"), JSON.stringify(oldC));
  writeFileSync(join(TMP, "new.json"), JSON.stringify(CONTRACT));
  const jsonOut = join(TMP, "diff.json");
  try {
    const r = runCli(["diff", "--old", join(TMP, "old.json"), "--new", join(TMP, "new.json"), "--json", jsonOut]);
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(readFileSync(jsonOut, "utf-8"));
    assert.ok(Array.isArray(data.changes) && data.changes.some((c) => c.target === "amount"));
    assert.ok(data.affected && Array.isArray(data.affected.removedCases));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v24: perf-compare --json 输出判定与指标", () => {
  setupTmp();
  const header = "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect";
  const mk = (name, base) => join(TMP, name);
  const rows = (b) => [0, 1, 2, 3, 4, 5].map((i) => `1700000000000,${b + i * 10},sample,200,OK,t1,text,true,,512,64,1,1,${b + i * 10},0,5`);
  writeFileSync(mk("a.jtl"), [header, ...rows(100)].join("\n") + "\n");
  writeFileSync(mk("b.jtl"), [header, ...rows(150)].join("\n") + "\n");
  const jsonOut = join(TMP, "cmp.json");
  try {
    const r = runCli(["perf-compare", "--current", mk("b.jtl"), "--baseline", mk("a.jtl"), "--json", jsonOut]);
    assert.equal(r.status, 1, "劣化退出码 1");
    const data = JSON.parse(readFileSync(jsonOut, "utf-8"));
    assert.equal(data.regressed, true);
    assert.ok(Array.isArray(data.metrics) && data.metrics.length >= 4);
    assert.ok(data.summary.verdict.includes("劣化"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v24: report --plan-input 聚合历史/本次/各维度摘要（AI 写测试计划的数据侧）", () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "api-result.json"), JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过", dimensionCoverage: { "field-required": { executed: 1, passed: 1 } } } }));
  writeFileSync(join(reportsDir, "audit-result.json"), JSON.stringify({ pass: true, level: "green", bySeverity: { fatal: 0, error: 0, warning: 1 }, byRule: { T2: 1 }, total: 1 }));
  try {
    const r = runCli(["report", "--plan-input", "--allow-legacy"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const planPath = join(reportsDir, "plan-input.json");
    assert.ok(existsSync(planPath));
    const data = JSON.parse(readFileSync(planPath, "utf-8"));
    assert.equal(data.current.pass, false);
    assert.ok(data.current.score !== undefined);
    assert.deepEqual(data.apiDimensionCoverage["field-required"], { executed: 1, passed: 1 });
    assert.equal(data.auditDigest.bySeverity.warning, 1);
    assert.ok(Array.isArray(data.history) && data.history.length >= 1, "含本次历史");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
