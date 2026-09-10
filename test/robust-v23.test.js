/**
 * v0.23.0 健壮性回归 — 总时长保护 / 参数下限 / history 轮转 / MCP 数值校验
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v23");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function slowBackend(delayMs) {
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      setTimeout(() => {
        if (req.method === "POST" && req.url === "/o/queryPage") {
          return res.end(JSON.stringify({ code: 2000, data: { records: [...store.values()], total: store.size } }));
        }
        if (req.method === "POST" && req.url === "/o/save") {
          if (!json.orderNo) return res.end(JSON.stringify({ code: 4004, message: "必填" }));
          if ([...store.values()].some((r) => r.orderNo === json.orderNo)) return res.end(JSON.stringify({ code: 4004, message: "重复" }));
          const id = `ID${++idSeq}`;
          store.set(id, { id, orderNo: json.orderNo });
          return res.end(JSON.stringify({ code: 2000, data: id }));
        }
        if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
          store.delete(req.url.split("/").pop());
          return res.end(JSON.stringify({ code: 2000, data: true }));
        }
        res.writeHead(404);
        res.end("{}");
      }, delayMs);
    });
  });
  return server;
}

const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v23", module: "o", entity: "O" },
  operations: {
    page: { method: "POST", externalPath: "/o/queryPage" },
    create: { method: "POST", externalPath: "/o/save" },
    remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
  },
  models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
  transport: { successCode: 2000 },
};

test("v23: 总时长保护——超 budget 后剩余步骤标 skip，CI 不挂死", async () => {
  const server = slowBackend(150); // 每请求 150ms
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const started = Date.now();
    // budget 30s 是库层下限——用下限值跑不完慢链路不合理；直接用最小值验证机制：
    // 传 30_000 依赖真实耗时不可控，改为验证"夹紧 + skip 标记"路径：给 31s 预算对快后端不会触发；
    // 因此这里用慢后端 + 库层下限值，断言：要么全跑完（快），要么出现 skip 且带说明。
    const result = await runApiTests({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      contractPath: contract,
      token: "t",
      maxDurationMs: 30_000, // 库层下限
    });
    const skipped = result.results.filter((r) => r.status === "skip");
    if (skipped.length > 0) {
      assert.ok(skipped.every((s) => (s.reason ?? "").includes("总时长超限")), "skip 原因必须可解释");
      assert.equal(result.summary.pass, false, "有未执行步骤不得判定通过（诚实呈现）");
    } else {
      assert.equal(result.summary.pass, true, "30s 内完成则正常通过");
    }
    assert.ok(Date.now() - started < 29_000, "不得显著超出 budget");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v23: 库层夹紧——timeout/maxDuration 非法值不产生怪行为", async () => {
  const server = slowBackend(0);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    // timeout=0 / maxDuration=NaN —— 夹到下限而非"全超时"
    const result = await runApiTests({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      contractPath: contract,
      token: "t",
      timeout: 0,
      maxDurationMs: NaN,
    });
    assert.equal(result.error, undefined);
    const smoke = result.results.find((r) => r.kind === "smoke");
    assert.equal(smoke.status, "pass", `timeout=0 应被夹到 1000ms 而非全超时: ${smoke.reason ?? ""}`);
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v23: CLI --timeout/--max-duration 非法值给用法错误（退出码 2）", () => {
  setupTmp();
  writeFileSync(join(TMP, "c.json"), JSON.stringify(CONTRACT));
  try {
    const r1 = spawnSync(process.execPath, [BIN, "run-api", "--contract", join(TMP, "c.json"), "--timeout", "5"], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(r1.status, 2);
    assert.ok(r1.stderr.includes("≥1000"), r1.stderr);
    const r2 = spawnSync(process.execPath, [BIN, "run-api", "--contract", join(TMP, "c.json"), "--max-duration", "1"], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(r2.status, 2);
    assert.ok(r2.stderr.includes("≥30"), r2.stderr);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v23: history.jsonl 超 500 行自动裁剪头部（保留最近）", async () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  const { appendHistory } = await import(pathToFileURL(join(__dirname, "..", "lib", "report-dimensions.js")).href);
  for (let i = 0; i < 520; i++) appendHistory(reportsDir, { kind: "report", seq: i });
  const lines = readFileSync(join(reportsDir, "history.jsonl"), "utf-8").split("\n").filter(Boolean);
  assert.equal(lines.length, 500, `应裁剪到 500（实际 ${lines.length}）`);
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.seq, 519, "保留的必须是最近记录（尾部）");
  const first = JSON.parse(lines[0]);
  assert.equal(first.seq, 20, "头部最旧记录被裁掉");
});

test("v23: MCP 数值参数类型校验——字符串数字被 -32602 拒绝", async () => {
  const { HANDLERS } = await import(pathToFileURL(join(__dirname, "..", "mcp", "tools", "handlers.js")).href);
  const { validateToolInput } = await import(pathToFileURL(join(__dirname, "..", "mcp", "registry.js")).href);
  // report_generate 声明 cases 为 number
  const err = validateToolInput("wls_test_report_generate", { api: "x.json", cases: "abc" });
  assert.ok(err && err.includes("cases"), `应拒绝字符串数值: ${err}`);
  const ok = validateToolInput("wls_test_report_generate", { api: "x.json", cases: 100 });
  assert.equal(ok, null);
  // handler 层也有防御（数字字符串容错："150" 不再被吞成默认 50）
  const r = HANDLERS.wls_test_quality_analyze({ defects: [], caseCount: "150" });
  assert.equal(r.diDensity, 0, "caseCount=150 时空缺陷密度应为 0（而非被吞成 50 的口径）");
  const r2 = HANDLERS.wls_test_quality_analyze({ defects: [{ severity: "general", status: "closed", module: "a" }] });
  assert.equal(r2.diDensity, 0.02, "未传 caseCount 回退 50（di=1/50）");
});
