# Claude Code — wl-skills-test

## 项目上下文

本项目已安装 `@agile-team/wl-skills-test`（v__WL_SKILLS_TEST_VERSION__）测试工程技能包。

## 能力

- 11 条测试规范（`.github/standards/01-11`）
- 12 个 AI Skill（`.github/skills/` 下 plan/case/exec/quality/perf 五组）
- 契约驱动用例生成（消费 kit/bd 机器契约）
- DI 缺陷指数质量门禁
- Playwright + JMeter 自动化脚本生成

## 快速触发

| 你说 | Skill |
|------|-------|
| 生成测试方案 | test-plan-generator |
| 分析业务场景 | test-scenario-analyzer |
| 生成测试用例 | test-case-generator |
| 质量评估/DI 分析 | test-quality-analyzer |
| 性能测试方案 | perf-plan-generator |
| JMeter 脚本 | perf-script-generator |

## CLI

```bash
npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --output 测试用例.md
npx @agile-team/wl-skills-test doctor
```
