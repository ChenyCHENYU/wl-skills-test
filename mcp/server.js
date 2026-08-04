/**
 * MCP Server — 7 个工具完整实现
 */
import { TOOL_DESCRIPTORS, TOOL_PREFIX } from "./registry.js";
import { HANDLERS } from "./tools/handlers.js";

export function createServer() {
  return {
    name: `${TOOL_PREFIX}-server`,
    version: "0.2.0",

    listTools() {
      return TOOL_DESCRIPTORS;
    },

    async callTool(name, args) {
      const handler = HANDLERS[name];
      if (!handler) {
        return {
          isError: true,
          content: [{ type: "text", text: `未知工具: ${name}` }],
        };
      }

      try {
        const result = handler(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [{ type: "text", text: `工具执行失败: ${e.message}` }],
        };
      }
    },
  };
}
