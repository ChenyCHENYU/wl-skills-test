---
name: wl-skills-test
description: "Route testing work to wl-skills-test: test plans, cases, test review, onboarding, smoke/UI/API/performance testing and quality gates. For ordinary code changes, explain relevant testing constraints and coverage gaps without automatically executing tests or requests."
---

# wl-skills-test task gateway

Use the installed project's testing assets; no other wl-skills package is required.

多项目工作区先沿目标路径向上找到本包安装清单与项目 AGENTS，切到该项目根再调用工具；不要以聚合工作区根代替 projectRoot，也不要在聚合根安装。不同项目分别保存项目身份，同一用户任务复用 runId。

- Run `wl-skills-test task "<task>" --json` (or `npx @agile-team/wl-skills-test task "<task>" --json`). `route` and `explain` inspect the same decision without creating a task record.
- Read only the selected canonical `SKILL.md` and required standards from the returned project-relative paths. The canonical sources live in `.github/skills/` and `.github/standards/`; resolve references relative to each canonical file, not this gateway.
- Before editing, visibly show the returned `notice`: actual package/version, route status, selected Skill or baseline, rule IDs/names, target, runId and checks not yet executed. Include baseline, gaps and not-applicable decisions. Report missing/unsupported commands and version drift explicitly. If the route is ambiguous, ask one question; if it is a gap, report missing capability or files and a scoped improvement suggestion. A baseline is guidance for code changes, not a claim that a specialized test workflow ran.
- Reuse the returned `runId` with `--run-id` on authorized CLI checks. Show command receipts, verification outcomes and pending checks at handoff. `status --run-id <id> --json` reads those records.
- Do not run API requests, performance tests or write fixtures just because routing selected a skill. Follow the user's actual scope, environment authorization and cleanup constraints. Missing API facts remain unresolved; UI scenarios can still be designed from a page specification.
- `doctor-host --host codex --json` checks local discoverability. Files present, declared skill use, tool reads, host loading and verified behavior are different evidence; report unknown host loading or compliance as unknown.

Project-specific instructions and other packages' entries retain their own scope.

同一用户任务涉及多个已安装且适用的包时复用同一 `runId`（`--run-id` / `WL_TASK_RUN_ID`）；本包不依赖其他包，仍可独立使用。
