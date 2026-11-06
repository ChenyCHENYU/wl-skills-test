<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ChenyCHENYU/wl-skills-test/main/assets/wl-test-logo-dark.svg">
    <img alt="WL · World Leading · skills-test" src="https://raw.githubusercontent.com/ChenyCHENYU/wl-skills-test/main/assets/wl-test-logo.svg" width="100%">
  </picture>
</p>

<p align="center"><strong>把需求、接口契约和测试规范接成可执行、可复验、可交付的测试工程流程。</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agile-team/wl-skills-test"><img src="https://img.shields.io/npm/v/@agile-team/wl-skills-test?color=A34262" alt="npm" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/@agile-team/wl-skills-test" alt="Node.js" /></a>
</p>

**需求 → 方案与用例 → 自动化脚本 → 真实执行 → 问题复验 → 测试报告**

## 适用与能力

面向已接入项目的测试人员、开发人员和测试负责人；可以独立使用，也可以消费 Kit / BD 的真实契约。当前范围护栏排除移动端，父工作区的安装不自动启用子项目。

| 要解决的问题 | 本包提供 | 看得到的结果 |
| --- | --- | --- |
| 需求转测试容易遗漏 | 方案、场景、用例设计与评审 Skill | 带需求追溯的测试资产、冒烟范围和待确认项 |
| 重复编写自动化脚本 | 从 OpenAPI、页面规格、接口契约生成用例及 Playwright / JMeter 资产 | 可继续配置和执行的脚本，缺真实接口时明确提示 |
| 脚本能跑却测得不实 | 测试代码审计、E2E 工程检查、真实 API / 浏览器 / 性能执行器 | 规则问题、断言结果、跳过项、清理结果 |
| 报告难以对应本次改动 | 同一 `runId` 聚合结果与校验来源新鲜度 | Markdown / HTML 报告、实际检查范围和未验证项 |
| SIT 交付与问题复验脱节 | 原版式 Excel 模板、两轮逐用例证据和转 UAT 校验 | 交付文件、问题复验状态、缺失证据清单 |

**确认技能是否生效：**

- GPT、GLM 等模型由 Codex、Claude Code 或具体 VS Code 插件读取项目入口；模型名称本身不代表已加载技能。
- 先在实际项目根运行 `npx --no-install wl-skills-test doctor-host --host codex --json`，按实际宿主调整 `--host`；这是入口诊断，不能代替一次真实调用。
- 支持原生技能时可说：`$wl-skills-test 请在 <项目绝对路径> 中 <完整任务>`；不支持该语法时，让 Agent 先读取 `.agents/skills/wl-skills-test/SKILL.md`。
- 首条进度应展示真实 `notice.summary`（旧版 `notice`），交付用 `npx --no-install wl-skills-test status --run-id <runId> --json` 核对执行与待检查项；自动选择取决于宿主，不能据安装承诺每次隐式任务都会触发。

`doctor-host` 的 `discoveryCoverage` 会并列展示当前项目五包的安装版本、原生入口候选、需复核项与缺失入口。候选表示元数据可解析；本地修改、执行器版本、宿主加载和真实执行分别核验，未接入的兄弟包不会自动安装。

同时使用多个宿主时，在项目 `wlSkills.hosts` 或安装命令 `--hosts codex,claude,zcode` 中明确选择实际宿主；模型名不参与目录选择。五包各保留一个任务网关，具体 Skill 按需读取，不复制整套技能到每个编辑器。Qoder 使用 `.qoder/skills` 原生目录；Trae 当前仅核实规则引导和手动导入，不把 `.agents` 文件存在当作原生发现成功。

四个 MCP 服务会先显示简短中文调用回执，保留实际 `runId`、工具名与执行/验证状态；部分验证会说明未完成原因。机器调用方优先读取 `structuredContent`，兼容 JSON 保留在后续文本块，不再固定对 `content[0].text` 做 `JSON.parse`。仅工具返回、计划建立、检查通过分别展示；没有关联检查记录时明确说明。

