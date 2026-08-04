/**
 * MCP Server 骨架 — 第二阶段实现完整 handler
 */
import { TOOL_DESCRIPTORS, TOOL_PREFIX } from "./registry.js";

export function createServer() {
  return {
    name: `${TOOL_PREFIX}-server`,
    version: "0.1.0",

    listTools() {
      return TOOL_DESCRIPTORS;
    },

    async callTool(name, args) {
      console.log(`[MCP] ${name} called with:`, JSON.stringify(args).slice(0, 100));
      return {
        content: [
          {
            type: "text",
            text: `工具 ${name} 在第二阶段实现。当前为骨架，规划 ${TOOL_DESCRIPTORS.length} 个工具。`,
          },
        ],
      };
    },
  };
}
