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
    child,
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

test("MCP stdio: tools/list 返回全部工具（与 handler 实现精确一致）", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/list");
    const names = res.result.tools.map((t) => t.name);
    // 精确断言（旧的 >= 15 太松，漂移到 16/18 也不会被发现）
    const { pathToFileURL } = await import("node:url");
    const { TOOL_DESCRIPTORS } = await import(pathToFileURL(join(__dirname, "..", "mcp", "registry.js")).href);
    const { HANDLERS } = await import(pathToFileURL(join(__dirname, "..", "mcp", "tools", "handlers.js")).href);
    assert.equal(names.length, TOOL_DESCRIPTORS.length);
    assert.deepEqual([...new Set(names)].sort(), Object.keys(HANDLERS).sort(), "注册表与 handler 键必须一一对应");
    assert.ok(names.includes("wls_test_standards"));
    assert.ok(names.includes("wls_test_e2e_generate"));
    assert.ok(names.includes("wls_test_report_generate"));
    assert.ok(names.includes("wls_test_e2e_check"));
  } finally {
    server.close();
  }
});

test("MCP stdio: 缺 required 参数返回 -32602（而非 -32603 内部错误）", async () => {
  const server = startServer();
  try {
    const res = await server.send("tools/call", {
      name: "wls_test_case_generate",
      arguments: { contractPath: "whatever" }, // 缺 required: type
    });
    assert.ok(res.error, "缺 required 参数应返回 JSON-RPC 错误");
    assert.equal(res.error.code, -32602);
    assert.ok(res.error.message.includes("type"), `错误信息应指明缺失参数: ${res.error.message}`);
  } finally {
    server.close();
  }
});

test("MCP stdio: notification（无 id）不应答", async () => {
  const server = startServer();
  try {
    // 原始帧计数：写入 notification 后 300ms 内不应有任何输出行（旧版会回 id:undefined 的帧）
    let lines = 0;
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("utf-8");
      let idx;
      while ((idx = buf.indexOf("\n")) > -1) {
        if (buf.slice(0, idx).trim()) lines++;
        buf = buf.slice(idx + 1);
      }
    };
    server.child.stdout.on("data", onData);
    server.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
    await new Promise((r) => setTimeout(r, 300));
    server.child.stdout.off("data", onData);
    assert.equal(lines, 0, "notification 不应产生任何应答帧");
    // 服务器不崩溃：ping 仍可用
    const res = await server.send("ping");
    assert.deepEqual(res.result, {});
  } finally {
    server.close();
  }
});

test("MCP stdio: 批量请求明确拒绝（-32600）", async () => {
  const server = startServer();
  try {
    const reply = new Promise((resolve) => {
      const onData = (chunk) => {
        const line = chunk.toString("utf-8").trim();
        if (!line) return;
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve(null);
        }
        server.child.stdout.off("data", onData);
      };
      server.child.stdout.on("data", onData);
    });
    server.child.stdin.write(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]) + "\n");
    const msg = await reply;
    assert.ok(msg.error, "批量请求应返回错误");
    assert.equal(msg.error.code, -32600);
  } finally {
    server.close();
  }
});

test("MCP stdio: initialize 声明 resources 能力", async () => {
  const server = startServer();
  try {
    const res = await server.send("initialize", {});
    assert.ok(res.result.capabilities.resources, "应声明 resources 能力");
  } finally {
    server.close();
  }
});

test("MCP stdio: resources/list 返回 11 条规范", async () => {
  const server = startServer();
  try {
    const res = await server.send("resources/list");
    const resources = res.result.resources;
    assert.ok(Array.isArray(resources));
    assert.ok(resources.length >= 11);
    assert.ok(resources.every((r) => r.uri.startsWith("wl-test://standards/")));
  } finally {
    server.close();
  }
});

test("MCP stdio: resources/read 读取规范内容", async () => {
  const server = startServer();
  try {
    const list = await server.send("resources/list");
    const uri = list.result.resources[0].uri;
    const res = await server.send("resources/read", { uri });
    assert.ok(res.result.contents[0].text.length > 50, "规范内容应非空");
  } finally {
    server.close();
  }
});

test("MCP stdio: resources/read 无效 uri 报错", async () => {
  const server = startServer();
  try {
    const res = await server.send("resources/read", { uri: "wl-test://standards/no-such.md" });
    assert.ok(res.error);
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
