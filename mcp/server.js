/**
 * MCP Server — 工具调用工厂（测试与嵌入场景使用）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HOST_TOOL_DESCRIPTORS, TOOL_PREFIX, assertRegistryParity, validateToolInput } from "./registry.js";
import { HANDLERS, getToolHandler } from "./tools/handlers.js";
import { toolResult, toolFailure } from "./tool-result.js";
import { createMcpNetworkContext } from "./network-profile.js";
import observation from "../lib/task-observability.cjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

// 工厂创建时即校验注册表一致性（与 stdio 入口同一防线）
const parity = assertRegistryParity(HANDLERS);
if (!parity.ok) {
  throw new Error(`工具注册表与实现不一致 — 缺实现: [${parity.missing.join(", ")}] 多余: [${parity.extra.join(", ")}]`);
}

export function createServer({ projectRoot = process.cwd() } = {}) {
  const network = createMcpNetworkContext(projectRoot);
  return {
    name: `${TOOL_PREFIX}-server`,
    version: PKG.version,

    listTools() {
      return HOST_TOOL_DESCRIPTORS;
    },

    async callTool(name, args) {
      const handler = getToolHandler(name);
      if (!handler) {
        return toolFailure(new Error(`未知工具: ${name}`), { errorCode: "UNKNOWN_TOOL" }, { tool: name, mcpOutcome: "blocked" });
      }

      const invalid = validateToolInput(name, args === undefined ? {} : args);
      if (invalid) {
        return toolFailure(new Error(`参数错误（-32602）: ${invalid}`), { errorCode: "INVALID_ARGUMENTS" }, { tool: name, mcpOutcome: "blocked" });
      }

      try {
        const projectRoot = network.requireProjectRoot(args?.root);
        const result = await observation.withMcpInvocation(name, () => handler({ ...args, root: projectRoot }, network));
        return toolResult(result, { tool: name, projectRoot });
      } catch (e) {
        return toolFailure(e, args?.runId ? { requestedRunId: args.runId } : {}, { tool: name });
      }
    },
  };
}
