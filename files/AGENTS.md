# wl-skills-test 任务入口

## 项目适用边界

先确认目标项目自身的接入证据（本包安装清单、直接依赖或 `.wl-skills-scope.json` 显式启用），再判定任务。只在目标已接入且平台适用时读取规则；父目录安装、兄弟包、Vue 文件或触发词不能证明接入。未接入的开源项目不套用规则、不建议自动安装；UniApp/小程序/App/PDA/移动 H5 不适用。跨项目目标分别判定，沿最近项目边界停止，不能越过未接入子项目找父清单。工具返回 `scope` 作为静态范围证据，宿主加载仍需实际事件。


本项目使用 `@agile-team/wl-skills-test`（v__WL_SKILLS_TEST_VERSION__），测试领域独立可用。

每次代码或测试任务先运行 `npx @agile-team/wl-skills-test task "<任务>" --json`，仅规划，不执行业务请求。只读取返回的 `skillPaths` 和 `requiredFiles`；13 个技能的权威触发清单是 `.wl-skills-test/routes.v1.json`，覆盖 onboarding/plan/case/exec/quality/perf。

编辑前必须展示实际 `notice`：包名/版本、判定、Skill 或基础约束、规则编号与名称、目标、runId 和尚未执行的检查；命令失败或版本不一致须明示，不能静默跳过。

开工时简短说明 `matched / baseline / ambiguous / gap / not-applicable`、选定技能与约束。歧义先明确工作流；必要技能或规范缺失时报告 gap 和补充建议，不能声称约束就绪。普通代码任务只适用测试基线，不自动执行接口或压测。

复用返回的 `runId`：实际执行 `audit / run-api / run-playwright / run-jmeter / e2e-check / gate` 时传 `--run-id`；结束用 `status --run-id <ID> --json` 分别报告执行状态与验证状态。报告只聚合同一 runId，未执行的检查保持未验证。

`route`、`explain` 是只读路由；`doctor-host --host codex --json` 是静态入口诊断。文件存在、安装通过、模型自报均不能证明宿主已读取或遵循；宿主加载和行为证据未知时明确 unknown / unverified。技能命中不能替代真实 API 事实、执行授权、测试数据隔离与清理。

同一用户任务涉及多个已安装且适用的包时复用同一 `runId`（`--run-id` / `WL_TASK_RUN_ID`）；本包不依赖其他包，仍可独立使用。
