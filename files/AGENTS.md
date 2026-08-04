# Agent — wl-skills-test

## 项目上下文

本项目使用 `@agile-team/wl-skills-test`（v__WL_SKILLS_TEST_VERSION__）测试工程技能包，包含 11 条测试规范和 12 个 AI Skill。

## 技能加载

技能定义在 `.github/skills/` 下，分 5 组：plan / case / exec / quality / perf。
触发词路由见 `.github/skills/_registry.md`。

## 规范约束

测试规范在 `.github/standards/` 下（01-11），按任务类型自动加载。
关键约束：冒烟通过率≥95%、DI 密度<0.3、1天50条用例。
