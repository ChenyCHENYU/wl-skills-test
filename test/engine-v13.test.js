/**
 * v0.13.0 引擎层回归 — jtl 流式解析 / 审计规则表 / run-api 重试与并行
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { parseJtlResults } from "../lib/executors.js";
import { audit, RULES } from "../lib/test-audit.js";
import { runApiTests } from "../lib/api-executor.js";

const TMP = join(process.cwd(), ".tmp-engine-v13");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

// ── jtl 流式解析：大数据量基准与正确性 ──
test("engine: 200k 行 jtl 流式解析（内存友好 + 分位数正确）", async () => {
  setupTmp();
  const ROWS = 200_000;
  const header = "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect";
  const lines = [header];
  for (let i = 0; i < ROWS; i++) {
    // elapsed 在 1..100 均匀分布，每 1000 行一个 500 的长尾
    const elapsed = i % 1000 === 999 ? 500 : (i % 100) + 1;
    lines.push(`1700000000000,${elapsed},sample,200,OK,t1,text,true,,512,64,1,1,${elapsed},0,5`);
  }
  const jtl = join(TMP, "big.jtl");
  writeFileSync(jtl, lines.join("\n") + "\n");
  try {
    const started = Date.now();
    const stats = await parseJtlResults(jtl);
    const elapsedMs = Date.now() - started;
    assert.equal(stats.samples, ROWS);
    assert.equal(stats.passed, ROWS);
    assert.equal(stats.failed, 0);
    // 分布：值 1..99 各 2000 次 + 值 100 出现 1800 次 + 长尾 500 出现 200 次
    // p50=50（累计 10 万）；p99=99（累计恰达 19.8 万，长尾 0.1% 不进 p99）
    assert.ok(stats.p50 >= 49 && stats.p50 <= 51, `p50=${stats.p50}`);
    assert.equal(stats.p99, 99, `p99=${stats.p99}`);
    assert.equal(stats.pass, true);
    // 基准：200k 行应在数秒内完成（流式实现；旧的整文件+全排序实现慢且吃内存）
    assert.ok(elapsedMs < 15000, `解析耗时 ${elapsedMs}ms`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("engine: jtl CSV 双写引号转义（failureMessage 含引号逗号）", async () => {
  setupTmp();
  const jtl = join(TMP, "quote.jtl");
  writeFileSync(
    jtl,
    [
      "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,Latency,IdleTime,Connect",
      '1700000000000,120,sample,200,OK,t1,text,false,"assert ""failed"", code=5000",512,64,1,1,80,0,5',
      "1700000000100,150,sample,200,OK,t1,text,true,,512,64,1,1,90,0,5",
    ].join("\n") + "\n",
  );
  try {
    const stats = await parseJtlResults(jtl);
    assert.equal(stats.samples, 2);
    assert.equal(stats.failed, 1); // 引号内逗号不再错位到 success 列
    assert.equal(stats.passed, 1);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 审计规则表：元数据完整性与精准化修复 ──
test("engine: 规则表元数据完整（id 唯一 / severity 合法 / 三类目标齐全）", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "规则 id 不得重复");
  for (const r of RULES) {
    assert.ok(["fatal", "error", "warning", "info"].includes(r.severity), `${r.id} severity 非法`);
    assert.ok(r.desc && r.desc.length > 5, `${r.id} 缺描述`);
  }
  for (const target of ["playwright", "jmeter", "cases"]) {
    assert.ok(RULES.some((r) => r.target === target), `目标 ${target} 应有规则`);
  }
});

test("engine: T13 __CSVRead 函数参数化不再误报（fatal 误伤修复）", () => {
  setupTmp();
  const jmx = `<jmeterTestPlan><hashTree>
    <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup">
      <intProp name="ThreadGroup.num_threads">10</intProp>
      <intProp name="ThreadGroup.ramp_time">5</intProp>
      <elementProp name="ThreadGroup.main_controller" elementType="LoopController"><intProp name="LoopController.loops">1</intProp></elementProp>
    </ThreadGroup>
    <HTTPSamplerProxy><stringProp name="Argument.value">\${__CSVRead(data.txt,0)}</stringProp></HTTPSamplerProxy>
  </hashTree></jmeterTestPlan>`;
  writeFileSync(join(TMP, "csvread.jmx"), jmx);
  try {
    const r = audit(join(TMP, "csvread.jmx"));
    assert.ok(!r.findings.some((f) => f.rule === "T13"), "__CSVRead 参数化应豁免 T13");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("engine: T14 注释里出现 loops 字样不再豁免（假阴性修复）", () => {
  setupTmp();
  const jmx = `<jmeterTestPlan><!-- 注释里提到 loops 但没有循环控制器 -->
    <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup">
      <intProp name="ThreadGroup.num_threads">10</intProp>
      <intProp name="ThreadGroup.ramp_time">5</intProp>
    </ThreadGroup>
  </jmeterTestPlan>`;
  writeFileSync(join(TMP, "comment-loops.jmx"), jmx);
  try {
    const r = audit(join(TMP, "comment-loops.jmx"));
    assert.ok(r.findings.some((f) => f.rule === "T14"), "无 LoopController 配置应触发 T14");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("engine: T18 ramp_time=0 被检出（瞬时打满修复）", () => {
  setupTmp();
  const jmx = `<jmeterTestPlan><hashTree>
    <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup">
      <intProp name="ThreadGroup.num_threads">100</intProp>
      <intProp name="ThreadGroup.ramp_time">0</intProp>
      <elementProp name="ThreadGroup.main_controller" elementType="LoopController"><intProp name="LoopController.loops">1</intProp></elementProp>
    </ThreadGroup>
  </hashTree></jmeterTestPlan>`;
  writeFileSync(join(TMP, "ramp0.jmx"), jmx);
  try {
    const r = audit(join(TMP, "ramp0.jmx"));
    const t18 = r.findings.find((f) => f.rule === "T18");
    assert.ok(t18, "ramp_time=0 应触发 T18");
    assert.ok(t18.message.includes("0"), `信息应说明 ramp_time=0: ${t18.message}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── run-api 网络重试 ──
test("engine: 幂等读抖动重试——首次连接被切断后冒烟仍通过", async () => {
  let requestCount = 0;
  const server = createServer((req, res) => {
    requestCount++;
    if (requestCount === 1) {
      // 首个请求直接断连（模拟网络抖动），重试应恢复
      req.socket.destroy();
      return;
    }
    if (req.url === "/order/queryPage") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 2000, data: { records: [], total: 0 } }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ code: 404 }));
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
      resource: { contractId: "retry-test", module: "order", entity: "Order" },
      operations: { page: { method: "POST", externalPath: "/order/queryPage" } },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const smoke = result.results.find((r) => r.kind === "smoke");
    assert.equal(smoke.status, "pass", `抖动一次后冒烟应通过重试恢复: ${smoke.reason ?? ""}`);
    assert.ok(requestCount >= 2, "应发生重试");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── run-api 并行执行 ──
test("engine: 负例/权限步骤并行执行且结果顺序稳定", async () => {
  // 用慢 mock 度量并发：每个请求延迟 120ms；若 4 个探针串行 ≥480ms，并行 ~120-240ms
  let maxConcurrent = 0;
  let active = 0;
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    active++;
    maxConcurrent = Math.max(maxConcurrent, active);
    const auth = (req.headers.authorization || "").toLowerCase();
    const finish = (status, payload) => {
      setTimeout(() => {
        active--;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      }, 120);
    };
    if (auth.includes("noperm")) return finish(403, { code: 4003, message: "无权限", data: null });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url === "/o/queryPage") {
        return finish(200, { code: 2000, data: { records: [...store.values()], total: store.size } });
      }
      if (req.method === "POST" && req.url === "/o/save") {
        if (!json.orderNo) return finish(200, { code: 4004, message: "必填" });
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo });
        return finish(200, { code: 2000, data: id });
      }
      const d = req.url.match(/^\/o\/deleteById\/(.+)$/);
      if (req.method === "DELETE" && d) {
        store.delete(d[1]);
        return finish(200, { code: 2000, data: true });
      }
      finish(404, { code: 404 });
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
      resource: { contractId: "parallel-test", module: "o", entity: "O" },
      operations: {
        page: { method: "POST", externalPath: "/o/queryPage" },
        create: { method: "POST", externalPath: "/o/save" },
        remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
      },
      models: {
        createRequest: [
          { name: "orderNo", required: true, type: "string", constraints: { maxLength: 32 } },
        ],
      },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const started = Date.now();
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "good", noPermToken: "noperm" });
    const wall = Date.now() - started;
    const ids = result.results.map((r) => r.id);
    assert.deepEqual(ids, [...ids].sort(), "结果必须按步骤定义顺序输出");
    assert.ok(maxConcurrent >= 2, `应观察到并发（实际峰值 ${maxConcurrent}）`);
    // 负例(必填) + 权限探针(page) 至少 2 个并行步骤 ×120ms —— 串行会远超此值
    // （v20/v22 后步骤增多：notfound/idempotent/query-combine 探针，串行预算相应放宽）
    assert.ok(wall < 6000, `整体耗时 ${wall}ms 应明显低于串行总和`);
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});
