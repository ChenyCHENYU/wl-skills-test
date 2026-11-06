import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TOOL_DESCRIPTORS, HOST_TOOL_DESCRIPTORS, validateToolInput } from "../mcp/registry.js";
import { createServer } from "../mcp/server.js";
import schemaValidation from "../lib/schema-validation.cjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("Test stdio, embedded and describe expose the same host schema without changing the strict registry", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-schema-host-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const before = JSON.stringify(TOOL_DESCRIPTORS);
  assert.deepEqual(TOOL_DESCRIPTORS.map(schemaValidation.projectMcpToolSchema), HOST_TOOL_DESCRIPTORS);
  assert.equal(JSON.stringify(TOOL_DESCRIPTORS), before);
  const output = spawnSync(process.execPath, [path.join(ROOT, "mcp/index.js")], {
    cwd: root, env: { ...process.env, WL_PROJECT_ROOT: root }, encoding: "utf8", timeout: 15000,
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n",
  });
  assert.equal(output.status, 0, output.stderr);
  const tools = JSON.parse(output.stdout.trim()).result.tools;
  assert.equal(tools.length, 23);
  assert.equal(tools.filter(tool => tool._meta?.["wl/schemaProjection"]).length, 1);
  assert.deepEqual(createServer().listTools(), tools);
  const description = spawnSync(process.execPath, [path.join(ROOT, "bin/wl-skills-test.js"), "protocol", "describe", "--json"], { cwd: root, encoding: "utf8", timeout: 15000 });
  assert.equal(description.status, 0, description.stderr);
  const inventory = JSON.parse(description.stdout).inventory.mcpTools;
  for (const tool of tools) {
    for (const key of ["anyOf", "allOf", "oneOf"]) assert.equal(Object.hasOwn(tool.inputSchema, key), false, `${tool.name}.${key}`);
    const canonical = TOOL_DESCRIPTORS.find(value => value.name === tool.name);
    const row = inventory.find(value => value.name === tool.name);
    assert.deepEqual(row.outputSchema, tool.outputSchema);
    assert.deepEqual(row.inputSchema, tool.inputSchema); assert.deepEqual(row._meta, tool._meta);
    assert.deepEqual(tool.annotations, canonical.annotations);
    assert.deepEqual(tool.inputSchema.properties, canonical.inputSchema.properties);
    assert.deepEqual(tool.inputSchema.required, canonical.inputSchema.required);
    assert.equal(tool.inputSchema.additionalProperties, canonical.inputSchema.additionalProperties);
  }
  assert.equal(TOOL_DESCRIPTORS.find(tool => tool.name === "wls_test_fix").inputSchema.allOf.length, 1);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("Test actual stdio rejects conditional fix arguments before handlers and leaves every file unchanged", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-schema-strict-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const source = "await page.waitForTimeout(1000);\n";
  fs.writeFileSync(path.join(root, "sample.spec.js"), source);
  const base = { root, target: "sample.spec.js", confirm: true };
  const values = [{}, base, { ...base, planHash: "bad" }, { ...base, planHash: "0".repeat(64), hidden: true }];
  const input = values.map((args, index) => JSON.stringify({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name: "wls_test_fix", arguments: args } })).join("\n") + "\n";
  const output = spawnSync(process.execPath, [path.join(ROOT, "mcp/index.js")], { cwd: root, encoding: "utf8", input, timeout: 15000 });
  assert.equal(output.status, 0, output.stderr);
  const responses = output.stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(responses.length, values.length);
  for (const response of responses) assert.equal(response.error?.code, -32602, JSON.stringify(response));
  assert.match(validateToolInput("wls_test_fix", base), /planHash/);
  assert.deepEqual(fs.readdirSync(root), ["sample.spec.js"]);
  assert.equal(fs.readFileSync(path.join(root, "sample.spec.js"), "utf8"), source);
});
