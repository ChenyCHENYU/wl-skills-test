# 分析文档 — testing-skills-0723 迁移决策

> 创建日期：2026-08-04 · 用于记录从 testing-skills-0723 到 wl-skills-test 的迁移决策依据

---

## 一、testing-skills-0723 分析总结

### 1.1 整体评价

testing-skills-0723 是一组**高质量测试技能文档集**，覆盖功能测试链（9 个技能）+ 性能测试链（3 个技能），实战经验密度高。但它是**纯提示词文档**，无 CLI/MCP/standards/校验脚本，脱离 Hermes 平台不可独立使用。

### 1.2 核心资产（值得保留）

| 资产 | 价值 | 所在技能 |
|------|------|---------|
| DI 缺陷指数质量门禁 | 公式严谨，上线判定 4 指标可量化 | test-quality-analyzer |
| JMeter XML 踩坑库（11 条强制规则） | ConfigTestElement/SteppingThreadGroup/PerfMon 等真实坑 | perf-script-generator |
| Element Plus 自动化模式库（18 条规则） | driver.js/ag-grid/响应式应对 | test-script-generator |
| 10 类业务场景全覆盖 | 含行业运营盲区挖掘 | test-scenario-analyzer |
| 冒烟套件定量标准 | ≤8/15/25 条 + 纳入/排除规则 | smoke-test-selector |
| 两阶段自动化测试 | 阶段A数据闭环 + 阶段B全按钮覆盖 | universal-test-rules |
| 大文件分级处理 | <50MB~>10GB 四档策略 | perf-report-analyzer |

### 1.3 核心问题（必须修复）

| 问题 | 严重度 | 迁移处理 |
|------|:------:|---------|
| `browser-mcp-rules` 外部依赖不存在 | 🔴 | 删除引用，改为"浏览器 MCP 工具（如有）" |
| `hermes_tools` 伪代码 | 🔴 | 删除 |
| templates/scripts 目录全缺失 | 🔴 | 补齐模板到 lib/templates/ |
| references 1 行指针文件 | 🟡 | 跳过 |
| Windows 编码规范重复 12 处 | 🟡 | 合并为 canonical 单一引用 |
| 编号跳跃/重复 | 🟡 | 清理重排 |
| 无包级 README/索引 | 🟡 | 新建 |
| 无版本治理/CHANGELOG | 🟢 | 新建 |

---

## 二、迁移决策

### 2.1 为什么不直接用 testing-skills-0723

1. **不可独立使用**：依赖 Hermes 平台和 hermes_tools
2. **无法与代码生成包协作**：不能消费 kit/bd 的机器契约
3. **不符合 wl-skills 工程标准**：无 CLI/无 MCP/无 standards/无校验

### 2.2 为什么选择工程化重构而非直接搬运

保留全部知识资产（12 个 SKILL.md 核心内容），但升级为 wl-skills-* 工程标准：
- 加 CLI → 可 npx 安装
- 加 MCP → 与 AI 编辑器深度集成
- 加 standards → 与在线 QC 流程对齐
- 加模板 → 补齐缺失的 jmx/playwright/excel
- 修缺陷 → 清理全部悬空引用和编号问题

### 2.3 迁移保留/修改/新增清单

| 动作 | 内容 |
|------|------|
| **保留** | 12 个 SKILL.md 的核心流程/模板/校验清单/定量约束/踩坑经验 |
| **删除** | hermes_tools 引用、browser-mcp-rules 引用、1 行指针 references |
| **修复** | 编号跳跃、角色重复、步骤 0 混乱、Windows 编码规范重复 |
| **新增** | package.json、CLI、11 条 standards、模板文件、MCP 骨架、README、CHANGELOG、架构文档 |

---

## 三、四包协作模式分析

### 3.1 现有四包统一骨架

| 层 | 约定 | design | kit | ui | bd | **test** |
|----|------|:------:|:---:|:--:|:--:|:--------:|
| 包名 | `@agile-team/wl-skills-<scope>` | ✅ | ✅ | ✅ | ✅ | ✅ |
| CLI | 单 bin + 子命令 | ✅ | ✅ | ✅ | ✅ | ✅ |
| standards | NN-name.md + index.md | 9 | 14 | 9 | 28 | **11** |
| skills | SKILL.md + _registry | 9 | 12 | 22 | 12 | **12** |
| MCP | registry.js + 前缀 | 0 | 23 | 10 | 16 | **7** |
| write-guard | planHash + confirm | ✅ | ✅ | ✅ | ✅ | 规划 |
| 契约 | 机器 JSON + compare | — | ✅ | — | ✅ | 消费 |

### 3.2 test 包的差异化

test 包与其他四包的关键差异：
1. **消费方而非生产方**：其他包生产代码/设计/样式，test 包消费这些产物生成验证
2. **无代码生成目标**：不生成 Vue/Java 代码，生成测试文档/脚本/报告
3. **质量度量是核心**：DI 指数/上线判定是 test 包独有的工程价值

---

## 四、对在线 QC 文档的对齐

在线 QC 文档（https://www.tzagileteam.com/qc/standard/norm）定义了完整测试流程，本包按以下方式对齐：

| QC 流程环节 | 本包技能 | 本包规范 | 产出物 |
|------------|---------|---------|--------|
| 需求评审→测试点 | test-scenario-analyzer | 01/03 | 业务场景清单 |
| 工作量评估→计划 | test-plan-generator | 01/04 | 测试方案.md |
| 用例编制 | test-case-generator | 02/03 | 测试用例 |
| 用例评审 | test-case-reviewer | 02 | 评审报告 |
| 自测清单 | smoke-test-selector | 05 | 自测清单 |
| 冒烟转测 | smoke-test-executor | 05 | 冒烟报告 |
| 执行测试 | test-script-generator + universal-test-rules | 06 | Playwright 脚本 |
| BUG 回归+质量 | test-quality-analyzer | 08/09 | 质量报告(DI) |
| 封版→报告 | test-plan-generator | 10 | 测试报告+上线验证点 |
| 性能测试 | perf-plan/script/report | 07 | jmx+性能报告 |
| 数据安全 | — | 11 | 脱敏规范 |

---

## 五、后续完善方向

1. **contract-consumer 实现**：实际解析 kit/bd JSON 契约
2. **权限矩阵测试**：从 bd permissions 生成角色×菜单×动作测试矩阵
3. **Playwright 脚本生成增强**：消费 kit 页面注册信息自动生成选择器
4. **JMeter 脚本校验器**：实现 wls_test_jmeter_validate 的 XML 结构校验
5. **DI 质量门 CI 集成**：test-quality-analyzer 结果接入 CI/CD 卡门
6. **测试数据管理技能**：独立的测试数据准备/清理技能
