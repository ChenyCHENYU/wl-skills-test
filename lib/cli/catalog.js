/**
 * CLI 帮助与公开集成目录的单一事实源。
 *
 * 参数和副作用描述对应本包原命令；进入此目录不代表获得 Harness 执行授权，
 * protocol execute 仍仅允许 executors.json 中明确列出的执行器。
 */
export const COMMAND_CATALOG = {
  task: { summary: "记录本任务技能选择、约束与缺口（仅规划，不执行）", args: '--task <任务> [--run-id <id>] [--files <路径列表>] [--domain <domain>] [--root <目录>] [--json]', sideEffects: '写入目标项目 .wl-skills-test/runs/ 本包任务计划与缺口记录；不执行测试', readOnly: false },
  route: { summary: "只读路由：负向/歧义/上下文/缺失规则检查", args: '--task <任务> [--files <路径列表>] [--domain <domain>] [--root <目录>] [--json]', sideEffects: '无写入', readOnly: true },
  explain: { summary: "解释本次任务路由与约束（只读）", args: '--task <任务> [--files <路径列表>] [--domain <domain>] [--root <目录>] [--json]', sideEffects: '无写入', readOnly: true },
  status: { summary: "读取同 runId 执行回执、验证状态与缺口建议", args: '[--run-id <id>] [--root <目录>] [--json]', sideEffects: '无写入', readOnly: true },
  'doctor-host': { summary: "宿主入口静态诊断（不声称已加载或已连接）", args: '[--host <name>] [--root <目录>] [--json]', sideEffects: '无写入；静态入口诊断不构成宿主或模型实际加载证据', readOnly: true },
  protocol: { summary: "公开集成协议：describe 能力目录 / request 统一判定与状态（JSON 信封）", args: 'describe | request --input-file <request.json> [--json]', sideEffects: 'describe 无写入；request 按所选 operation 声明，task 写任务记录，execute 可写本包执行记录/报告；不能据 ok=true 判定业务通过', readOnly: false },
  init: { summary: "全量安装本包规范、Skill、模板与编辑器配置", args: '[--dry-run] [--force]', sideEffects: '写入受管规范、技能、编辑器入口与本包所有权清单；--dry-run 无写入，外来内容冲突不覆盖', readOnly: false },
  update: { summary: "增量更新（保留用户修改与外来内容）", args: '[--dry-run] [--force]', sideEffects: '更新受管资产与所有权清单；保留用户改动，冲突停止，--dry-run 无写入', readOnly: false },
  setup: { summary: "项目接入探测与引导（形态/接口描述来源/配置骨架 → 给 AI 的接入指令）", args: '[--base-url <URL>]', sideEffects: '探测本地项目；提供 base-url 时请求 Swagger；缺少配置时写 wl-test.config.json 骨架，不覆盖已有配置', readOnly: false },
  doctor: { summary: "环境体检（Node / Playwright / JMeter / 目录结构）", args: '', sideEffects: '执行本地工具版本探测（包括 npx playwright --version；npx 按其配置可能下载安装）；不证明业务环境网络或宿主加载', readOnly: false },
  validate: { summary: "校验已安装文件的完整性", args: '[--root <目录>] [--json]', sideEffects: '无写入；安装完整性不能证明模型已使用技能', readOnly: true },
  'gen-contract': { summary: "从 OpenAPI/Swagger 生成测试契约（URL 或 openapi.json，字段约束全保留）", args: '--swagger <URL或openapi.json> [--module <模块>] [--entity <实体>] [--output <契约.json>] [--force]', sideEffects: '输入为 URL 时发出读取请求；写测试契约，已有输出不覆盖（除非显式 --force）', readOnly: false },
  'run-gen': { summary: "从契约生成测试用例/Playwright/JMeter 脚本", args: '--contract <文件> [--type cases|playwright|jmeter|e2e] [--granularity field] [--output <路径>] [--json <文件>]', sideEffects: '写用例/脚本/可选 JSON；e2e 生成工程目录；生成不等于执行或通过', readOnly: false },
  audit: { summary: "审计测试代码（T1-T25 确定性规则扫描）", args: '[--target <路径>] [--format json] [--reports-dir <目录>] [--run-id <id>]', sideEffects: '读取测试源代码；写本包执行回执、audit 报告/JSON 与报告历史，不修改被审计源文件', readOnly: false },
  fix: { summary: "自动修复测试代码反模式（F1-F6）", args: '[--target <路径>] [--root <项目目录>] [--dry-run]', sideEffects: '修改明确目标内 JS/TS 源文件，采用备份/回滚并复审；--dry-run 仅预览；范围外与符号链接不修复', readOnly: false },
  'run-api': { summary: "执行 API 接口测试（从契约自动发请求验证）", args: '--contract <文件> [--base-url <URL>] [--profile <name>] [--output <报告.md>] [--json <结果.json>] [--run-id <id>]', sideEffects: '向目标环境执行真实 HTTP 测试（包括写操作、清理及可选权限探针），写本包执行回执、报告与历史；须确认环境和业务写入授权', readOnly: false },
  'run-playwright': { summary: "执行 Playwright 自动化测试", args: '[--test-dir <目录>] [--reporter list|json] [--headed] [--timeout <毫秒>] [--reports-dir <目录>] [--json <文件>] [--run-id <id>]', sideEffects: '启动真实测试子进程；测试脚本可能访问/修改目标环境；写执行回执、报告、JSON 与历史', readOnly: false },
  'run-jmeter': { summary: "执行 JMeter 性能测试", args: '--jmx <文件> [--threads <N>] [--result-dir <目录>] [--reports-dir <目录>] [--baseline-compare] [--run-id <id>]', sideEffects: '启动 JMeter 对目标环境发出真实请求；写压测产物、本包执行回执、报告/JSON/历史，可建立或比较性能基线', readOnly: false },
  'perf-compare': { summary: "性能基线对比（当前 jtl/json vs 基线，劣化即非零退出）", args: '--current <jtl或json> (--baseline <文件> | --auto-baseline) [--threshold <百分比>] [--update-baseline] [--output <报告>] [--json <文件>]', sideEffects: '读取性能结果并写比较报告/可选 JSON 与历史；--auto-baseline 可创建基线，--update-baseline 显式更新基线', readOnly: false },
  'e2e-check': { summary: "E2E 工程强校验（归属闭环/安全标记/隔离声明，CI 卡门）", args: '[--target <目录>] [--run-id <id>]', sideEffects: '读取 E2E 工程并写本包执行回执；不执行浏览器脚本', readOnly: false },
  'dict-sync': { summary: "同步系统字典到 dict.json（供数据工厂/负例/round2 消费）", args: '--base-url <URL> [--dict-api <路径>] [--token <token>] [--output <文件>] [--map <字段=字典码>]', sideEffects: '读取目标环境字典接口并写字典 JSON', readOnly: false },
  gate: { summary: "质量门聚合（审计+E2E+冒烟+DI+性能一条命令卡门，可 webhook 推送）", args: '[--audit-dir <目录>] [--e2e-dir <目录>] [--smoke-result <json>] [--defects <json> --cases <N> --round-results <json>] [--perf-current <文件> --perf-baseline <文件>] [--webhook <URL>] [--run-id <id>]', sideEffects: '读取所选质量证据/测试源代码并写本包执行回执与报告历史；仅显式提供 webhook 时发送通知请求', readOnly: false },
  report: { summary: "聚合各执行结果生成测试报告（对齐规范 10 模板）", args: '[--api <json>] [--playwright <json>] [--jmeter <json>] [--audit <json>] [--defects <json> --cases <N>] [--run-id <id>] [--reports-dir <目录>] [--output <报告>] [--html] [--plan-input] [--webhook <URL>]', sideEffects: '读取真实结果并写报告、索引/历史及可选 HTML/plan-input；仅显式提供 webhook 时发送通知请求，不能伪造 UAT 签字', readOnly: false },
  ci: { summary: "生成 CI 流水线模板（github/gitlab/jenkins，跑质量门+报告+产物上传）", args: '[--type github|gitlab|jenkins] [--output <文件>] [--dry-run] [--force]', sideEffects: '写 CI 配置模板；--dry-run 仅预览；不自动触发外部流水线', readOnly: false },
  diff: { summary: "契约变更影响面分析（操作/字段级变更 + 受影响用例清单）", args: '--old <旧契约> --new <新契约> [--output <报告>] [--json <文件>]', sideEffects: '读取两份契约并写变更报告与可选 JSON；不自动重跑测试', readOnly: false },
  'validate-contract': { summary: "契约快速校验（路径/字段/传输层规则，error 级即阻断）", args: '--contract <文件>', sideEffects: '无写入；静态契约校验不证明真实 API 可用', readOnly: true },
  clean: { summary: "卸载清理（保留测试脚本和报告）", args: '[--dry-run]', sideEffects: '移除本包未被修改的受管安装资产并更新清单；保留用户内容、脚本和报告；--dry-run 无写入', readOnly: false },
  sit: { summary: "SIT 测试交付模板、生成与准入验证（保留模板版式，缺证据不冒充通过）", args: 'templates | generate --input <sit.json> --output <新目录> | verify --input <sit.json> --phase pre-sit|pre-uat [--run-id <id> --root <目录>] [--json]', sideEffects: 'templates及无run-id的verify只读；verify指定run-id时写本包关联回执；generate仅向新目录原子写入交付物，已有目录拒绝；无网络，不执行测试或伪造签字', readOnly: false },
};

export const COMMANDS = Object.fromEntries(Object.entries(COMMAND_CATALOG).map(([name, metadata]) => [name, metadata.summary]));

export function commandInventory() {
  return Object.entries(COMMAND_CATALOG).map(([name, metadata]) => ({ name, ...metadata, execution: 'programmatic' }));
}
