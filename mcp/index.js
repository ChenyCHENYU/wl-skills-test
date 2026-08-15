#!/usr/bin/env node
/**
 * MCP Server stdio 入口 — JSON-RPC over stdin/stdout
 *
 * 用法（.mcp.json 或手动）:
 *   node node_modules/@agile-team/wl-skills-test/mcp/index.js
 *
 * 无外部依赖，自实现 MCP 协议最小子集（initialize / ping / tools/list / tools/call）。
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_DESCRIPTORS } from "./registry.js";
import { HANDLERS, listStandardResources, readStandardResource } from "./tools/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

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

  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
        },
      });
      break;

    case "initialized":
      // notification, no response
      break;

    case "ping":
      send({ jsonrpc: "2.0", id, result: {} });
      break;

    case "resources/list":
      send({
        jsonrpc: "2.0",
        id,
        result: { resources: listStandardResources() },
      });
      break;

    case "resources/read": {
      const uri = params?.uri || "";
      const content = readStandardResource(uri);
      if (content === null) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown resource: ${uri}` },
        });
      } else {
        send({
          jsonrpc: "2.0",
          id,
          result: { contents: [{ uri, text: content }] },
        });
      }
      break;
    }

    case "tools/list":
      send({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOL_DESCRIPTORS,
        },
      });
      break;

    case "tools/call": {
      const { name, arguments: args } = params || {};
      const handler = HANDLERS[name];
      if (!handler) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
        break;
      }
      // handler 可能是 async（如 wls_test_run_api），必须 await 后再序列化
      Promise.resolve()
        .then(() => handler(args || {}))
        .then((result) => {
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
        })
        .catch((e) => {
          send({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: e.message },
          });
        });
      break;
    }

    default:
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
  }
});