ZCode 用户请使用 `--host zcode`，打开实际项目，在 Settings → Skills 刷新并核对启用；仍未出现时用新会话验证。ZCode 不会递归发现所有子项目，也不会合并子项目 AGENTS；不要为显示五包而复制同名入口。每包说明应把具体用途放在前 250 字符，超 1024 字符会被丢弃。显式选择和自然语言自动选择共用技能清单，自动选择还受元数据预算、当前 Agent 的工具开关与任务匹配影响。[官方技能说明](https://zcode.z.ai/en/docs/skill)

## 精简项目集成

默认 `compact`：规范、技能正文、模板、样例与适配器实现保留在 npm 包内，项目只生成所选宿主的必要入口和安装状态。默认使用通用 `.agents/skills`；Codex、ZCode、Kilo 等共用入口，不因发现 `.cursor` 等目录就自动增加适配。

```bash
npx --no-install wl-skills-test init --hosts codex,zcode,kilo
npx --no-install wl-skills-test update --integration compact --hosts codex --dry-run
```

宿主配置保存在已有 `package.json` 的 `wlSkills` 字段，无 npm 项目时使用 `.wl-skills/config.json`：`{"schemaVersion":1,"integration":"compact","hosts":["codex","zcode","kilo"]}`。`--hosts` 优先于兼容参数 `--editor`；`--hosts all` 和 `--integration expanded` 仅显式启用。Windsurf 旧规则不再默认生成，`windsurf` 选择兼容映射到 Devin 的通用入口。

`task` 返回可直接读取的真实资源路径，项目覆盖优先于当前执行包默认资源；没有复制到项目不再被误判为缺失。安装状态和运行证据位于 `.wl-skills/state/test/`，规则快照与业务输入分别记录。 `.wl-skills/state/.gitignore` 仅忽略各包的 runs/cache/backups，安装清单和项目配置仍可提交；共享忽略文件保留已有项目条目，不随单包卸载删除。升级读取旧归属清单，只清理未经修改的本包文件/区块；用户修改、项目契约、其他包内容、无法确认归属的旧备份保留。先用 `--dry-run` 核对变更；有冲突不产生半安装。旧版执行回执继续可读。

## 三步接入

在**实际目标项目根目录**执行，需要 Node.js 20+。以下由接入负责人配置一次，日常任务交给已加载规则的 Agent 或流水线执行。

### 1. 安装执行器与项目规则

```bash
npm install -D @agile-team/wl-skills-test
npx --no-install wl-skills-test init
```

规范、Skill 和模板保留包内，项目获得精简的宿主入口。Codex 原生入口位于 `.agents/skills/wl-skills-test/SKILL.md`；更新只维护本包登记的内容。

### 2. 识别项目并检查接入结果

```bash
npx --no-install wl-skills-test setup
npx --no-install wl-skills-test validate --json
```

`setup` 探测项目形态与本地接口资料，缺配置时生成 `wl-test.config.json` 骨架；按项目事实填写测试环境和凭据环境变量。`validate` 检查已安装文件完整性。运行浏览器测试需项目具备 Playwright，性能执行需具备 JMeter。

### 3. 用一条真实任务看效果

在编辑器刷新规则后，对 Agent 说：

> 检查 tests/order.spec.ts 的订单提交测试。先展示适用规则和问题清单，给出可脚本修复项；确认后修复并复扫。执行浏览器测试前先核对测试环境和数据清理方案，最后汇总本次报告。

先看到规则、目标和待检查项，再看到问题与修复建议，最后看到真实执行结果。安装成功与编辑器实际加载分别确认；可用 `doctor-host --host codex --json` 排查入口和版本漂移。

## 一个场景：订单提交测试漏掉断言

已有 `tests/order.spec.ts`，脚本只点击“提交”，没有验证保存结果。完整处理顺序如下：

| 环节 | 如何处理 | 验收点 |
| --- | --- | --- |
| 检查 | `task` 建立范围，`audit` 扫描适用规则 | 指向具体文件、规则和缺失断言 |
| 修复 | 先用 `fix --dry-run` 预览；授权后运行 `fix` | F1–F6 覆盖项用脚本处理；业务预期仍需确认 |
| 复扫与执行 | 再次审计；在已授权测试环境执行 Playwright | 代码问题消除、真实断言结果与跳过项分别保留 |
| 反馈 | 同一 `runId` 查看 `status` 并生成报告 | 可追溯本次检查，修复前后问题可对照 |

给 Agent、项目脚本或 CI 的最小执行链：

```bash
npx --no-install wl-skills-test task --task "按自动化测试规则审计订单 Playwright 测试" --files tests/order.spec.ts --run-id order-review --json
npx --no-install wl-skills-test audit --target tests/order.spec.ts --run-id order-review
npx --no-install wl-skills-test status --run-id order-review --json
npx --no-install wl-skills-test report --run-id order-review --html
```

审计失败先处理问题；授权修复后，用同一 `runId` 更新任务计划并复扫。浏览器执行用 `run-playwright --test-dir tests --run-id order-review`，会运行该目录实际用例，须按真实授权范围配置。`report` 只汇总本次已有证据；仅审计通过不能证明业务测试通过。

报告默认位于 `test-reports/runs/<runId>/`，命令输出实际路径。执行器报告问题和失败时返回非零退出码；空样本、失效证据和未执行项保持未验证。

### MCP 调用与回执

MCP 默认关闭。按项目实际宿主配置 `wlSkills.mcp: true`，或执行 `init --hosts codex --mcp`；`update --no-mcp` 显式关闭。安装器按已验证的宿主原生格式合并本包节点，使用项目内已安装的 MCP 脚本与明确 `WL_PROJECT_ROOT`；未支持的格式显示手动接入诊断。启动服务的兼容命令仍为 `wl-skills-test --mcp`，它与安装参数分别处理。

节点归属集中在清单 `managedMcp.records`。切换宿主或清理只撤销未经修改的本包节点，保留其他工具、用户注释、原有配置与同名服务；`--force` 不覆盖这些内容。启动器校验 `WL_PROJECT_ROOT` 后再接收请求，非法或不存在的根目录直接报错，不退回其他目录执行。配置、工具列表和真实连接分别验收。

`tools/list`、嵌入服务与 `protocol describe` 使用同一宿主输入目录。为兼容会过滤顶层组合 Schema 的宿主，条件组合使用非等价投影，并在 `_meta["wl/schemaProjection"]` 标明条件仍由服务端严格验证；完整运行时契约不变，未声明参数直接拒绝。`wls_test_case_generate` 从契约生成用例，`detail: "full"` 返回全量；只有显式 `output` 才保存 JSON，因此此工具标记为可能写文件。当前不解析自然语言需求文件，`requirementPath` 不再作为空实现参数接受。

`wls_test_fix` 默认返回预览、`fileCount` 和 `planHash`；评审后携带 `confirm: true` 与该哈希执行。源文件、目标清单或生成内容变化会拒绝写入，须重新预览；生产写入阻断、项目边界检查与失败回滚继续生效。直接 CLI 的授权约定保持原有行为，不能把 MCP 的 `confirm` 当作跨入口授权。

远程测试的地址和凭据由项目维护者在本机配置。将已授权的测试环境写入项目根的 `wl-test.config.json`，凭据通过宿主环境或项目 `.env` 提供，修改后重连 MCP。

```json
{
  "profiles": {
    "sit": {
      "mcp": "api-test",
      "baseUrl": "$WL_SIT_BASE_URL",
      "token": "$WL_SIT_TOKEN",
      "noPermToken": "$WL_SIT_RESTRICTED_TOKEN",
      "dictApi": "/pl/system/dict/all",
      "swaggerPath": "/v3/api-docs"
    }
  }
}
```

- `wls_test_run_api` 接收 `profile` 和 `contractPath`。档案需明确设置 `mcp: "api-test"`。包含新增的契约同时提供按单条主键删除和列表复查接口。总时限到达后，已登记主键仍有有限时间清理和复查。复查失败或只覆盖部分记录时，报告保留待核验状态。`noPermToken` 可省略。需要自动登录时，可在同一档案的 `auth` 中设置 `usernameEnv`、`passwordEnv` 和可选 `loginPath`。
- `wls_test_dict_sync` 接收 `profile`。`wls_test_gen_contract` 接收 `profile`，或以 `swagger` 指定项目内本地 JSON。仅需读取远程字典或 OpenAPI 时，使用 `mcp: "read-only"`。
- 旧 MCP 调用把 `baseUrl`、`token`、`noPermToken`、`auth`、`dictApi` 或远程 `swagger` 地址移到本机档案，工具参数改传档案名。HTTP 请求限制在已授权基址和接口路径内，拒绝重定向。档案或 `.env` 改动后需要重连。在 API 测试执行期间发生的改动会在回执中标为待核验。MCP 报告隐藏已知凭据，快照保留请求位置和状态，省略原始报文。原有 CLI 参数和配置合并规则继续可用。

stdio 和嵌入调用共用结果转换：工具失败以 `isError: true` 和 `structuredContent.ok: false` 返回，参数错误仍使用 JSON-RPC 错误边界；结果保留实际 `runId`、执行回执与验证状态。修复成功只表示写入完成，仍需同任务重新审计与实际测试。

## 接入流水线与交付

测试依赖和规则留在项目内，CI 使用锁文件安装后调用同一执行器。需要模板时先预览：

```bash
npx --no-install wl-skills-test ci --type gitlab --dry-run
# Jenkins 使用 --type jenkins
```

模板供接入负责人审阅、配置实际环境与检查项后使用；不会自动修改远端 GitLab / Jenkins。Test 的 `gate` 聚合测试审计、E2E、冒烟、DI 和性能证据；跨项目的 Git 钩子、构建门禁及通知编排由 [skills-gate](https://github.com/ChenyCHENYU/wl-skills-gate) 接线。

SIT 交付从[事实输入示例](docs/examples/sit-input.json)开始，`sit generate` 生成工作簿与附件，`sit verify` 校验准备或转 UAT 条件；生成交付物不代表测试已执行或客户已签收。

## 常用维护

| 需要做什么 | 命令 |
| --- | --- |
| 预检并升级项目规则 | `npx --no-install wl-skills-test update --dry-run`，审阅后去掉 `--dry-run` |
| 对齐执行器与规则 | 先更新依赖和锁文件，再执行 `update` |
| 排查工具环境 | `npx --no-install wl-skills-test doctor` |
| 查看完整命令与集成目录 | `npx --no-install wl-skills-test --help` / `protocol describe --json` |
| 预览移除本包受管规则 | `npx --no-install wl-skills-test clean --dry-run` |

## 深入使用

- [执行证据、质量门与修复边界](docs/quality-evidence.md)：实际样本、DI、清理与复验。
- [SIT 交付说明](docs/sit-delivery.md)：模板、两轮证据、问题复验与转 UAT。
- [项目范围](docs/project-scope.md) · [维护契约](docs/maintenance-contract.md)：接入判定、升级和公开执行接口。

## WL · World Leading

六个包按职责独立使用，按需要组合；接入一个包不会自动安装其他包。

| 包 | 职责 |
| --- | --- |
| [skills-gate](https://github.com/ChenyCHENYU/wl-skills-gate) | 项目钩子、构建门禁与质量闭环编排 |
| [skills-kit](https://github.com/ChenyCHENYU/wl-skills-kit) | PC Vue 管理端开发规范与工程约束 |
| [skills-ui](https://github.com/ChenyCHENYU/wl-skills-ui) | 界面规范、布局与交互质量 |
| [skills-bd](https://github.com/ChenyCHENYU/wl-skills-bd) | Java 后端规范、契约与校验 |
| **skills-test** | 测试设计、执行、质量证据与交付 |
| [skills-design](https://github.com/ChenyCHENYU/wl-skills-design) | 需求、流程、数据库与接口设计 |
