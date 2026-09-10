/**
 * v0.22.0 内在深化回归 — 数值边界负例 / 组合查询收敛 / 严格成功码 / swagger v2 basePath+token+响应模型 / baseline-compare / MCP gen_contract
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(process.cwd(), ".tmp-v22");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

/** 支持范围校验/查询过滤的 mini 后端 */
function makeBackend({ enforceRange = true, ignoreQueryB = false } = {}) {
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      const send = (code, data, message = "ok") => res.end(JSON.stringify({ code, message, data }));
      if (req.method === "POST" && req.url === "/o/queryPage") {
        let records = [...store.values()];
        // 查询过滤（ignoreQueryB=true 时 B 条件被忽略——模拟"查询没生效"缺陷）
        const q = json;
        if (q.orderNo !== undefined && q.orderNo !== null && q.orderNo !== "") records = records.filter((r) => r.orderNo === q.orderNo);
        if (!ignoreQueryB && q.orderName !== undefined && q.orderName !== null && q.orderName !== "") records = records.filter((r) => r.orderName === q.orderName);
        return send(2000, { records, total: records.length });
      }
      if (req.method === "POST" && req.url === "/o/save") {
        if (!json.orderNo || !json.orderName) return send(4004, null, "必填");
        if ([...store.values()].some((r) => r.orderNo === json.orderNo)) return send(4004, null, "重复");
        if (enforceRange && json.amount !== undefined && (json.amount < 0 || json.amount > 1000)) return send(4004, null, "范围越界");
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo, orderName: json.orderName, amount: json.amount });
        return send(2000, id);
      }
      if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
        store.delete(req.url.split("/").pop());
        return send(2000, true);
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  return { server, store };
}

const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v22", module: "o", entity: "O" },
  operations: {
    page: { method: "POST", externalPath: "/o/queryPage" },
    create: { method: "POST", externalPath: "/o/save" },
    remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
  },
  models: {
    createRequest: [
      { name: "orderNo", required: true, type: "string" },
      { name: "orderName", required: true, type: "string" },
      { name: "amount", required: false, type: "number", constraints: { min: 0, max: 1000 } },
    ],
    queryRequest: [{ name: "orderNo" }, { name: "orderName" }],
  },
  transport: { successCode: 2000 },
};

async function run(url, contractPath, extra = {}) {
  const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
  return runApiTests({ baseUrl: url, contractPath, token: "t", ...extra });
}

