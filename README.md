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

## 三步接入

在**实际目标项目根目录**执行，需要 Node.js 20+。以下由接入负责人配置一次，日常任务交给已加载规则的 Agent 或流水线执行。

### 1. 安装执行器与项目规则

```bash
npm install -D @agile-team/wl-skills-test
npx --no-install wl-skills-test init
```

获得测试规范、Skill、模板和编辑器入口。Codex 原生入口位于 `.agents/skills/wl-skills-test/SKILL.md`；更新只维护本包登记的内容。

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
