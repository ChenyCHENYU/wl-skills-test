/**
 * index.js — CLI 命令路由（薄层）
 *
 * 命令实现在 lib/cli/commands/*，安装器在 lib/cli/installer.js。
 * 新增命令：在 COMMANDS 表 + ROUTERS 映射各加一行即可（help/usage 自动生成）。
 */
import { parseArgs } from "./cli/args.js";
import { PKG } from "./cli/context.js";
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

export const COMMANDS = {
  task: "记录本任务技能选择、约束与缺口（仅规划，不执行）",
  route: "只读路由：负向/歧义/上下文/缺失规则检查",
  explain: "解释本次任务路由与约束（只读）",
  status: "读取同 runId 执行回执、验证状态与缺口建议",
  "doctor-host": "宿主入口静态诊断（不声称已加载或已连接）",
  "protocol": "公开集成协议：describe 能力目录 / request 统一判定与状态（JSON 信封）",
  init: "全量安装（11 规范 + 13 Skill + 模板 + 编辑器配置）",
  update: "增量更新（内容比对，仅覆盖变化文件）",
  setup: "项目接入探测与引导（形态/接口描述来源/配置骨架 → 给 AI 的接入指令）",
  doctor: "环境体检（Node / Playwright / JMeter / 目录结构）",
  validate: "校验已安装文件的完整性",
  "gen-contract": "从 OpenAPI/Swagger 生成测试契约（URL 或 openapi.json，字段约束全保留）",
  "run-gen": "从契约生成测试用例/Playwright/JMeter 脚本",
  audit: "审计测试代码（T1-T25 确定性规则扫描）",
  fix: "自动修复测试代码反模式（F1-F6）",
  "run-api": "执行 API 接口测试（从契约自动发请求验证）",
  "run-playwright": "执行 Playwright 自动化测试",
  "run-jmeter": "执行 JMeter 性能测试",
  "perf-compare": "性能基线对比（当前 jtl/json vs 基线，劣化即非零退出）",
  "e2e-check": "E2E 工程强校验（归属闭环/安全标记/隔离声明，CI 卡门）",
  "dict-sync": "同步系统字典到 dict.json（供数据工厂/负例/round2 消费）",
  gate: "质量门聚合（审计+E2E+冒烟+DI+性能一条命令卡门，可 webhook 推送）",
  report: "聚合各执行结果生成测试报告（对齐规范 10 模板）",
  ci: "生成 CI 流水线模板（github/gitlab/jenkins，跑质量门+报告+产物上传）",
  diff: "契约变更影响面分析（操作/字段级变更 + 受影响用例清单）",
  "validate-contract": "契约快速校验（路径/字段/传输层规则，error 级即阻断）",
  clean: "卸载清理（保留测试脚本和报告）",
};

const ROUTERS = {
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
