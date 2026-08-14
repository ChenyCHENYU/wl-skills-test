/**
 * MCP stdio round-trip 测试 — 起子进程真实走 JSON-RPC（拦截 async handler 序列化为 {} 的回归）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = join(__dirname, "..", "mcp", "index.js");

function startServer() {
  const child = spawn(process.execPath, [MCP_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
  let seq = 0;
  const pending = new Map();

  const waiters = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf-8");
    let idx;
    while ((idx = buffer.indexOf("\n")) > -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const resolver = pending.get(msg.id);
        if (resolver) {
          pending.delete(msg.id);
          resolver(msg);
        }
      } catch {
        // 忽略非 JSON 行
      }
    }
  });

  child.stderr.on("data", () => {}); // 吞掉 stderr 噪音

  return {
    send(method, params) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`MCP 请求超时: ${method}`));
          }
        }, 10000).unref();
      });
    },
    close() {
      child.kill();
    },
  };
}

test("MCP stdio: initialize 返回协议版本与包版本", async () => {
  const server = startServer();
  try {
    const res = await server.send("initialize", {});
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.ok(/^\d+\.\d+\.\d+$/.test(res.result.serverInfo.version), "版本号应从 package.json 读取");
  } finally {
    server.close();
  }
});

test("MCP stdio: ping 响应空结果", async () => {
  const server = startServer();
  try {
    const res = await server.send("ping");
    assert.deepEqual(res.result, {});
  } finally {
    server.close();
  }
});

test("MCP stdio: tools/list 返回全部工具", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/list");
    const names = res.result.tools.map((t) => t.name);
    assert.ok(names.length >= 13);
    assert.ok(names.includes("wls_test_standards"));
    assert.ok(names.includes("wls_test_e2e_generate"));
  } finally {
    server.close();
  }
});

test("MCP stdio: 同步工具调用返回真实数据（非空对象）", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/call", {
      name: "wls_test_standards",
      arguments: {},
    });
    const text = res.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.standards));
    assert.ok(parsed.standards.length >= 11);
  } finally {
    server.close();
  }
});

test("MCP stdio: 异步工具（run_api）不再序列化为空对象", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/call", {
      name: "wls_test_run_api",
      arguments: { contractPath: "no-such-contract.json" },
    });
    const text = res.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, "async handler 的结果应被正确序列化（旧 bug 序列化 Promise 得 {}）");
  } finally {
    server.close();
  }
});

test("MCP stdio: 未知工具返回 JSON-RPC 错误", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/call", { name: "wls_no_such_tool", arguments: {} });
    assert.ok(res.error);
    assert.equal(res.error.code, -32601);
  } finally {
    server.close();
  }
});
