/** Exercise the advertised catalog and real MCP transports, including zero-write failures. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "../mcp/server.js";
import { TOOL_DESCRIPTORS, validateToolInput } from "../mcp/registry.js";
import { toolResult } from "../mcp/tool-result.js";
import { computePlanHash } from "../lib/plan-hash.js";
import { confirmAndWrite } from "../lib/write-guard.js";
import { createInstallPlan, applyInstallPlan } from "../lib/cli/install-state.js";
import { PKG, PKG_ROOT } from "../lib/cli/context.js";

const entry = fileURLToPath(new URL("../mcp/index.js", import.meta.url));
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-mcp-contract-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function client(t, mode, root) {
  if (mode === "embedded") {
    const server = createServer({ projectRoot: root });
    return { call: async (name, args) => ({ result: await server.callTool(name, args) }) };
  }
  const child = spawn(process.execPath, [entry], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map(); let sequence = 0, stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  lines.on("line", line => { const msg = JSON.parse(line); pending.get(msg.id)?.resolve(msg); });
  child.on("exit", () => { for (const p of pending.values()) p.reject(new Error(stderr || "MCP exited")); });
  t.after(() => { child.kill(); lines.close(); });
  return { call(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${name}`)); }, 5000);
      pending.set(id, { resolve: msg => { clearTimeout(timer); pending.delete(id); resolve(msg); }, reject: error => { clearTimeout(timer); pending.delete(id); reject(error); } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
    });
  } };
}
const sample = { kind: "wl-api-contract", schemaVersion: 1, protocolVersion: "1.0",
  resource: { contractId: "mcp-contract", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: { page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" } },
  models: { createRequest: [{ name: "name", type: "string", required: true }] }, transport: { successCode: 2000 } };
const assertInvalid = response => {
  if (response.error) assert.equal(response.error.code, -32602);
  else { assert.equal(response.result.isError, true); assert.equal(response.result.structuredContent.errorCode, "INVALID_ARGUMENTS"); }
};

test("MCP catalog rejects unknown options and advertises all handler output controls", () => {
  for (const tool of TOOL_DESCRIPTORS) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.doesNotMatch(validateToolInput(tool.name, {}) || "", /Schema 契约不可用/, tool.name);
  }
  const cases = TOOL_DESCRIPTORS.find(tool => tool.name === "wls_test_case_generate");
  assert.equal(cases.annotations.readOnlyHint, false);
  assert.equal(cases.annotations.destructiveHint, true, "explicit output may overwrite an existing local file");
  assert.ok(cases.inputSchema.properties.output); assert.ok(cases.inputSchema.properties.detail);
  assert.equal(cases.inputSchema.properties.requirementPath, undefined, "unsupported requirements must not be silently ignored");
  const fix = TOOL_DESCRIPTORS.find(tool => tool.name === "wls_test_fix");
  assert.ok(fix.inputSchema.properties.planHash); assert.ok(fix.inputSchema.properties.confirm);
  assert.ok(fix.outputSchema.properties.planHash);
  assert.ok(TOOL_DESCRIPTORS.find(tool => tool.name === "wls_test_task").outputSchema.properties.notice);
  assert.ok(TOOL_DESCRIPTORS.find(tool => tool.name === "wls_test_run_api").outputSchema.properties.execution);
});

test("malformed structured receipts are tool errors and retain the runId needed for lookup", () => {
  const response = toolResult({ runId: "schema-run", execution: { executionStatus: "unexpected" } }, { tool: "wls_test_run_api" });
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.errorCode, "INVALID_TOOL_OUTPUT");
  assert.equal(response.structuredContent.requestedRunId, "schema-run");
  assert.match(response.content[0].text, /查询回执/);
});

for (const mode of ["embedded", "stdio"]) {
  test(`${mode}: declared case output writes, unknown and mistyped controls cause zero writes`, async t => {
    const root = fixture(t), server = client(t, mode, root);
    const contractPath = path.join(root, "contract.json"), output = path.join(root, "cases.json");
    fs.writeFileSync(contractPath, JSON.stringify(sample));
    const args = { type: "functional", contractPath, output };
    assertInvalid(await server.call("wls_test_case_generate", { ...args, unknownOption: true }));
    assertInvalid(await server.call("wls_test_case_generate", { ...args, output: 42 }));
    assertInvalid(await server.call("wls_test_case_generate", { ...args, requirementPath: "ignored.md" }));
    assert.equal(fs.existsSync(output), false);
    const response = await server.call("wls_test_case_generate", args);
    assert.equal(response.result.isError, undefined); assert.equal(response.result.structuredContent.writtenTo, output);
    assert.ok(JSON.parse(fs.readFileSync(output, "utf8")).cases.length);
    assert.deepEqual(JSON.parse(response.result.content[1].text), response.result.structuredContent);
  });

  test(`${mode}: handler failure and thrown domain errors are tool errors with structured content`, async t => {
    const root = fixture(t), server = client(t, mode, root);
    for (const input of [
      ["wls_test_contract_read", { source: "kit", path: path.join(root, "missing.json") }],
      ["wls_test_standards", { id: "does-not-exist" }],
    ]) {
      const response = await server.call(...input);
      assert.equal(response.error, undefined); assert.equal(response.result.isError, true);
      assert.equal(response.result.structuredContent.ok, false); assert.ok(response.result.structuredContent.error);
    }
    const invalid = path.join(root, "invalid.json"); fs.writeFileSync(invalid, "{");
    const response = await server.call("wls_test_contract_read", { source: "kit", path: invalid });
    assert.equal(response.error, undefined); assert.equal(response.result.isError, true);
    assert.equal(response.result.structuredContent.errorCode, "TOOL_EXECUTION_ERROR");
    assert.equal((await server.call("wls_test_standards", {})).result.structuredContent.ok, true);
  });

  test(`${mode}: fix uses reviewed hashes and rejects stale plans before writing`, async t => {
    const root = fixture(t), server = client(t, mode, root), target = path.join(root, "test.js");
    const original = "await page.waitForTimeout(1000);\n"; fs.writeFileSync(target, original);
    const args = { root, target: path.basename(target) };
    assertInvalid(await server.call("wls_test_fix", { ...args, confirm: true }));
    const previewResult = (await server.call("wls_test_fix", args)).result;
    assert.match(previewResult.content[0].text, /^\[WL MCP\] 本次工具=wls_test_fix；调用=预览已返回，尚未应用/u);
    const preview = previewResult.structuredContent;
    assert.match(preview.planHash, /^[a-f0-9]{64}$/); assert.equal(preview.fileCount, 1);
    const wrong = (await server.call("wls_test_fix", { ...args, confirm: true, planHash: "0".repeat(64) })).result;
    assert.equal(wrong.isError, true); assert.equal(wrong.structuredContent.written, 0);
    assert.equal(fs.readFileSync(target, "utf8"), original);
    const changed = "await page.waitForTimeout(9000);\n"; fs.writeFileSync(target, changed);
    const stale = (await server.call("wls_test_fix", { ...args, confirm: true, planHash: preview.planHash })).result;
    assert.equal(stale.isError, true); assert.equal(stale.structuredContent.errorCode, "plan-hash-mismatch");
    assert.equal(fs.readFileSync(target, "utf8"), changed);
    const fresh = (await server.call("wls_test_fix", args)).result.structuredContent;
    const applied = (await server.call("wls_test_fix", { ...args, confirm: true, planHash: fresh.planHash })).result;
    assert.equal(applied.isError, undefined); assert.equal(applied.structuredContent.fixed, 1);
    assert.equal(applied.structuredContent.validationStatus, "unverified");
  });

  test(`${mode}: failed checks retain the actual same-runId execution receipt`, async t => {
    const root = fixture(t);
    fs.writeFileSync(path.join(root, "wl-test.config.json"), JSON.stringify({ profiles: { test: { mcp: "api-test", baseUrl: "http://localhost:8080" } } }));
    const server = client(t, mode, root);
    applyInstallPlan(createInstallPlan(root, { filesDir: path.join(PKG_ROOT, "files"), version: PKG.version }));
    const target = path.join(root, "sample.spec.js");
    fs.writeFileSync(target, "import { test } from '@playwright/test';\ntest('should submit', async ({ page }) => { await page.click('button'); });\n");
    const runId = `mcp-contract-${mode}`;
    const planned = (await server.call("wls_test_task", { action: "task", task: "审计测试代码", root, files: [target], runId })).result;
    assert.equal(planned.structuredContent.notice.runId, runId, JSON.stringify(planned));
    const result = (await server.call("wls_test_audit", { target, root, runId })).result;
    assert.match(result.content[0].text, /test@/);
    assert.match(result.content[0].text, /^\[WL MCP\] 本次工具=wls_test_audit；调用=失败/);
    assert.ok(result.content[0].text.includes(`runId=${runId}`));
    assert.match(result.content[0].text, /验证=failed/);
    assert.doesNotMatch(result.content[0].text, /回执不可用/);
    assert.deepEqual(JSON.parse(result.content[1].text), result.structuredContent);
    assert.equal(result.isError, true); assert.equal(result.structuredContent.runId, runId);
    assert.equal(result.structuredContent.provenance.runId, runId);
    assert.equal(result.structuredContent.execution.validationStatus, "failed");
    assert.equal(fs.existsSync(path.resolve(root, result.structuredContent.execution.recordPath)), true);
    const receipt = JSON.parse(fs.readFileSync(path.resolve(root, result.structuredContent.execution.recordPath), "utf8"));
    assert.deepEqual(receipt.invocation, { channel: "mcp", tool: "wls_test_audit" });
    const status = (await server.call("wls_test_task", { action: "status", root, runId })).result.structuredContent;
    assert.equal(status.notice.runId, runId);
    assert.equal(status.records.some(item => item.eventId === receipt.eventId), true);
    const missing = (await server.call("wls_test_run_api", { root, runId, profile: "test", contractPath: path.join(root, "missing.json") })).result;
    assert.equal(missing.isError, true); assert.equal(missing.structuredContent.runId, runId);
    assert.equal(missing.structuredContent.execution.executionStatus, "failed");
    assert.equal(fs.existsSync(path.resolve(root, missing.structuredContent.execution.recordPath)), true);
  });
}

test("write guard rejects original-byte drift across the batch before any write", t => {
  const root = fixture(t), first = path.join(root, "a.js"), second = path.join(root, "b.js");
  fs.writeFileSync(first, "first"); fs.writeFileSync(second, "second");
  const hash = content => createHash("sha256").update(content).digest("hex");
  const plan = [{ target: first, content: "replacement-a", beforeHash: hash("first") }, { target: second, content: "replacement-b", beforeHash: hash("second") }];
  fs.writeFileSync(second, "external change");
  const result = confirmAndWrite(plan, computePlanHash(plan));
  assert.equal(result.success, false); assert.equal(result.written, 0);
  assert.equal(fs.readFileSync(first, "utf8"), "first"); assert.equal(fs.readFileSync(second, "utf8"), "external change");
});
