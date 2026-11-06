#!/usr/bin/env node
/**
 * MCP Server stdio 入口 — JSON-RPC over stdin/stdout
 *
 * 用法（.mcp.json 或手动）:
 *   node node_modules/@agile-team/wl-skills-test/mcp/index.js
 *
 * MCP 协议最小子集（initialize / ping / tools/list / tools/call / resources），复用包内 Schema 校验。
 * 协议要点：notification（无 id）不应答；批量请求明确 -32600 拒绝；
 * tools/call 参数错误返回 -32602；handler 的领域失败和异常返回 isError 工具结果。
 */
import { createInterface } from "node:readline";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { HOST_TOOL_DESCRIPTORS, assertRegistryParity, validateToolInput } from "./registry.js";
import { HANDLERS, getToolHandler, listStandardResources, readStandardResource } from "./tools/handlers.js";
import requestBoundary from "../lib/json-rpc-request.cjs";
import observation from "../lib/task-observability.cjs";
import { toolResult, toolFailure } from "./tool-result.js";
import { createMcpNetworkContext } from "./network-profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

// Native hosts can launch from another directory. Bind all default relative
// paths to the explicit project root before accepting any tool request.
if (Object.hasOwn(process.env, "WL_PROJECT_ROOT")) {
  const configuredRoot = process.env.WL_PROJECT_ROOT;
  if (!configuredRoot?.trim() || !isAbsolute(configuredRoot)) throw new Error("WL_PROJECT_ROOT 必须是已存在项目目录的绝对路径");
  let projectRoot;
  try {
    projectRoot = realpathSync(configuredRoot);
    if (!statSync(projectRoot).isDirectory()) throw new Error("不是目录");
  } catch (error) { throw new Error(`WL_PROJECT_ROOT 无法核验：${error.message}`); }
  process.chdir(projectRoot);
}
const network = createMcpNetworkContext();

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
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  const validated = requestBoundary.validateRequest(req);
  if (validated.error) return send(validated.error);
  if (validated.notification) return;
  const { id, method, params } = validated.request;

  // notification（无 id）不应答——应答会污染客户端的响应匹配
  const reply = (payload) => {
    send({ jsonrpc: "2.0", id, ...payload });
  };

  switch (method) {
    case "initialize":
      reply({
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
          instructions: "代码/测试任务先调用 wls_test_task(action:task) 记录所选技能、基线和缺口；按需读取 canonical 文件。执行工具复用 runId，结束调用 action:status。" + observation.MCP_RECEIPT_GUIDANCE,
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
      const uri = params.uri;
      if (typeof uri !== "string" || !uri.trim()) {
        reply({ error: { code: -32602, message: "uri 必须是非空字符串" } });
        break;
      }
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
          tools: HOST_TOOL_DESCRIPTORS,
        },
      });
      break;

    case "tools/call": {
      const { name, arguments: args } = params || {};
      if (typeof name !== "string" || !name.trim()) {
        reply({ error: { code: -32602, message: "name 必须是非空字符串" } });
        break;
      }
      const handler = getToolHandler(name);
      if (!handler) {
        reply({ error: { code: -32601, message: `Unknown tool: ${name}` } });
        break;
      }
      // inputSchema.required 运行时校验：参数缺失是调用方问题（-32602），不是 server 内部错误（-32603）
      const invalid = validateToolInput(name, args === undefined ? {} : args);
      if (invalid) {
        reply({ error: { code: -32602, message: invalid } });
        break;
      }
      // handler 可能是 async（如 wls_test_run_api），必须 await 后再序列化
      Promise.resolve()
        .then(() => {
          const root = network.requireProjectRoot(args?.root);
          return observation.withMcpInvocation(name, () => handler({ ...args, root }, network));
        })
        .then((result) => {
          reply({ result: toolResult(result, { tool: name, projectRoot: network.root }) });
        })
        .catch((e) => {
          reply({ result: toolFailure(e, args?.runId ? { requestedRunId: args.runId } : {}, { tool: name }) });
        });
      break;
    }

    default:
      reply({ error: { code: -32601, message: `Unknown method: ${method}` } });
  }
});
