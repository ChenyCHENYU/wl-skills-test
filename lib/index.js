/**
 * index.js — CLI 命令路由（薄层）
 *
 * 命令实现在 lib/cli/commands/*，安装器在 lib/cli/installer.js。
 * 新增命令：在 COMMANDS 表 + ROUTERS 映射各加一行即可（help/usage 自动生成）。
 */
import { parseArgs } from "./cli/args.js";
import { PKG } from "./cli/context.js";
import { COMMANDS } from "./cli/catalog.js";
import { cmdInit, cmdClean } from "./cli/installer.js";
import { cmdDoctor, cmdValidate } from "./cli/system.js";
import { cmdRunGen } from "./cli/commands/generation.js";
import { cmdRunApi, cmdRunPlaywright, cmdRunJmeter, cmdPerfCompare, cmdDictSync } from "./cli/commands/execution.js";
import { cmdAudit, cmdFix, cmdE2eCheck, cmdGate } from "./cli/commands/quality.js";
import { cmdReport } from "./cli/commands/reports.js";
import { cmdCi } from "./cli/commands/ci.js";
import { cmdDiff } from "./cli/commands/diff.js";
import { cmdValidateContract } from "./cli/commands/validate-contract.js";
import { cmdGenContract } from "./cli/commands/gen-contract.js";
import { cmdTask, cmdStatus, cmdDoctorHost } from "./cli/commands/tasks.js";
import { cmdProtocol } from "./cli/commands/protocol.js";
import { cmdSetup } from "./cli/commands/setup.js";
import { cmdSit } from "./cli/commands/sit.js";

export { COMMANDS } from "./cli/catalog.js";


const ROUTERS = {
  sit: (parsed) => cmdSit(parsed),
  task: (parsed) => cmdTask(parsed),
  route: (parsed) => cmdTask(parsed, false),
  explain: (parsed) => cmdTask(parsed, false),
  status: (parsed) => cmdStatus(parsed),
  "doctor-host": (parsed) => cmdDoctorHost(parsed),
  "protocol": (parsed) => cmdProtocol(parsed),
  init: (parsed) => cmdInit(parsed),
  update: (parsed) => cmdInit({ opts: { ...parsed.opts, incremental: true } }),
  doctor: () => cmdDoctor(),
  validate: (parsed) => cmdValidate(parsed),
  "run-gen": (parsed) => cmdRunGen(parsed),
  audit: (parsed) => cmdAudit(parsed),
  fix: (parsed) => cmdFix(parsed),
  "run-api": (parsed) => cmdRunApi(parsed),
  "run-playwright": (parsed) => cmdRunPlaywright(parsed),
  "run-jmeter": (parsed) => cmdRunJmeter(parsed),
  "perf-compare": (parsed) => cmdPerfCompare(parsed),
  "e2e-check": (parsed) => cmdE2eCheck(parsed),
  "dict-sync": (parsed) => cmdDictSync(parsed),
  gate: (parsed) => cmdGate(parsed),
  report: (parsed) => cmdReport(parsed),
  ci: (parsed) => cmdCi(parsed),
  diff: (parsed) => cmdDiff(parsed),
  "validate-contract": (parsed) => cmdValidateContract(parsed),
  "gen-contract": (parsed) => cmdGenContract(parsed),
  setup: (parsed) => cmdSetup(parsed),
  clean: (parsed) => cmdClean(parsed),
};

function showHelp() {
  console.log(`
${PKG.name} v${PKG.version}
${PKG.description}

用法:
  npx @agile-team/wl-skills-test <command> [options]

命令:
${Object.entries(COMMANDS)
  .map(([cmd, desc]) => `  ${cmd.padEnd(12)} ${desc}`)
  .join("\n")}

选项:
  --dry-run     预览模式（不实际写入）
  --force       强制覆盖
  --help, -h    显示帮助

示例:
  npx @agile-team/wl-skills-test init                     # 安装
  npx @agile-team/wl-skills-test init --dry-run           # 预览
  npx @agile-team/wl-skills-test doctor                   # 体检
  npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json
  npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type playwright
  npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
`);
}

function showVersion() {
  console.log(`${PKG.name} v${PKG.version}`);
}

// ── 主入口 ──────────────────────────────────
export async function run(argv) {
  const cmd = argv[0];
  const args = argv.slice(1);
  const parsed = parseArgs(args);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    showHelp();
    return;
  }

  if (cmd === "--version" || cmd === "-v") {
    showVersion();
    return;
  }

  const handler = ROUTERS[cmd];
  if (handler) {
    await handler(parsed);
    return;
  }

  if (cmd.startsWith("--")) {
    // 未知选项绝不默认路由到 init（此前打错一个 flag 会触发真实写盘安装）
    console.error(`未知选项: ${cmd}。如需安装请运行 npx @agile-team/wl-skills-test init，查看全部命令用 --help。`);
    process.exit(2);
  }
  console.error(`未知命令: ${cmd}`);
  showHelp();
  process.exit(2);
}
