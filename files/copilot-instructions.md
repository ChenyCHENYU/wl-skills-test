# wl-skills-test 任务入口

本项目使用 `@agile-team/wl-skills-test`（v__WL_SKILLS_TEST_VERSION__），测试领域独立可用。

每次代码或测试任务先运行 `node node_modules/@agile-team/wl-skills-test/bin/wl-skills-test.js task "<任务>" --json`，仅规划，不执行业务请求。 本地执行器缺失时仅可用已有同版本缓存：`npx --offline --yes --package @agile-team/wl-skills-test@__WL_SKILLS_TEST_VERSION__ wl-skills-test task "<任务>" --json`；无缓存明确未执行，不静默联网安装。只读取返回的 `skillPaths` 和 `requiredFiles`；13 个技能触发清单保留在执行包内，按 task 返回的实际路径读取，覆盖 onboarding/plan/case/exec/quality/perf。

开工时简短说明 `matched / baseline / ambiguous / gap / not-applicable`、选定技能与约束。歧义先明确工作流；必要技能或规范缺失时报告 gap 和补充建议，不能声称约束就绪。普通代码任务只适用测试基线，不自动执行接口或压测。

复用返回的 `runId`：实际执行 `audit / run-api / run-playwright / run-jmeter / e2e-check / gate` 时传 `--run-id`；结束用 `status --run-id <ID> --json` 分别报告执行状态与验证状态。报告只聚合同一 runId，未执行的检查保持未验证。

`route`、`explain` 是只读路由；`doctor-host --host codex --json` 是静态入口诊断。文件存在、安装通过、模型自报均不能证明宿主已读取或遵循；宿主加载和行为证据未知时明确 unknown / unverified。技能命中不能替代真实 API 事实、执行授权、测试数据隔离与清理。

同一用户任务涉及多个已安装且适用的包时复用同一 `runId`（`--run-id` / `WL_TASK_RUN_ID`）；本包不依赖其他包，仍可独立使用。
