/**
 * MCP Server — 工具调用工厂（测试与嵌入场景使用）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_DESCRIPTORS, TOOL_PREFIX } from "./registry.js";
import { HANDLERS } from "./tools/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

export function createServer() {
  return {
    name: `${TOOL_PREFIX}-server`,
    version: PKG.version,

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
        const result = await handler(args || {});
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