test("v22: 数值边界负例自动执行（min-1/max+1 被拒），声明↔执行对齐", async () => {
  const backend = makeBackend({});
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const bounds = result.results.filter((r) => r.kind === "negative" && r.name.includes("数值越界"));
    assert.equal(bounds.length, 2, "min-1 与 max+1 两个探针");
    assert.ok(bounds.every((b) => b.status === "pass"), bounds.map((b) => b.reason).join("|"));
    assert.equal(result.summary.dimensionCoverage["field-numeric-boundary"].executed, 2);
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v22: 后端缺范围校验 → 数值越界检出 + 意外成功被清理（零污染）", async () => {
  const backend = makeBackend({ enforceRange: false });
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const bounds = result.results.filter((r) => r.kind === "negative" && r.name.includes("数值越界"));
    assert.ok(bounds.length === 2 && bounds.every((b) => b.status === "fail"), "缺范围校验应被检出");
    assert.ok(bounds.every((b) => b.hint.includes("校验缺口")));
    // 意外成功的越界记录仍被清理（verify-gone 兜底）
    assert.equal(result.summary.cleanup.verified, true);
    assert.equal(backend.store.size, 0, "零污染：全部清理");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v22: 组合查询收敛——B 条件被后端忽略时检出（查询没生效缺陷）", async () => {
  const backend = makeBackend({ ignoreQueryB: true });
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const qc = result.results.find((r) => r.kind === "query-combine");
    assert.ok(qc, "声明了 queryRequest 时组合查询探针应执行");
    assert.equal(qc.status, "fail", "B 条件被忽略应检出");
    assert.ok(qc.reason.includes("被后端忽略"), qc.reason);
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v22: 组合查询在正常过滤后端通过", async () => {
  const backend = makeBackend({});
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const qc = result.results.find((r) => r.kind === "query-combine");
    assert.equal(qc.status, "pass", qc.reason ?? "");
    assert.equal(result.summary.dimensionCoverage["op-query-combine"].executed, 1);
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v22: 严格成功码模式——code=200 的信封在 successCode=2000 下判失败", async () => {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/o/queryPage") {
        return res.end(JSON.stringify({ code: 200, message: "ok", data: { records: [], total: 0 } }));
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify({ ...CONTRACT, operations: { page: CONTRACT.operations.page } }));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const loose = await run(url, contract);
    const smokeL = loose.results.find((r) => r.kind === "smoke");
    assert.equal(smokeL.status, "pass", "宽松模式 code=200 兼容通过");

    const strict = await run(url, contract, { strictCode: true });
    const smokeS = strict.results.find((r) => r.kind === "smoke");
    assert.equal(smokeS.status, "fail", "严格模式只认 2000");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── swagger-import 增强 ──
test("v22: OpenAPI v2 basePath 拼接 + detail 响应模型导入 + queryRequest 导入", async () => {
  setupTmp();
  const v2 = {
    swagger: "2.0",
    basePath: "/api",
    paths: {
      "/order/queryPage": {
        post: {
          tags: ["Order"],
          parameters: [{ in: "body", name: "body", schema: { $ref: "#/definitions/QReq" } }],
          responses: { "200": { description: "OK", schema: { $ref: "#/definitions/Order" } } },
        },
      },
      "/order/save": {
        post: {
          tags: ["Order"],
          parameters: [{ in: "body", name: "body", schema: { $ref: "#/definitions/SaveReq" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/order/getById/{id}": { get: { tags: ["Order"], responses: { "200": { description: "OK", schema: { type: "object", properties: { data: { $ref: "#/definitions/Order" } } } } } } },
    },
    definitions: {
      QReq: { type: "object", properties: { current: { type: "integer" }, size: { type: "integer" }, orderNo: { type: "string" }, orderName: { type: "string" } } },
      SaveReq: { type: "object", required: ["orderNo"], properties: { orderNo: { type: "string" } } },
      Order: { type: "object", properties: { id: { type: "string" }, orderNo: { type: "string" }, statusName: { type: "string" } } },
    },
  };
  writeFileSync(join(TMP, "v2.json"), JSON.stringify(v2));
  try {
    const { importOpenApi } = await import(pathToFileURL(join(__dirname, "..", "lib", "swagger-import.js")).href);
    const { contract } = await importOpenApi(join(TMP, "v2.json"));
    assert.equal(contract.operations.page.externalPath, "/api/order/queryPage", "v2 basePath 必须拼接");
    assert.ok(contract.models.record?.some((f) => f.name === "statusName"), "detail 响应模型应导入 record（信封 data 解包）");
    assert.ok(contract.models.queryRequest?.some((f) => f.name === "orderNo"), "查询字段应导入 queryRequest（剔除分页参数）");
    assert.ok(!contract.models.queryRequest?.some((f) => f.name === "current"), "分页参数不得进查询字段");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v22: importOpenApi 携带 token 拉取有鉴权的 OpenAPI", async () => {
  let authHeader = null;
  const server = createServer((req, res) => {
    authHeader = req.headers.authorization;
    if (req.url === "/v3/api-docs") {
      if (!authHeader) {
        res.writeHead(401);
        return res.end("{}");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ openapi: "3.0.1", paths: { "/o/save": { post: { tags: ["O"], responses: { "200": { description: "OK" } } } } } }));
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { importOpenApi } = await import(pathToFileURL(join(__dirname, "..", "lib", "swagger-import.js")).href);
    const { contract } = await importOpenApi(`http://127.0.0.1:${server.address().port}/v3/api-docs`, { token: "abc" });
    assert.equal(authHeader, "Bearer abc", "token 应归一为 Bearer 头");
    assert.ok(contract.operations.create);
  } finally {
    server.close();
  }
});

test("v22: MCP wls_test_gen_contract 紧凑输出并落契约文件", async () => {
  setupTmp();
  const spec = {
    openapi: "3.0.1",
    paths: {
      "/o/save": { post: { tags: ["O"], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/S" } } } }, responses: { "200": { description: "OK" } } } },
      "/o/queryPage": { post: { tags: ["O"], responses: { "200": { description: "OK" } } } },
    },
    components: { schemas: { S: { type: "object", required: ["orderNo"], properties: { orderNo: { type: "string", maxLength: 32 } } } } },
  };
  const file = join(TMP, "openapi.json");
  writeFileSync(file, JSON.stringify(spec));
  try {
    const { HANDLERS } = await import(pathToFileURL(join(__dirname, "..", "mcp", "tools", "handlers.js")).href);
    const out = join(TMP, "wl-contract.json");
    const r = await HANDLERS.wls_test_gen_contract({ swagger: file, output: out });
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(r.entity, "O");
    assert.equal(r.fieldCount, 1);
    assert.ok(Array.isArray(r.warnings) && r.warnings.some((w) => w.includes("successCode")));
    assert.ok(existsSync(out));
    const saved = JSON.parse(readFileSync(out, "utf-8"));
    assert.equal(saved.models.createRequest[0].constraints.maxLength, 32);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
