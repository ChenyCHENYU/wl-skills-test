/**
 * v0.17.0 有效性回归 — 更新生效验证 / 非法枚举负例 / 并发重复探针 / 契约 diff / MCP diff 工具
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
const TMP = join(process.cwd(), ".tmp-v17");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

/** 可配置行为的 mini 后端：validateRequired/rejectDup/applyUpdate/enumValidate 开关 + 全程记录 */
function makeBackend({ validateRequired = true, rejectDup = true, applyUpdate = true, enumValidate = false } = {}) {
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
      if (req.method === "POST" && req.url === "/o/queryPage") {
        return send(200, { code: 2000, data: { records: [...store.values()], total: store.size } });
      }
      if (req.method === "POST" && req.url === "/o/save") {
        if (validateRequired && (!json.orderNo || !json.orderName)) return send(200, { code: 4004, message: "必填" });
        if (enumValidate && json.status === "__WL_INVALID_ENUM__") return send(200, { code: 4004, message: "非法枚举" });
        if (rejectDup && [...store.values()].some((r) => r.orderNo === json.orderNo)) return send(200, { code: 4004, message: "重复" });
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo, orderName: json.orderName, status: json.status });
        return send(200, { code: 2000, data: id });
      }
      if (req.method === "PUT" && req.url === "/o/updateById") {
        if (!store.has(json.id)) return send(200, { code: 4004, message: "不存在", data: null });
        if (applyUpdate) {
          const rec = store.get(json.id);
          const { orderNo: _businessKeyImmutable, ...rest } = json; // 业务键更新时不可变（真实系统约束）
          store.set(json.id, { ...rec, ...rest });
        }
        return send(200, { code: 2000, data: true });
      }
      const d = req.url.match(/^\/o\/getById\/(.+)$/);
      if (req.method === "GET" && d) {
        const rec = store.get(d[1]);
        if (!rec) return send(200, { code: 4004, message: "不存在", data: null });
        return send(200, { code: 2000, data: rec });
      }
      if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
        store.delete(req.url.split("/").pop());
        return send(200, { code: 2000, data: true });
      }
      send(404, { code: 404 });
    });
  });
  return { server, store };
}

const FULL_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v17", module: "o", entity: "O" },
  operations: {
    page: { method: "POST", externalPath: "/o/queryPage" },
    create: { method: "POST", externalPath: "/o/save" },
    update: { method: "PUT", externalPath: "/o/updateById" },
    detail: { method: "GET", externalPath: "/o/getById/{id}" },
    remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
  },
  models: {
    createRequest: [
      { name: "orderNo", required: true, type: "string" },
      { name: "orderName", required: true, type: "string" },
      { name: "status", required: false, type: "string", enum: "pl_status" },
    ],
  },
  transport: { successCode: 2000 },
};

