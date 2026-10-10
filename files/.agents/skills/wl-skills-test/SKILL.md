---
name: wl-skills-test
description: "仅限目标自身已接入本包的项目；不继承父目录安装，排除移动端和未接入项目。 Route testing work to wl-skills-test: test plans, cases, test review, onboarding, smoke/UI/API/performance testing and quality gates. For ordinary code changes, explain relevant testing constraints and coverage gaps without automatically executing tests or requests."
---

# wl-skills-test task gateway

Use the installed project's testing assets; no other wl-skills package is required.

先确认目标项目自身的接入证据（本包安装清单、直接依赖或 `.wl-skills-scope.json` 显式启用），再判定任务。只在目标已接入且平台适用时读取规则；父目录安装、兄弟包、Vue 文件或触发词不能证明接入。未接入的开源项目不套用规则、不建议自动安装；UniApp/小程序/App/PDA/移动 H5 不适用。跨项目目标分别判定，沿最近项目边界停止，不能越过未接入子项目找父清单。工具返回 `scope` 作为静态范围证据，宿主加载仍需实际事件。

多项目工作区先沿目标路径向上找到本包安装清单与项目 AGENTS，切到该项目根再调用工具；不要以聚合工作区根代替 projectRoot，也不要在聚合根安装。不同项目分别保存项目身份，同一用户任务复用 runId。

- Run `wl-skills-test task "<task>" --json` (or `npx @agile-team/wl-skills-test task "<task>" --json`). `route` and `explain` inspect the same decision without creating a task record.
- Read only the selected canonical `SKILL.md` and required standards from the returned project-relative paths. The canonical sources live in `.github/skills/` and `.github/standards/`; resolve references relative to each canonical file, not this gateway.
- Before editing, visibly show the returned `notice`: actual package/version, route status, selected Skill or baseline, rule IDs/names, target, runId and checks not yet executed. Include baseline, gaps and not-applicable decisions. Report missing/unsupported commands and version drift explicitly. If the route is ambiguous, ask one question; if it is a gap, report missing capability or files and a scoped improvement suggestion. A baseline is guidance for code changes, not a claim that a specialized test workflow ran.
- Reuse the returned `runId` with `--run-id` on authorized CLI checks. Show command receipts, verification outcomes and pending checks at handoff. `status --run-id <id> --json` reads those records.
- Do not run API requests, performance tests or write fixtures just because routing selected a skill. Follow the user's actual scope, environment authorization and cleanup constraints. Missing API facts remain unresolved; UI scenarios can still be designed from a page specification.
- `doctor-host --host codex --json` checks local discoverability. Files present, declared skill use, tool reads, host loading and verified behavior are different evidence; report unknown host loading or compliance as unknown.

Project-specific instructions and other packages' entries retain their own scope.

同一用户任务涉及多个已安装且适用的包时复用同一 `runId`（`--run-id` / `WL_TASK_RUN_ID`）；本包不依赖其他包，仍可独立使用。
