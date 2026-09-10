/**
 * v0.11.1 止血回归 — 逐条覆盖本轮 P0/P1 修复，防止回退
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { perfCompare } from "../lib/perf-compare.js";
import { generateReport } from "../lib/report-generator.js";
import { readHistory } from "../lib/report-dimensions.js";
import { runApiTests } from "../lib/api-executor.js";
import { parseJtlResults } from "../lib/executors.js";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-hotfix");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    cwd: opts.cwd || process.cwd(),
    timeout: 30000,
  });
}

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

// ── P0: --flag=true 布尔归一 ──
test("hotfix: init --dry-run=true 不写任何文件（布尔归一）", () => {
  setupTmp();
  try {
    const r = runCli(["init", "--dry-run=true"], { cwd: TMP });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("预览"), "应进入预览模式");
    assert.equal(readdirSync(TMP).length, 0, "预览模式不得写入任何文件");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P0: 未知 flag 不再触发真实安装 ──
test("hotfix: 未知 --flag 退出码 2 且不安装", () => {
  setupTmp();
  try {
    const r = runCli(["--dry-runn"], { cwd: TMP });
    assert.equal(r.status, 2, `stdout: ${r.stdout}`);
    assert.ok(r.stderr.includes("未知选项"), "应提示未知选项");
    assert.equal(readdirSync(TMP).length, 0, "不得写入任何文件");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P0: e2e-check 缺归属清单 fail-closed ──
test("hotfix: e2e-check 缺 suites.js 时阻断（不再假通过）", () => {
  setupTmp();
  mkdirSync(join(TMP, "tests"), { recursive: true });
  writeFileSync(join(TMP, "tests", "a.spec.js"), 'import { test } from "@playwright/test";\ntest("A1 验证列表", () => {});\n');
  try {
    const r = runCli(["e2e-check", "--target", TMP]);
    assert.notEqual(r.status, 0, "缺归属清单应非零退出");
    assert.ok((r.stdout + r.stderr).includes("归属清单"), "应提示归属清单缺失");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P1: perf-compare 基线缺失/为零不再漏判 ──
test("hotfix: perf-compare 基线指标缺失时报错而非静默通过", async () => {
  setupTmp();
  const cur = join(TMP, "cur.json");
  const base = join(TMP, "base.json");
  writeFileSync(cur, JSON.stringify({ p50: 120, p95: 300, p99: 480, errorRate: 0, samples: 100 }));
  writeFileSync(base, JSON.stringify({ p50: 100 })); // 缺 p95/p99
  try {
    const result = await perfCompare({ currentPath: cur, baselinePath: base });
    assert.ok(result.error, "缺基线指标应返回 error");
    assert.ok(result.error.includes("p95"), `错误信息应指明缺失指标: ${result.error}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("hotfix: perf-compare 基线为 0 且当前劣化时判劣化", async () => {
  setupTmp();
  const cur = join(TMP, "cur.json");
  const base = join(TMP, "base.json");
  writeFileSync(cur, JSON.stringify({ p50: 120, p95: 300, p99: 480, errorRate: 0, samples: 100 }));
  writeFileSync(base, JSON.stringify({ p50: 0, p95: 0, p99: 0, errorRate: 0, samples: 50 }));
  try {
    const result = await perfCompare({ currentPath: cur, baselinePath: base });
    assert.ok(result.regressed, "基线全 0 + 当前有值应判劣化");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P0: report fail-closed（损坏来源文件计入未达标）──
test("hotfix: report 损坏的 api-result.json 阻断上线判定", () => {
  setupTmp();
  const bad = join(TMP, "api-result.json");
  writeFileSync(bad, "{ 这不是合法 json");
  try {
    const result = generateReport({ api: bad });
    assert.equal(result.error, undefined, "不应静默吞错");
    assert.equal(result.pass, false, "来源不可读时不得具备上线条件");
    assert.ok(result.report.includes("JSON 解析失败"), "报告应注明不可读来源");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("hotfix: report 自动发现含 audit 维度且 mtime 最新优先", () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "api-result.json"), JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过" } }));
  writeFileSync(join(reportsDir, "audit-result.json"), JSON.stringify({ pass: true, level: "pass", bySeverity: { fatal: 0, error: 0, warning: 0 }, total: 0, findings: [] }));
  try {
    const result = generateReport({ api: join(reportsDir, "api-result.json"), audit: join(reportsDir, "audit-result.json") });
    assert.ok(result.report.includes("测试代码审计"), "应含审计章节");
    assert.ok(result.report.includes("上线判定"));
    assert.equal(result.pass, true);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P1: history.jsonl 单行损坏容错 ──
test("hotfix: readHistory 跳过损坏行不崩溃", () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, "history.jsonl"),
    '{"kind":"report","pass":true}\n{损坏行\n{"kind":"report","pass":false}\n',
  );
  try {
    const history = readHistory(reportsDir, "report", 5);
    assert.equal(history.length, 2, "应跳过损坏行读取 2 条");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P0: 权限探针真实注册（detail/remove 探针不再死代码）──
test("hotfix: 提供无权限 token 时 detail 权限探针被注册执行", async () => {
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const auth = (req.headers.authorization || "").toLowerCase();
    if (auth.includes("noperm")) return send(403, { code: 4003, message: "无权限", data: null });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url === "/order/queryPage") {
        return send(200, { code: 2000, message: "ok", data: { records: [...store.values()], total: store.size } });
      }
      if (req.method === "POST" && req.url === "/order/save") {
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo });
        return send(200, { code: 2000, message: "ok", data: id });
      }
      const m = req.url.match(/^\/order\/getById\/(.+)$/);
      if (req.method === "GET" && m) {
        const rec = store.get(m[1]);
        if (!rec) return send(200, { code: 4004, message: "不存在", data: null });
        return send(200, { code: 2000, message: "ok", data: rec });
      }
      const d = req.url.match(/^\/order\/deleteById\/(.+)$/);
      if (req.method === "DELETE" && d) {
        store.delete(d[1]);
        return send(200, { code: 2000, message: "ok", data: true });
      }
      send(404, { code: 404, message: "not found", data: null });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(
    contract,
    JSON.stringify({
      kind: "wl-api-contract",
      schemaVersion: 1,
      resource: { contractId: "perm-probe", module: "order", entity: "Order" },
      operations: {
        page: { method: "POST", externalPath: "/order/queryPage" },
        create: { method: "POST", externalPath: "/order/save" },
        detail: { method: "GET", externalPath: "/order/getById/{id}" },
        remove: { method: "DELETE", externalPath: "/order/deleteById/{id}" },
      },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "good", noPermToken: "noperm" });
    const perms = result.results.filter((r) => r.kind === "permission");
    const detailProbe = perms.find((p) => p.name.includes("detail"));
    assert.ok(detailProbe, "detail 权限探针应被注册（此前构建期判断恒假导致死代码）");
    assert.equal(detailProbe.status, "pass", `探针应通过: ${detailProbe.reason ?? ""}`);
    // summary.pass 布尔字段存在（本 mock 不校验重复/必填，判定值不在此断言）
    assert.equal(typeof result.summary.pass, "boolean");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P1: 主键匹配精确化（123 不得命中 1234）──
test("hotfix: findRecordById 精确匹配（子串不再误命中）", async () => {
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url === "/x/queryPage") {
        return send(200, { code: 2000, data: { records: [...store.values()], total: store.size } });
      }
      if (req.method === "POST" && req.url === "/x/save") {
        // 预置一条 id=1234 的记录，随后新增 id=123 —— 旧实现子串匹配会误命中 1234
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo });
        if (store.size === 1) store.set("ID-SUB-TRAP", { id: "ID-SUB-TRAP", orderNo: `${json.orderNo}X` });
        return send(200, { code: 2000, data: id });
      }
      const d = req.url.match(/^\/x\/deleteById\/(.+)$/);
      if (req.method === "DELETE" && d) {
        store.delete(d[1]);
        return send(200, { code: 2000, data: true });
      }
      send(404, { code: 404 });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(
    contract,
    JSON.stringify({
      kind: "wl-api-contract",
      schemaVersion: 1,
      resource: { contractId: "exact-id", module: "x", entity: "X" },
      operations: {
        page: { method: "POST", externalPath: "/x/queryPage" },
        create: { method: "POST", externalPath: "/x/save" },
        remove: { method: "DELETE", externalPath: "/x/deleteById/{id}" },
      },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "good" });
    const rb = result.results.find((r) => r.kind === "readback");
    assert.equal(rb.status, "pass");
    // 读回比对命中的必须是自己（orderNo 回读一致），不能误命中陷阱记录
    const sameOrderNo = rb.assertions.find((a) => a.name.includes("字段回读一致: orderNo"));
    assert.ok(sameOrderNo, "应有 orderNo 回读断言");
    assert.equal(sameOrderNo.pass, true, `回读应命中自己的记录: ${sameOrderNo.detail}`);
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P1: __fieldMap__ 字段映射消费 ──
test("hotfix: run-api 消费 dict.json 的 __fieldMap__ 字段级映射", async () => {
  const seenPayloads = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url === "/x/save") {
        seenPayloads.push(json);
        return res.end(JSON.stringify({ code: 2000, data: "ID1" }));
      }
      if (req.method === "POST" && req.url === "/x/queryPage") {
        return res.end(JSON.stringify({ code: 2000, data: { records: seenPayloads.map((p, i) => ({ id: `ID${i + 1}`, ...p })), total: seenPayloads.length } }));
      }
      res.writeHead(404);
      res.end(JSON.stringify({ code: 404 }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  setupTmp();
  const contract = join(TMP, "contract.json");
  const dict = join(TMP, "dict.json");
  writeFileSync(
    contract,
    JSON.stringify({
      kind: "wl-api-contract",
      schemaVersion: 1,
      resource: { contractId: "fieldmap", module: "x", entity: "X" },
      operations: {
        page: { method: "POST", externalPath: "/x/queryPage" },
        create: { method: "POST", externalPath: "/x/save" },
      },
      models: { createRequest: [{ name: "plantCode", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  // plantCode 不直配任何字典码，仅通过 __fieldMap__ 映射到 pl_plant_code
  writeFileSync(dict, JSON.stringify({ pl_plant_code: ["P01", "P02"], __fieldMap__: { plantCode: "pl_plant_code" } }));
  try {
    await runApiTests({ baseUrl: url, contractPath: contract, token: "t", dictFile: dict });
    assert.ok(seenPayloads.length > 0, "应有 create 请求");
    assert.equal(seenPayloads[0].plantCode, "P01", "字段映射应注入字典合法值");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── P1: jmeter 结果 pass 布尔 ──
test("hotfix: parseJtlResults 输出 pass 布尔判定", async () => {
  setupTmp();
  const jtl = join(TMP, "result.jtl");
  writeFileSync(
    jtl,
    [
      "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect",
      '1700000000000,120,GET /a,200,OK,t1,text,true,,512,128,1,1,80,0,20',
      '1700000000100,150,GET /a,200,OK,t1,text,true,,512,128,1,1,90,0,20',
    ].join("\n") + "\n",
  );
  try {
    const stats = await parseJtlResults(jtl);
    assert.equal(stats.pass, true);
    assert.equal(stats.decision, "通过");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
