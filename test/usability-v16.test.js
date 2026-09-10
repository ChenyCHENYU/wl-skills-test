/**
 * v0.16.0 可用性回归 — 配置档案 / .env / auth 自动登录与 401 重登 / CI 模板 / 诊断指引 / MCP 紧凑输出
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v16");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}
function runCli(args, cwd = TMP) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8", cwd, timeout: 30000 });
}

// ── 配置层 ──
test("v16: wl-test.config.json 档案合并 + $VAR 环境变量引用 + .env 注入", async () => {
  setupTmp();
  writeFileSync(join(TMP, ".env"), "SIT_TOKEN=env-token-123\n# 注释行\n");
  writeFileSync(
    join(TMP, "wl-test.config.json"),
    JSON.stringify({
      dictFile: "./dict.json",
      profiles: {
        default: { baseUrl: "http://localhost:8080" },
        sit: { baseUrl: "http://sit:8080", token: "$SIT_TOKEN" },
        uat: { baseUrl: "http://uat:8080", token: "${UAT_TOKEN}" },
      },
    }),
  );
  try {
    const { loadWlConfig, withConfig } = await import(pathToFileURL(join(__dirname, "..", "lib", "config.js")).href);
    const wl = loadWlConfig({ profile: "sit", cwd: TMP });
    assert.equal(wl.config.baseUrl, "http://sit:8080");
    assert.equal(wl.config.token, "env-token-123", "$SIT_TOKEN 应从 .env 注入解析");
    assert.equal(wl.config.dictFile, "./dict.json", "根键作为默认并入所有档案");

    process.env.UAT_TOKEN = "uat-tok";
    const uat = loadWlConfig({ profile: "uat", cwd: TMP });
    assert.equal(uat.config.token, "uat-tok", "${VAR} 形式也应解析");

    // CLI 显式值优先，配置补缺
    const merged = withConfig({ "base-url": "http://override" }, wl.config);
    assert.equal(merged["base-url"], "http://override");
    assert.equal(merged.token, "env-token-123");
  } finally {
    delete process.env.UAT_TOKEN;
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── auth 自动登录 + 401 重登 ──
test("v16: run-api 无 token 时自动登录，token 过期(401)自动重登重试", async () => {
  let loginCount = 0;
  // 服务端当前有效 token（初始与客户端持有的"过期 token"不同 → 首个业务请求 401 触发重登）
  let currentToken = "server-valid-token-0";
  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.method === "POST" && req.url === "/login") {
      loginCount++;
      currentToken = `fresh-token-${loginCount}`;
      return send(200, { code: 2000, data: { token: currentToken } });
    }
    const auth = req.headers.authorization || "";
    if (auth.includes(currentToken)) {
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
        if (req.method === "DELETE" && req.url.startsWith("/o/deleteById/")) {
          store.delete(req.url.split("/").pop());
          return send(200, { code: 2000, data: true });
        }
        send(404, { code: 404 });
      });
      return;
    }
    // 旧/无效 token → 401 触发重登
    send(401, { code: 401, message: "token expired" });
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
      resource: { contractId: "auth-test", module: "o", entity: "O" },
      operations: {
        page: { method: "POST", externalPath: "/o/queryPage" },
        create: { method: "POST", externalPath: "/o/save" },
        remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" },
      },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    // 场景：带一个"已过期"的 token（首个请求 401 → 自动重登 → 全链路恢复）
    const { runApiTests } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({
      baseUrl: url,
      contractPath: contract,
      token: "old-expired-token",
      auth: { loginPath: "/login", username: "u", password: "p" },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.summary.pass, true, `链路应经重登后全通: ${JSON.stringify(result.summary)}`);
    assert.ok(loginCount >= 1, `应发生自动重登（实际 ${loginCount} 次）`);
    assert.equal(result.summary.auth.mode, "token+relogin");
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 诊断指引 ──
test("v16: 失败步骤附带诊断指引（hint），报告含诊断列", async () => {
  let saveSeq = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      if (req.method === "POST" && req.url === "/o/queryPage") {
        return res.end(JSON.stringify({ code: 2000, data: { records: [], total: 0 } }));
      }
      // 后端无必填校验 → 负例失败 → 应附"校验缺口"指引
      if (req.method === "POST" && req.url === "/o/save") {
        saveSeq++;
        return res.end(JSON.stringify({ code: 2000, data: `IDX_${saveSeq}` }));
      }
      res.writeHead(404);
      res.end("{}");
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
      resource: { contractId: "hint-test", module: "o", entity: "O" },
      operations: { page: { method: "POST", externalPath: "/o/queryPage" }, create: { method: "POST", externalPath: "/o/save" } },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const { runApiTests, generateSmokeReport } = await import(pathToFileURL(join(__dirname, "..", "lib", "api-executor.js")).href);
    const result = await runApiTests({ baseUrl: url, contractPath: contract, token: "t" });
    const negFail = result.results.find((r) => r.kind === "negative" && r.status === "fail");
    assert.ok(negFail, "无校验的后端应产生负例失败");
    assert.ok(negFail.hint && negFail.hint.includes("校验缺口"), `负例失败应附后端校验缺口指引: ${negFail.hint}`);
    const md = generateSmokeReport(result);
    assert.ok(md.includes("诊断指引"), "Markdown 报告应含诊断列");
    assert.ok(md.includes("校验缺口"));
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── CI 模板 ──
test("v16: ci 命令生成三种流水线模板", () => {
  setupTmp();
  try {
    const gh = runCli(["ci", "--type", "github"]);
    assert.equal(gh.status, 0, gh.stderr);
    assert.ok(existsSync(join(TMP, ".github", "workflows", "wl-quality-gate.yml")));
    assert.ok(readFileSync(join(TMP, ".github", "workflows", "wl-quality-gate.yml"), "utf-8").includes("audit --target"));

    const gl = runCli(["ci", "--type", "gitlab"]);
    assert.equal(gl.status, 0, gl.stderr);
    assert.ok(existsSync(join(TMP, ".gitlab-ci.yml")));

    const jk = runCli(["ci", "--type", "jenkins"]);
    assert.equal(jk.status, 0, jk.stderr);
    assert.ok(existsSync(join(TMP, "Jenkinsfile")));

    // 已存在不覆盖（--force 才覆盖）
    const again = runCli(["ci", "--type", "gitlab"]);
    assert.equal(again.status, 0);
    assert.ok(again.stdout.includes("已存在"));

    // dry-run 不写
    const dry = runCli(["ci", "--type", "github", "--output", "wf2.yml", "--dry-run"]);
    assert.equal(dry.status, 0);
    assert.ok(!existsSync(join(TMP, "wf2.yml")));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── MCP 紧凑输出（token 经济学）──
test("v16: MCP run_api 默认紧凑摘要，detail:full 才回全量", async () => {
  const { createServer: mkMcp } = await import(pathToFileURL(join(__dirname, "..", "mcp", "server.js")).href);
  const server = mkMcp();
  const url = await startMiniBackend();
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(
    contract,
    JSON.stringify({
      kind: "wl-api-contract",
      schemaVersion: 1,
      resource: { contractId: "compact-test", module: "o", entity: "O" },
      operations: { page: { method: "POST", externalPath: "/o/queryPage" }, create: { method: "POST", externalPath: "/o/save" }, remove: { method: "DELETE", externalPath: "/o/deleteById/{id}" } },
      models: { createRequest: [{ name: "orderNo", required: true, type: "string" }] },
      transport: { successCode: 2000 },
    }),
  );
  try {
    const res = await server.callTool("wls_test_run_api", { contractPath: contract, baseUrl: url, token: "t" });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.pass, true);
    assert.ok(parsed.failures !== undefined && Array.isArray(parsed.failures), "默认应回紧凑 failures 摘要");
    assert.equal(parsed.results, undefined, "默认不得回全量 results（token 浪费）");

    const full = await server.callTool("wls_test_run_api", { contractPath: contract, baseUrl: url, token: "t", detail: "full" });
    const parsedFull = JSON.parse(full.content[0].text);
    assert.ok(Array.isArray(parsedFull.results), "detail:full 应回全量");
  } finally {
    urlClose();
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v16: MCP audit 默认紧凑（TopN + 修复入口），report 默认紧凑（未达标项）", async () => {
  const { createServer: mkMcp, HANDLERS } = {
    ...{ createServer: (await import(pathToFileURL(join(__dirname, "..", "mcp", "server.js")).href)).createServer },
    HANDLERS: (await import(pathToFileURL(join(__dirname, "..", "mcp", "tools", "handlers.js")).href)).HANDLERS,
  };
  setupTmp();
  const bad = join(TMP, "bad.spec.js");
  writeFileSync(bad, `import { test } from "@playwright/test";\ntest("随便测", async ({ page }) => {\n  await page.goto("https://prod.example.com/x");\n});\n`);
  try {
    const compact = HANDLERS.wls_test_audit({ target: TMP });
    assert.ok(compact.bySeverity !== undefined);
    assert.ok(Array.isArray(compact.topFindings), "默认应回 topFindings");
    assert.equal(compact.findings, undefined, "默认不得回全量 findings");
    assert.ok(compact.hint.includes("fix"), "应给修复入口指引");

    const full = HANDLERS.wls_test_audit({ target: TMP, detail: "full" });
    assert.ok(Array.isArray(full.findings), "detail:full 回全量");

    // report 紧凑
    const api = join(TMP, "api-result.json");
    writeFileSync(api, JSON.stringify({ summary: { entity: "X", total: 2, passed: 1, failed: 1, errors: 0, skipped: 0, passRate: 50, decision: "不通过" } }));
    const rep = HANDLERS.wls_test_report_generate({ api });
    assert.equal(rep.pass, false);
    assert.ok(Array.isArray(rep.failingChecks), "应回未达标项列表");
    assert.equal(rep.report, undefined, "默认不内联报告全文");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 简易后端工具（本文件共享）──
let miniServer = null;
async function startMiniBackend() {
  const store = new Map();
  let idSeq = 0;
  miniServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
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
    });
  });
  await new Promise((r) => miniServer.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${miniServer.address().port}`;
}
function urlClose() {
  miniServer?.close();
  miniServer = null;
}
