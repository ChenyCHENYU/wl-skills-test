/**
 * v0.20.0 内在闭环回归 — notfound/idempotent 探针 / detail 漂移 / fix 复验 / 契约校验
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
const TMP = join(process.cwd(), ".tmp-v20");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function makeBackend({ notFound500 = false } = {}) {
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
      if (req.method === "POST" && req.url === "/o/queryPage") return send(200, { code: 2000, data: { records: [...store.values()], total: store.size } });
      if (req.method === "POST" && req.url === "/o/save") {
        if (!json.orderNo) return send(200, { code: 4004, message: "必填" });
        if ([...store.values()].some((r) => r.orderNo === json.orderNo)) return send(200, { code: 4004, message: "重复" });
        const id = `ID${++idSeq}`;
        store.set(id, { id, orderNo: json.orderNo });
        return send(200, { code: 2000, data: id });
      }
      if (req.method === "PUT" && req.url === "/o/updateById") {
        if (!store.has(json.id)) return send(200, { code: 4004, message: "不存在", data: null });
        const rec = store.get(json.id);
        const { orderNo: _, ...rest } = json;
        store.set(json.id, { ...rec, ...rest });
        return send(200, { code: 2000, data: true });
      }
      const g = req.url.match(/^\/o\/getById\/(.+)$/);
      if (req.method === "GET" && g) {
        const rec = store.get(g[1]);
        if (!rec) {
          if (notFound500) return send(500, { code: 500, message: "NPE" });
          return send(200, { code: 4004, message: "不存在", data: null });
        }
        // detail 投影带一个契约未声明的额外字段（驱动 drift 检测）
        return send(200, { code: 2000, data: { ...rec, secretExtra: "X" } });
      }
      if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
        const id = req.url.split("/").pop();
        store.delete(id);
        return send(200, { code: 2000, data: true });
      }
      send(404, { code: 404 });
    });
  });
  return { server, store };
}

const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v20", module: "o", entity: "O" },
  operations: {
    page: { method: "POST", externalPath: "/o/queryPage" },
    create: { method: "POST", externalPath: "/o/save" },
    update: { method: "PUT", externalPath: "/o/updateById" },
    detail: { method: "GET", externalPath: "/o/getById/{id}" },
    remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
  },
  models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
  transport: { successCode: 2000 },
};

async function run(url, contractPath) {
  const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
  return runApiTests({ baseUrl: url, contractPath, token: "t" });
}

test("v20: notfound/idempotent 探针自动执行且全链路通过 + detail 漂移检出", async () => {
  const backend = makeBackend({});
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${backend.server.address().port}`;
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(url, contract);
    const nf = result.results.filter((r) => r.kind === "notfound");
    assert.equal(nf.length, 3, "detail/update/remove 三处 notfound 探针都应执行");
    assert.ok(nf.every((n) => n.status === "pass"), nf.map((n) => `${n.name}:${n.reason}`).join("|"));
    const idem = result.results.find((r) => r.kind === "idempotent");
    assert.ok(idem, "重复删除幂等探针应执行");
    assert.equal(idem.status, "pass", idem.reason ?? "");
    assert.ok(idem.detail && idem.detail.includes("重复删除行为"), "应记录拒绝/幂等行为");
    // 维度覆盖（声明↔执行）
    assert.ok(result.summary.dimensionCoverage["op-notfound"].executed >= 3);
    assert.equal(result.summary.dimensionCoverage["op-idempotent"].executed, 1);
    // detail 投影的额外字段喂进漂移检测（此前只有 list 首记录参与）
    assert.ok(result.summary.drift.extra.some((d) => d.field === "secretExtra"), JSON.stringify(result.summary.drift));
    // 整体仍通过（drift 是观测不是阻断）
    assert.equal(result.summary.pass, true, JSON.stringify(result.results.filter((r) => r.status !== "pass").map((r) => r.reason)));
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v20: notfound 返回 5xx 被检出", async () => {
  const backend = makeBackend({ notFound500: true });
  await new Promise((r) => backend.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${backend.server.address().port}`;
  setupTmp();
  const contract = join(TMP, "c.json");
  writeFileSync(contract, JSON.stringify(CONTRACT));
  try {
    const result = await run(url, contract);
    const nf = result.results.find((r) => r.kind === "notfound" && r.name.includes("detail"));
    assert.equal(nf.status, "fail");
    assert.ok(nf.hint, "应附诊断指引");
  } finally {
    backend.server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 契约校验 ──
test("v20: validate-contract 拦截坏契约 / 放行好契约 / run-api 前置串联", async () => {
  setupTmp();
  const bad = {
    kind: "wl-api-contract",
    resource: { module: "o", entity: "O" },
    operations: {
      page: { method: "POST", externalPath: "o/queryPage" }, // 缺 /
      page2: { method: "post", externalPath: "/o/queryPage2" }, // 小写 method（warning）
    },
    models: { createRequest: [{ name: "a", required: "yes" }, { name: "a" }] }, // 重名 + required 非布尔
    transport: { successCode: "2000" },
  };
  const badPath = join(TMP, "bad.json");
  writeFileSync(badPath, JSON.stringify(bad));
  const goodPath = join(TMP, "good.json");
  writeFileSync(goodPath, JSON.stringify(CONTRACT));
  try {
    const { validateContractFile } = await import(pathToFileURL(join(__dirname, "..", "lib", "contract-validate.js")).href);
    const badResult = validateContractFile(badPath);
    assert.equal(badResult.valid, false);
    assert.ok(badResult.findings.some((f) => f.message.includes("以 / 开头")));
    assert.ok(badResult.findings.some((f) => f.message.includes("建议大写")));
    assert.ok(badResult.findings.some((f) => f.message.includes("重名")));
    const goodResult = validateContractFile(goodPath);
    assert.equal(goodResult.valid, true, JSON.stringify(goodResult.findings));

    // CLI
    const cli = spawnSync(process.execPath, [BIN, "validate-contract", "--contract", badPath], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(cli.status, 1);
    assert.ok(cli.stdout.includes("error 级"));
    const cliGood = spawnSync(process.execPath, [BIN, "validate-contract", "--contract", goodPath], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(cliGood.status, 0, cliGood.stdout);

    // run-api 前置串联：坏契约直接拒跑（不发任何请求）
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const rejected = await runApiTests({ baseUrl: "http://127.0.0.1:1", contractPath: badPath, token: "t" });
    assert.ok(rejected.error && rejected.error.includes("契约校验未通过"), JSON.stringify(rejected.error));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── fix 复验闭环 ──
test("v20: fix 修复后自动 re-audit 复验（audit→fix→re-audit 闭环）", () => {
  setupTmp();
  const spec = join(TMP, "slow.spec.js");
  writeFileSync(
    spec,
    `import { test, expect } from "@playwright/test";\ntest.beforeEach(async ({ page }) => {});\ntest.afterEach(async ({ page }) => {});\ntest("should wait", async ({ page }) => {\n  await page.waitForTimeout(3000);\n  await expect(page.locator("a")).toBeVisible();\n});\n`,
  );
  try {
    const r = spawnSync(process.execPath, [BIN, "fix", "--target", spec], { encoding: "utf-8", cwd: TMP, timeout: 30000 });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("复验"), "应输出修复后复验结果");
    assert.ok(r.stdout.includes("剩余"), "应展示剩余违规计数");
    // 修复真实生效（waitForTimeout 调用被替换——注释里保留原文属预期）
    const after = readFileSync(spec, "utf-8");
    assert.ok(!after.includes("await page.waitForTimeout(3000);"), "硬等待调用应被替换");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
