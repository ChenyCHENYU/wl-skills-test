#!/usr/bin/env node
// --mcp 启动 MCP stdio server
if (process.argv[2] === "--mcp" && !process.argv.slice(2).some(arg => ["--help", "-h", "--version", "-v"].includes(arg) || arg.startsWith("--help="))) {
  import("../mcp/index.js");
} else {
  import("../lib/index.js").then(({ run }) => run(process.argv.slice(2)).catch((e) => {
    console.error(`❌ 命令执行失败: ${e.message}\n`);
    process.exit(1);
  }));
}
