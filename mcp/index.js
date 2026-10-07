#!/usr/bin/env node
/**
 * MCP Server stdio 入口 — JSON-RPC over stdin/stdout
 *
 * 用法（.mcp.json 或手动）:
 *   node node_modules/@agile-team/wl-skills-test/mcp/index.js
 *
 * 无外部依赖，自实现 MCP 协议最小子集（initialize / ping / tools/list / tools/call / resources）。
 * 协议要点：notification（无 id）不应答；批量请求明确 -32600 拒绝；
 * tools/call 缺 required 参数返回 -32602（调用方错误），handler 异常才是 -32603。
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_DESCRIPTORS, assertRegistryParity, validateToolInput } from "./registry.js";
import { HANDLERS, listStandardResources, readStandardResource } from "./tools/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

// 启动期一致性防线：注册表与 handler 键必须完全一致（漂移直接拒绝启动，而非调用时才暴露）
const parity = assertRegistryParity(HANDLERS);
if (!parity.ok) {
  console.error(`[mcp] 工具注册表与实现不一致 — 缺实现: [${parity.missing.join(", ")}] 多余: [${parity.extra.join(", ")}]`);
  process.exit(1);
}

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "wl-skills-test", version: PKG.version };

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  // JSON-RPC 2.0：批量请求（数组）不在本 server 支持范围，明确拒绝而非吐 "Unknown method: undefined"
  if (Array.isArray(req)) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "批量请求暂不支持，请逐条调用" } });
    return;
  }

  const { id, method, params } = req;

  // notification（无 id）不应答——应答会污染客户端的响应匹配
  const isNotification = id === undefined || id === null;
  const reply = (payload) => {
    if (isNotification) return;
    send({ jsonrpc: "2.0", id, ...payload });
  };

  switch (method) {
    case "initialize":
      reply({
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
          instructions: "代码/测试任务先调用 wls_test_task(action:task) 记录所选技能、基线和缺口；按需读取 canonical 文件。执行工具复用 runId，结束调用 action:status，分别报告执行与验证状态。文件存在和模型自报不能证明宿主加载。",
        },
      });
      break;

    case "initialized":
      // notification, no response
      break;

    case "ping":
      reply({ result: {} });
      break;

    case "resources/list":
      reply({
        result: { resources: listStandardResources() },
      });
      break;

    case "resources/read": {
      const uri = params?.uri || "";
      const content = readStandardResource(uri);
      if (content === null) {
        reply({ error: { code: -32602, message: `Unknown resource: ${uri}` } });
      } else {
        reply({
          result: { contents: [{ uri, text: content }] },
        });
      }
      break;
    }

    case "tools/list":
      reply({
        result: {
          tools: TOOL_DESCRIPTORS,
        },
      });
      break;

    case "tools/call": {
      const { name, arguments: args } = params || {};
      const handler = HANDLERS[name];
      if (!handler) {
        reply({ error: { code: -32601, message: `Unknown tool: ${name}` } });
        break;
      }
      // inputSchema.required 运行时校验：参数缺失是调用方问题（-32602），不是 server 内部错误（-32603）
      const invalid = validateToolInput(name, args || {});
      if (invalid) {
        reply({ error: { code: -32602, message: invalid } });
        break;
      }
      // handler 可能是 async（如 wls_test_run_api），必须 await 后再序列化
      Promise.resolve()
        .then(() => handler(args || {}))
        .then((result) => {
          reply({
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
        })
        .catch((e) => {
          reply({ error: { code: -32603, message: e.message } });
        });
      break;
    }

    default:
      reply({ error: { code: -32601, message: `Unknown method: ${method}` } });
  }
});
