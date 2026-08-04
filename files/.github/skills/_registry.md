# Skill 触发词路由表

> 所有 Skill 通过 `_route-evals.json` 的短语边界匹配自动触发，此文件为人读索引。

## 功能测试链

| 触发词 | Skill | 分组 |
|--------|-------|------|
| 生成测试方案 / 编制测试计划 / 测试方案 | test-plan-generator | plan |
| 分析业务场景 / 梳理测试场景 / 业务场景清单 | test-scenario-analyzer | plan |
| 生成测试用例 / 编写用例 / 功能用例 | test-case-generator | case |
| 评审测试用例 / 用例评审 / 用例质量检查 | test-case-reviewer | case |
| 筛选冒烟用例 / 冒烟套件 / 提取冒烟 | smoke-test-selector | case |
| 执行冒烟测试 / 冒烟执行 / 冒烟报告 | smoke-test-executor | exec |
| 生成自动化脚本 / Playwright 脚本 / UI 自动化 | test-script-generator | exec |
| 自动化测试规则 / 通用测试规则 | universal-test-rules | exec |
| 质量评估 / DI 分析 / 缺陷指数 / 上线判定 | test-quality-analyzer | quality |

## 性能测试链

| 触发词 | Skill | 分组 |
|--------|-------|------|
| 性能测试方案 / 压测方案 / perf 方案 | perf-plan-generator | perf |
| JMeter 脚本 / 生成 jmx / 压测脚本 | perf-script-generator | perf |
| 分析性能报告 / jtl 分析 / 性能瓶颈 / perf 报告 | perf-report-analyzer | perf |
