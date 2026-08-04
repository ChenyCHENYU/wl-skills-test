# @agile-team/wl-skills-test

> 测试工程 AI 技能包 — 11 条测试规范 · 12 个 AI Skill · MCP 契约驱动 · Playwright + JMeter

[![Status](https://img.shields.io/badge/status-v0.2.0-blue.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)]()
[![Standards](https://img.shields.io/badge/standards-11-orange.svg)]()
[![Skills](https://img.shields.io/badge/skills-12-purple.svg)]()

与 `wl-skills-design`（产品设计）、`wl-skills-kit`（前端）、`wl-skills-ui`（样式）、`wl-skills-bd`（后端）协作，形成**设计 → 开发 → 测试**的完整工程闭环。

---

## 这是什么

一套可安装的测试工程技能包，把测试团队沉淀的流程规范、用例设计方法、自动化脚本生成、性能测试和质量门禁，注入到 AI 编辑器（Copilot / Cursor / Windsurf / Claude Code / Kiro / Trae / Qoder / 通用 Agents），让 AI **真正理解项目测试规范**，从需求文档 → 测试方案 → 用例 → 自动化脚本 → 质量评估全流程辅助。

### 五包协作

```
design(产品设计) → kit(前端代码) → ui(视觉对齐) → bd(后端代码) → test(测试验证)
     ↓                ↓                               ↓              ↑
  需求文档      page-spec/api.md              wl-contract.json   消费上游契约
                                                   +                 → 生成用例
                                             ServiceTest.java         → 自动化脚本
                                                                      → 质量评估
```

---

## 快速开始

```bash
# 安装测试技能体系（在项目根目录执行）
npx @agile-team/wl-skills-test

# 预览将写入哪些文件（不实际写入）
npx @agile-team/wl-skills-test --dry-run

# 增量更新
npx @agile-team/wl-skills-test@latest update

# 环境体检
npx @agile-team/wl-skills-test doctor
```

---

## 核心能力

| 维度 | 现状 |
|---|---|
| 版本 | v0.2.0 |
| 测试规范 | 11 条（01-流程 ~ 11-数据安全），对齐在线 QC 流程规范 |
| AI Skill | 12 个（plan 2 / case 3 / exec 3 / quality 1 / perf 3） |
| MCP 工具 | 7 个（wls_test_* 前缀，已实现） |
| 契约消费 | 支持 kit wl-api-contract / bd wl-contract.json / page-spec 三种格式 |
| 自动化 | Playwright（前端） + JMeter 5.6.3（性能） |
| 质量门禁 | DI 缺陷指数 + 上线判定 4 指标 + CI 集成脚本 |
| 测试覆盖 | 10 个单元测试（plan-hash/write-guard/DI/smoke/export） |

---

## 12 个 Skill 流水线

### 功能测试链（9 个）

```
需求文档 ──→ ① test-plan-generator     测试方案（7 章标准化）
         ──→ ② test-scenario-analyzer   业务场景（10 类全覆盖）
              ↓
         ──→ ③ test-case-generator      功能+流程用例（P0~P3）
              ↓
         ──→ ④ test-case-reviewer       5 维评审（重读需求）
              ↓
         ──→ ⑤ smoke-test-selector      冒烟套件（≤8/15/25）
              ↓
         ──→ ⑥ smoke-test-executor      冒烟执行+报告
         ──→ ⑦ test-script-generator    Playwright 脚本
              ↓
         ──→ ⑧ universal-test-rules     自动化规则基座
              ↓
         ──→ ⑨ test-quality-analyzer    DI 质量评估+上线判定
```

### 性能测试链（3 个）

```
API 文档 ──→ ⑩ perf-plan-generator      性能方案（三场景+SLA）
         ──→ ⑪ perf-script-generator    JMeter jmx 脚本
         ──→ ⑫ perf-report-analyzer     jtl 分析+瓶颈诊断
```

---

## 11 条测试规范

| # | 规范 | 说明 |
|---|------|------|
| 01 | 测试流程规范 | 需求评审→工作量评估→用例编制→评审→冒烟转测→执行→封版→上线→用户手册 |
| 02 | 用例设计标准 | 场景描述法、P0~P3 四级、数量与工作量匹配（1天50条） |
| 03 | 用例设计方法 | 场景法/边界值/等价类/错误推测/状态迁移 |
| 04 | 测试策略设计 | 功能+系统+探索性测试，迭代增量模型 |
| 05 | 冒烟测试规范 | 转测门槛（95%通过）、套件规模（≤8/15/25）、自测清单 |
| 06 | 自动化测试规范 | Playwright + Element Plus 模式、数据闭环、全按钮覆盖 |
| 07 | 性能测试规范 | JMeter 5.6.3、三场景（日常/峰值/疲劳）、SLA 阈值 |
| 08 | 质量门禁 | DI 公式、DI 密度、上线判定 4 指标、4 级预警 |
| 09 | 缺陷管理 | bug 录入规范、严重程度分级、回归测试规则 |
| 10 | 测试报告 | 测试报告模板、上线验证点、线上验证流程 |
| 11 | 测试数据安全 | 脱敏规范、不碰生产、测试数据清理 |

---

## 与 wl-skills 生态的协作

| 连接点 | 数据流向 | 实现阶段 |
|--------|---------|---------|
| design 需求文档 → test | 测试方案/场景分析输入源 | 第一阶段 |
| kit page-spec → test | 功能用例（页面维度） | 第二阶段 |
| kit api.md → test | 接口测试用例 + 断言期望 | 第二阶段 |
| bd wl-contract.json → test | 接口用例矩阵 + 行为测试 | 第二阶段 |
| bd permissions → test | 权限矩阵测试用例 | 第二阶段 |
| bd ServiceTest → test | 质量评估复用 | 第二阶段 |

---

## 技术栈

| 类别 | 基线 |
|------|------|
| 前端自动化 | Playwright + TypeScript |
| UI 框架 | Element Plus + Vue 3（脚本生成目标） |
| 性能测试 | JMeter 5.6.3 + ServerAgent |
| 平台 | Java 8 / Spring Boot 2 / jh4j-cloud 3（后端测试目标） |
| Node.js | >= 20 |

---

## 文档

- [架构设计](./docs/architecture.md) — 包结构、五包协作、技能流水线
- [分析文档](./docs/analysis.md) — testing-skills-0723 分析与迁移决策

---

Copyright © 2026 AGILE TEAM · All Rights Reserved
