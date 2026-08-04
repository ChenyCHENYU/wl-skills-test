# AI 测试技能主入口

本项目已安装 `@agile-team/wl-skills-test` 测试工程技能包。

## 快速触发

| 你说 | 触发的 Skill |
|------|-------------|
| "生成测试方案" / "编制测试计划" | test-plan-generator |
| "分析业务场景" / "梳理测试场景" | test-scenario-analyzer |
| "生成测试用例" / "编写用例" | test-case-generator |
| "评审测试用例" / "用例评审" | test-case-reviewer |
| "筛选冒烟用例" / "冒烟套件" | smoke-test-selector |
| "执行冒烟测试" | smoke-test-executor |
| "生成自动化脚本" / "Playwright 脚本" | test-script-generator |
| "质量评估" / "DI 分析" / "上线判定" | test-quality-analyzer |
| "性能测试方案" / "JMeter 脚本" | perf-plan-generator / perf-script-generator |
| "分析性能报告" / "jtl 分析" | perf-report-analyzer |

## 测试规范

共 11 条，位于 `.github/standards/`，AI 按任务类型自动加载。

## 流水线

```
需求 → 方案 → 场景 → 用例 → 评审 → 冒烟 → 执行 → 脚本 → 质量评估
```