async function start(backend) {
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${backend.server.address().port}`;
}

// ── 更新生效验证 ──
test("v17: 更新被后端忽略时'更新生效回读'失败并给出诊断", async () => {
  const backend = makeBackend({ applyUpdate: false }); // 模拟 update 不落库
  const url = await start(backend);
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(FULL_CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const detail = result.results.find((r) => r.kind === "detail");
    const updAssert = detail.assertions.find((a) => a.name.startsWith("更新生效回读一致"));
    assert.ok(updAssert, "应包含更新生效断言");
    assert.equal(updAssert.pass, false, "update 不落库应被检出");
    assert.ok(detail.hint, "失败应附诊断指引");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v17: 正常后端更新生效回读通过（差异化字段被持久化）", async () => {
  const backend = makeBackend({});
  const url = await start(backend);
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(FULL_CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const detail = result.results.find((r) => r.kind === "detail");
    assert.ok(detail.assertions.filter((a) => a.name.startsWith("更新生效回读一致")).every((a) => a.pass), detail.reason ?? "");
    assert.equal(result.summary.pass, true, JSON.stringify(result.results.filter((r) => r.status !== "pass").map((r) => r.reason)));
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 非法枚举负例 ──
test("v17: dict 注入字段自动执行非法枚举负例（枚举校验缺口被检出）", async () => {
  const backend = makeBackend({ enumValidate: false }); // 后端不校验枚举
  const url = await start(backend);
  setupTmp();
  const contract = join(TMP, "c.json");
  const dict = join(TMP, "dict.json");
  writeFileSync(contract, JSON.stringify(FULL_CONTRACT));
  writeFileSync(dict, JSON.stringify({ pl_status: ["S1", "S2"], __fieldMap__: {} }));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t", dictFile: dict });
    const enumNeg = result.results.find((r) => r.kind === "negative" && r.name.includes("非法枚举"));
    assert.ok(enumNeg, "应执行非法枚举负例（dict 已提供合法值）");
    assert.equal(enumNeg.status, "fail", "后端无枚举校验应被检出");
    assert.ok(enumNeg.hint.includes("校验缺口"));
    assert.equal(result.summary.dimensionCoverage["field-enum"].executed >= 1, true);
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 并发重复探针 ──
test("v17: 并发重复提交——无唯一约束的后端被检出（race 窗口污染）", async () => {
  const backend = makeBackend({ rejectDup: false }); // 无重复拦截 → 并发 5 发全落库
  const url = await start(backend);
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(FULL_CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const conc = result.results.find((r) => r.kind === "duplicate-concurrent");
    assert.ok(conc, "应执行并发重复探针");
    assert.equal(conc.status, "fail", "无唯一约束应被检出");
    assert.ok(conc.reason.includes("重复主键"), conc.reason);
    assert.ok(conc.hint.includes("唯一索引"), "应给出数据库唯一索引的修复指引");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v17: 有唯一约束的后端并发重复探针通过", async () => {
  const backend = makeBackend({ rejectDup: true });
  const url = await start(backend);
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(FULL_CONTRACT));
  try {
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const conc = result.results.find((r) => r.kind === "duplicate-concurrent");
    assert.equal(conc.status, "pass", conc.reason ?? "");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 契约 diff（CLI + MCP）──
const OLD_CONTRACT = {
  ...FULL_CONTRACT,
  models: {
    createRequest: [
      { name: "orderNo", required: true, type: "string" },
      { name: "orderName", required: true, type: "string" },
      { name: "amount", required: false, type: "number" },
    ],
  },
};

test("v17: 契约 diff 输出变更明细与受影响用例", async () => {
  setupTmp();
  writeFileSync(join(TMP, "old.json"), JSON.stringify(OLD_CONTRACT));
  writeFileSync(join(TMP, "new.json"), JSON.stringify(FULL_CONTRACT));
  try {
    const { diffContracts } = await import(pathToFileURL(join(__dirname, "..", "lib", "contract-diff.js")).href);
    const r = diffContracts(join(TMP, "old.json"), join(TMP, "new.json"));
    // amount 删除、status 新增
    assert.ok(r.changes.some((c) => c.level === "field" && c.type === "removed" && c.target === "amount"));
    assert.ok(r.changes.some((c) => c.level === "field" && c.type === "added" && c.target === "status"));
    // 受影响：amount 关联的细粒度用例需重跑/作废
    assert.ok(r.affected.changedFields.includes("amount") && r.affected.changedFields.includes("status"));
    assert.ok(r.affected.removedCases.length > 0, "作废用例应非空（amount 相关）");
    assert.ok(r.markdown.includes("契约变更影响面"));

    // CLI 端到端
    const cli = spawnSync(process.execPath, [BIN, "diff", "--old", join(TMP, "old.json"), "--new", join(TMP, "new.json")], {
      encoding: "utf-8",
      cwd: TMP,
      timeout: 30000,
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.ok(cli.stdout.includes("用例影响"));
    assert.ok(existsSync(join(TMP, "test-reports", "契约变更影响面.md")));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v17: MCP wls_test_contract_diff 返回紧凑结构化结果", async () => {
  setupTmp();
  writeFileSync(join(TMP, "old.json"), JSON.stringify(OLD_CONTRACT));
  writeFileSync(join(TMP, "new.json"), JSON.stringify(FULL_CONTRACT));
  try {
    const { HANDLERS } = await import(pathToFileURL(join(__dirname, "..", "mcp", "tools", "handlers.js")).href);
    const r = HANDLERS.wls_test_contract_diff({ oldPath: join(TMP, "old.json"), newPath: join(TMP, "new.json") });
    assert.equal(r.error, undefined);
    assert.ok(Array.isArray(r.changes) && r.changes.length > 0);
    assert.ok(r.affectedCounts.removed >= 1);
    assert.equal(r.markdown, undefined, "默认不内联 markdown 全文（token 经济）");
    assert.ok(r.hint.includes("run-api"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
