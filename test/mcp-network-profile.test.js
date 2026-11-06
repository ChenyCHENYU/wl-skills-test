import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../mcp/server.js";

const token = "fixture-project-token-25ea";
const loginToken = "fixture-issued-token-274e";
const password = "fixture-project-password-cf26";

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wl-test-mcp-network-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
async function listener(t, handler) {
  const server = httpServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const writeJson = (root, name, value) => writeFileSync(join(root, name), JSON.stringify(value));
const config = (root, profiles) => writeJson(root, "wl-test.config.json", { profiles });
const contract = (root, externalPath = "/orders/queryPage", file = "contract.json") => writeJson(root, file, {
  kind: "wl-api-contract", schemaVersion: 1,
  resource: { module: "orders", entity: "Order" },
  operations: { page: { externalPath, method: "POST" } },
  models: { createRequest: [] }, transport: { successCode: 2000 },
});

test("MCP request scope rejects untrusted destinations, raw inputs and unauthorized profiles before outbound", async t => {
  let requests = 0;
  const baseUrl = await listener(t, (req, res) => { requests++; res.end("{}"); });
  const root = project(t), other = project(t);
  writeFileSync(join(root, ".env"), `WL_MCP_TEST_SECRET=${token}\n`);
  config(root, {
    ready: { mcp: "api-test", baseUrl: `${baseUrl}/gateway`, token: "$WL_MCP_TEST_SECRET" },
    readonly: { mcp: "read-only", baseUrl },
    invalid: { mcp: "api-test", baseUrl, token },
  });
  contract(root, "/orders/queryPage");
  contract(root, "/../admin", "traversal.json");
  contract(root, "//foreign.invalid/inbox", "foreign.json");
  contract(other);
  symlinkSync(join(other, "contract.json"), join(root, "linked.json"));
  const server = createServer({ projectRoot: root });
  const report = join(root, "test-reports", "runs", "unsafe-report");
  mkdirSync(report, { recursive: true });
  const protectedFile = join(other, "unrelated.txt");
  writeFileSync(protectedFile, "preserve me");
  symlinkSync(protectedFile, join(report, "api-result.json"));
  const call = args => server.callTool("wls_test_run_api", { profile: "ready", contractPath: "contract.json", ...args });
  const attempts = [
    [{ baseUrl, token }, "INVALID_ARGUMENTS"],
    [{ profile: "injected" }, "MCP_PROFILE_NOT_AUTHORIZED"],
    [{ profile: "readonly" }, "MCP_PROFILE_NOT_AUTHORIZED"],
    [{ profile: "invalid" }, "MCP_PROFILE_CONFIG"],
    [{ contractPath: "traversal.json" }, "MCP_DESTINATION_OUT_OF_SCOPE"],
    [{ contractPath: "foreign.json" }, "MCP_DESTINATION_OUT_OF_SCOPE"],
    [{ contractPath: "linked.json" }, "MCP_PROJECT_SCOPE"],
    [{ root: other }, "MCP_PROJECT_SCOPE"],
    [{ output: "wl-test.config.json" }, "MCP_PROJECT_SCOPE"],
    [{ runId: "unsafe-report" }, "MCP_PROJECT_SCOPE"],
    [{ runId: "unsafe-report", contractPath: "missing.json" }, "MCP_PROJECT_SCOPE"],
  ];
  for (const [args, errorCode] of attempts) {
    const response = await call(args);
    assert.equal(response.structuredContent.errorCode, errorCode, JSON.stringify(response));
    assert.equal(response.isError, true);
    assert.equal(JSON.stringify(response).includes(token), false);
  }
  const legacy = await server.callTool("wls_test_gen_contract", { swagger: `${baseUrl}/v3/api-docs`, token });
  assert.equal(legacy.structuredContent.errorCode, "INVALID_ARGUMENTS");
  assert.match(legacy.structuredContent.error, /profile/);
  assert.equal(JSON.stringify(legacy).includes(token), false);
  const configBefore = readFileSync(join(root, "wl-test.config.json"), "utf8");
  for (const [name, args] of [
    ["wls_test_contract_read", { source: "kit", path: ".env" }],
    ["wls_test_contract_diff", { oldPath: ".env", newPath: "contract.json" }],
    ["wls_test_case_generate", { type: "functional", contractPath: "contract.json", output: "wl-test.config.json" }],
    ["wls_test_sit_generate", { inputFile: ".env", outputDir: "delivery" }],
  ]) {
    const result = await server.callTool(name, args);
    assert.equal(result.structuredContent.errorCode, "MCP_PROJECT_SCOPE", JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes(token), false);
  }
  assert.equal(readFileSync(join(root, "wl-test.config.json"), "utf8"), configBefore);
  assert.equal(readFileSync(protectedFile, "utf8"), "preserve me");
  config(root, { injected: { mcp: "api-test", baseUrl } });
  assert.equal((await call({})).structuredContent.errorCode, "MCP_PROFILE_CHANGED");
  writeFileSync(join(root, "wl-test.config.json"), configBefore);
  writeFileSync(join(root, ".env"), "WL_MCP_TEST_SECRET=replaced-token\n");
  assert.equal((await call({})).structuredContent.errorCode, "MCP_PROFILE_CHANGED");
  assert.equal(requests, 0);
});

test("MCP selected profile uses local auth, redacts before evidence writes, and never follows redirects", async t => {
  const root = project(t), outside = project(t);
  const sentinel = join(outside, "sentinel.txt");
  writeFileSync(sentinel, "unchanged after race");
  let foreignRequests = 0;
  const foreign = await listener(t, (req, res) => { foreignRequests++; res.end("{}"); });
  const requests = [];
  let loginPayload;
  const baseUrl = await listener(t, (req, res) => {
    requests.push([req.url, req.headers.authorization]);
    const send = value => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); };
    if (req.url === "/gateway/login") {
      let body = "";
      req.on("data", data => { body += data; });
      return req.on("end", () => { loginPayload = JSON.parse(body); send({ code: 2000, data: { token: loginToken } }); });
    }
    if (req.url === "/gateway/redirect") {
      res.writeHead(307, { location: `${foreign}/outside` });
      return res.end();
    }
    if (req.url === "/gateway/dict") return send({ code: 2000, data: { status: [token] } });
    if (req.url === "/gateway/openapi") return send({ openapi: "3.0.1", paths: {
      "/orders/queryPage": { post: { tags: ["Order"], responses: { 200: { description: "OK" } } } },
    } });
    if (req.url === "/gateway/drift/queryPage") {
      writeFileSync(join(root, ".env"), "# fixture changed during the request\n");
      return send({ code: 2000, data: { records: [], total: 0 } });
    }
    if (req.url === "/gateway/artifact-race/queryPage") {
      const dir = join(root, "test-reports", "runs", "mcp-artifact-race");
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, "api-result.json"))) symlinkSync(sentinel, join(dir, "api-result.json"));
      return send({ code: 2000, data: { records: [], total: 0 } });
    }
    return send({ code: 2000, message: `echo ${loginToken}`, data: { records: [{ password, token: loginToken }], total: 1 } });
  });
  writeFileSync(join(root, ".env"), `WL_MCP_TEST_BASE=${baseUrl}/gateway\nWL_MCP_TEST_SECRET=${token}\nWL_MCP_TEST_PASSWORD=${password}\nWL_MCP_TEST_USER=fixture-user\n`);
  config(root, {
    execute: { mcp: "api-test", baseUrl: "$WL_MCP_TEST_BASE", auth: { usernameEnv: "WL_MCP_TEST_USER", passwordEnv: "WL_MCP_TEST_PASSWORD" } },
    read: { mcp: "read-only", baseUrl: "$WL_MCP_TEST_BASE", token: "${WL_MCP_TEST_SECRET}", dictApi: "/dict", swaggerPath: "/openapi" },
    redirect: { mcp: "read-only", baseUrl: "$WL_MCP_TEST_BASE", token: "$WL_MCP_TEST_SECRET", dictApi: "/redirect" },
  });
  contract(root);
  const server = createServer({ projectRoot: root });
  const executed = await server.callTool("wls_test_run_api", { root: ".", profile: "execute", contractPath: "contract.json", detail: "full", output: "full.json", runId: "mcp-verified-network" });
  assert.equal(executed.structuredContent.execution?.executionStatus, "completed", JSON.stringify(executed));
  assert.equal(executed.structuredContent.runId, "mcp-verified-network");
  assert.equal(executed.structuredContent.profile, "execute");
  assert.doesNotMatch(executed.content[0].text, /回执不可用/);
  const status = (await server.callTool("wls_test_task", { action: "status", runId: "mcp-verified-network" })).structuredContent;
  assert.equal(status.notice.projectRoot, root);
  assert.ok(status.records.some(record => record.eventId === executed.structuredContent.execution.receiptId));
  assert.equal(loginPayload.password, password);
  assert.ok(requests.some(([url, header]) => url === "/gateway/orders/queryPage" && header === `Bearer ${loginToken}`));
  const synced = await server.callTool("wls_test_dict_sync", { profile: "read" });
  assert.equal(synced.structuredContent.dictCodes, 1, JSON.stringify(synced));
  assert.ok(requests.some(([url, header]) => url === "/gateway/dict" && header === `Bearer ${token}`));
  const generated = await server.callTool("wls_test_gen_contract", { profile: "read", output: "generated.json" });
  assert.equal(generated.structuredContent.ok, true, JSON.stringify(generated));
  assert.ok(requests.some(([url, header]) => url === "/gateway/openapi" && header === `Bearer ${token}`));
  const rejected = await server.callTool("wls_test_dict_sync", { profile: "redirect", output: "redirect.json" });
  assert.equal(rejected.isError, true);
  assert.equal(foreignRequests, 0);
  assert.equal(existsSync(join(root, "redirect.json")), false);
  assert.equal(process.env.WL_MCP_TEST_SECRET, undefined, "MCP .env 解析不注入全局环境");

  const persisted = ["full.json", "dict.json", "generated.json", executed.structuredContent.correlatedResultFile, executed.structuredContent.execution.recordPath]
    .map(file => readFileSync(join(root, file.startsWith(root) ? file.slice(root.length) : file), "utf8"));
  for (const payload of [JSON.stringify(executed), JSON.stringify(synced), JSON.stringify(generated), ...persisted]) {
    for (const secret of [token, loginToken, password]) assert.equal(payload.includes(secret), false);
  }
  contract(root, "/artifact-race/queryPage", "race.json");
  const race = await server.callTool("wls_test_run_api", { profile: "execute", contractPath: "race.json", runId: "mcp-artifact-race" });
  assert.equal(race.structuredContent.errorCode, "MCP_REPORT_WRITE_FAILED");
  assert.equal(race.structuredContent.execution.executionStatus, "completed");
  assert.equal(race.structuredContent.runId, "mcp-artifact-race");
  assert.equal(readFileSync(sentinel, "utf8"), "unchanged after race");
  contract(root, "/drift/queryPage", "drift.json");
  const changed = await server.callTool("wls_test_run_api", { profile: "execute", contractPath: "drift.json", runId: "mcp-drift-network" });
  assert.equal(changed.structuredContent.profileSourceChanged, true, JSON.stringify(changed));
  assert.equal(changed.structuredContent.execution.executionStatus, "completed");
  assert.equal(changed.structuredContent.execution.validationStatus, "partial");
  assert.match(changed.content[0].text, /api-profile-freshness/);
});
