---
name: wl-skills-test
description: "测试计划与用例、测试评审、测试代码审计（弱断言、空断言和恒真断言）、冒烟验证、UI/接口/性能测试和质量门禁；普通代码变更可评估测试覆盖，按实际授权执行测试。用于目标自身已接入本包的项目；不继承父目录安装，不适用移动端或未接入项目。"
---

# WL 测试与验证任务入口

显式调用示例：`$wl-skills-test 请在 <项目绝对路径> 中 <完整任务>，先展示 task 回执，再执行授权范围内的工作，结束展示同 runId 的 status。` 支持原生技能的宿主可按名称调用；其他宿主先读本入口。模型名称或安装成功不证明宿主已加载。

首条进度用 `notice.summary`（旧版用 `notice`）说明匹配了哪个技能、执行工具是否已运行、还有什么待检查。实际调用 MCP 后再报真实工具名和结果；结束用同一 runId 核对。包版本放在详情，失败说清原因，不能把路由命中说成技能已加载。

仅目标项目自身接入且平台适用时启用：本包清单、直接依赖或 `.wl-skills-scope.json` 为证。父目录、兄弟包、Vue 文件与触发词不构成接入；未接入项目不自动安装，移动端不适用。跨项目沿最近边界分别判定，不越界找父清单。`scope` 是静态证据，宿主加载仍须实际事件。

显示真实 `action.mode`、`checksAllowed` 与 `ruleRefs`。历史与禁止动作不参与评分；只讨论或列计划不能自动检查/改写。检查许可不授予业务写入权限。多项目先按目标定位项目根，再执行工具；同一用户任务复用 runId。 只解释或核对适用规则时，使用 CLI `route`/`explain`，或 `wls_test_task` 的 `action: "route"`/`"explain"`。有实际后续工作才建立 `task` 记录。

- 从目标项目根优先执行版本一致的本地命令 `node node_modules/@agile-team/wl-skills-test/bin/wl-skills-test.js task "<完整任务>" --json`。本地命令不可用时，使用已连接、同项目同版本的 MCP `wls_test_task`（`action: "task"`、`task`、`root`），结束用同一工具的 `action: "status"` 和同一 `runId`。也可复用已有同版本缓存：`npx --offline --yes --package @agile-team/wl-skills-test@__WL_SKILLS_TEST_VERSION__ wl-skills-test task "<任务>" --json`。均不可用时，报告“缺少可用执行器，任务尚未执行”。后续命令复用同一执行器与版本。`route` 和 `explain` 仅读判定，不建立任务记录。
- Read selected canonical Skill and standards from the exact physical paths returned by the tool. Package resources are the default; project overrides take precedence. Resolve references relative to each file.
- 回执应说明基础规则、不适用、缺口或执行器失败。明确要求的组合任务可按同一 runId 分阶段判定，仍有实质歧义时再询问。
- Reuse the returned `runId` with `--run-id` on authorized CLI checks. Show command receipts, verification outcomes and pending checks at handoff. `status --run-id <id> --json` reads those records.
- Do not run API requests, performance tests or write fixtures just because routing selected a skill. Follow the user's actual scope, environment authorization and cleanup constraints. Missing API facts remain unresolved; UI scenarios can still be designed from a page specification.
- 按当前实际宿主做静态入口诊断：ZCode 使用 `doctor-host --host zcode --json`，Codex 使用 `doctor-host --host codex --json`；复用前述同版本执行器。Files present, declared skill use, tool reads, host loading and verified behavior are different evidence; report unknown host loading or compliance as unknown.

同一用户任务涉及多个已安装且适用的包时复用同一 `runId`（`--run-id` / `WL_TASK_RUN_ID`）；本包不依赖其他包，仍可独立使用。
