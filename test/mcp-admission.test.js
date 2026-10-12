import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../mcp/server.js";
import { readStandardResource } from "../mcp/tools/handlers.js";
const ENTRY = fileURLToPath(new URL("../mcp/index.js", import.meta.url));
const TOOL_COUNT = 23;

test('embedded MCP uses the same registered-tool and resource identity boundary', async () => {
  const server = createServer();
  for (const name of ['toString', 'constructor', '__proto__', ['toString'], null, {}]) {
    const result = await server.callTool(name, {});
    assert.equal(result.isError, true);
  }
  for (const uri of [null, 7, {}, [], ['wl-test://standards/01-test-process.md']]) {
    assert.equal(readStandardResource(uri), null);
  }
  assert.equal(server.listTools().length, 23);
});

async function startServer(t, entry) {
  const cwd = mkdtempSync(join(tmpdir(), 'wl-mcp-admission-'));
  const child = spawn(process.execPath, [entry], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const queued = [];
  const waiting = [];
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const value = JSON.parse(line);
    const next = waiting.shift();
    if (next) next.resolve(value); else queued.push(value);
  });
  child.on('exit', (code, signal) => {
    for (const next of waiting.splice(0)) next.reject(new Error(`MCP exited ${code}/${signal}: ${stderr}`));
  });
  t.after(() => { child.kill(); lines.close(); rmSync(cwd, { recursive: true, force: true }); });
  return {
    child, cwd,
    notify(value) { child.stdin.write(JSON.stringify(value) + '\n'); },
    async raw(value) {
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP response timeout: ${stderr}`)), 5000);
        const next = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
        if (queued.length) next.resolve(queued.shift()); else waiting.push(next);
      });
      child.stdin.write(value + '\n');
      return response;
    },
    async rpc(value) { return this.raw(JSON.stringify(value)); },
  };
}

test('MCP rejects invalid request frames and remains available without project writes', async t => {
  const server = await startServer(t, ENTRY);
  const invalid = [null, true, false, 0, 1, 'text', [], {}, { id: 9, method: 'ping' },
    { jsonrpc: '1.0', id: 9, method: 'ping' }, { jsonrpc: '2.0', id: 9, method: 3 },
    ...[{}, [], true].map(id => ({ jsonrpc: '2.0', id, method: 'ping' }))];
  for (const request of invalid) {
    const response = await server.rpc(request);
    assert.deepEqual(response, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
  }
  const parse = await server.raw('{');
  assert.equal(parse.error.code, -32700);
  assert.equal(parse.id, null);
  for (const params of [null, true, [], 'text']) {
    const response = await server.rpc({ jsonrpc: '2.0', id: 'bad-params', method: 'tools/call', params });
    assert.equal(response.error.code, -32602);
    assert.equal(response.id, 'bad-params');
  }
  server.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  server.notify({ jsonrpc: '2.0', method: 'tools/call', params: null });
  assert.deepEqual(await server.rpc({ jsonrpc: '2.0', id: null, method: 'ping' }), { jsonrpc: '2.0', id: null, result: {} });
  assert.deepEqual(await server.rpc({ jsonrpc: '2.0', id: 'alive', method: 'ping' }), { jsonrpc: '2.0', id: 'alive', result: {} });
  for (const name of [null, [], {}, ['toString'], '']) {
    const response = await server.rpc({ jsonrpc: '2.0', id: 'bad-name', method: 'tools/call', params: { name } });
    assert.equal(response.error.code, -32602);
  }
  for (const name of ['toString', 'constructor', '__proto__']) {
    const response = await server.rpc({ jsonrpc: '2.0', id: 'unknown-tool', method: 'tools/call', params: { name } });
    assert.equal(response.error.code, -32601);
  }
  const tools = await server.rpc({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' });
  assert.equal(tools.result.tools.length, TOOL_COUNT);
  assert.equal(server.child.exitCode, null);
  assert.deepEqual(readdirSync(server.cwd), []);
});


test('MCP resources reject coerced URI values before reading', async t => {
  const server = await startServer(t, ENTRY);
  for (const uri of [null, 7, {}, [], ['wl-test://standards/01-test-process.md'], '']) {
    const response = await server.rpc({ jsonrpc: '2.0', id: 'uri', method: 'resources/read', params: { uri } });
    assert.equal(response.error.code, -32602);
  }
  assert.deepEqual(await server.rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }), { jsonrpc: '2.0', id: 1, result: {} });
  assert.deepEqual(readdirSync(server.cwd), []);
});
