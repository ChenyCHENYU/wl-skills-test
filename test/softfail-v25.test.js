/**
 * v0.25.0 软失败回归 — code 报成功但 message 提示异常的假成功检出
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(process.cwd(), ".tmp-v25");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

/** softFailMessage: 写操作返回 code=2000 + 异常 message（吞异常后端） */
function makeBackend({ softFailMessage = null } = {}) {
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      const send = (code, data, message = "ok") => res.end(JSON.stringify({ code: 2000, message, data }));
      if (req.method === "POST" && req.url === "/o/queryPage") return send(2000, { records: [...store.values()], total: store.size });
      if (req.method === "POST" && req.url === "/o/save") {
        if (!json.orderNo) return res.end(JSON.stringify({ code: 4004, message: "必填", data: null }));
        if ([...store.values()].some((r) => r.orderNo === json.orderNo)) return res.end(JSON.stringify({ code: 4004, message: "重复", data: null }));
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo });
        // 吞异常后端：code 报成功 + message 提示异常（HTTP 200，业务码成功）
        return send(2000, id, softFailMessage ?? "操作成功");
      }
      if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
        store.delete(req.url.split("/").pop());
        return send(2000, true, softFailMessage ?? "删除成功");
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
  resource: { contractId: "v25", module: "o", entity: "O" },
  operations: {
    page: { method: "POST", externalPath: "/o/queryPage" },
    create: { method: "POST", externalPath: "/o/save" },
    remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
  },
  models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
  transport: { successCode: 2000 },
};

async function run(url, contractPath) {
  const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
  return runApiTests({ baseUrl: url, contractPath, token: "t" });
}

test("v25: 软失败检出——code=成功但 message 提示异常，写操作不得按通过处理", async () => {
  const backend = makeBackend({ softFailMessage: "库存扣减异常，已回滚" });
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const create = result.results.find((r) => r.kind === "create");
    const soft = create.assertions.find((a) => a.name.includes("软失败"));
    assert.ok(soft, "create 应含软失败断言");
    assert.equal(soft.pass, false, "code 报成功但提示异常必须判失败");
    assert.ok(create.reason.includes("业务码与实际结果矛盾"), create.reason);
    assert.ok(create.hint.includes("吞异常"), "诊断应指向吞异常/事务回滚");

    const remove = result.results.find((r) => r.kind === "remove");
    const softR = remove.assertions.find((a) => a.name.includes("软失败"));
    assert.ok(softR && softR.pass === false, "remove 的软失败同样检出");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v25: 正常成功提示（操作成功/删除成功）不误报", async () => {
  const backend = makeBackend({});
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const create = result.results.find((r) => r.kind === "create");
    assert.ok(create.assertions.every((a) => a.pass), create.reason ?? "");
    assert.equal(result.summary.pass, true, JSON.stringify(result.results.filter((r) => r.status !== "pass").map((r) => r.reason)));
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v25: 负例拒绝（code=4004+提示）不触发软失败（那是预期拒绝路径）", async () => {
  const backend = makeBackend({});
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(`http://127.0.0.1:${backend.server.address().port}`, contract);
    const negs = result.results.filter((r) => r.kind === "negative");
    assert.ok(negs.length > 0);
    for (const n of negs) {
      assert.ok(!n.reason?.includes("软失败"), `预期拒绝不得误判软失败: ${n.reason}`);
    }
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});
