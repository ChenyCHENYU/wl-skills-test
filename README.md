# @agile-team/wl-skills-test

<p align="center">
  <strong>测试工程 AI 技能包</strong><br>
  11 条测试规范 · 12 个 AI Skill · 7 个 MCP 工具 · 契约驱动用例生成
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.4.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green.svg" />
  <img src="https://img.shields.io/badge/standards-11-orange.svg" />
  <img src="https://img.shields.io/badge/skills-12-purple.svg" />
  <img src="https://img.shields.io/badge/MCP-10-teal.svg" />
  <img src="https://img.shields.io/badge/audit-T1--T12-red.svg" />
  <img src="https://img.shields.io/badge/tests-42%20pass-brightgreen.svg" />
</p>

---

## 🎯 这是什么

把测试团队沉淀的**流程规范、用例设计方法、自动化脚本生成、性能测试和质量门禁**，注入到 AI 编辑器（Copilot / Cursor / Windsurf / Claude Code / Kiro / Trae / Qoder / 通用 Agents），让 AI 从需求文档 → 测试方案 → 用例 → 自动化脚本 → 质量评估**全流程辅助**。

### 🔄 五包闭环

```
design ──→ kit ──→ ui ──→ bd ──→ test
产品设计   前端    样式    后端    测试验证
  │         │               │       ↑
需求文档  page-spec     contract  消费上游契约
         api.md                   → 生成用例
                                  → 自动化脚本
                                  → 质量评估
```

> **独立可用**：不依赖其他包也能从需求文档独立工作。联动只是增强（从契约自动生成用例），不是前置条件。

---

## 📦 安装

```bash
# 全量安装到当前项目（11 规范 + 12 Skill + 模板 + 9 编辑器配置）
npx @agile-team/wl-skills-test

# 预览将写入哪些文件
npx @agile-team/wl-skills-test --dry-run

# 增量更新
npx @agile-team/wl-skills-test update

# 环境体检
npx @agile-team/wl-skills-test doctor

# 审计测试代码（T1-T12 确定性规则）
npx @agile-team/wl-skills-test audit --target ./tests/

# 自动修复测试代码反模式
npx @agile-team/wl-skills-test fix --target ./tests/

# 执行 API 接口测试（从契约自动发请求）
npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url http://localhost:8080
```

安装后，AI 编辑器自动识别 `.github/skills/` 下的 12 个 Skill 和 `.github/standards/` 下的 11 条规范。

---

## 🧪 12 个 AI Skill

### 功能测试链（9 个）

| 步骤 | Skill | 触发词 | 产出 |
|:----:|-------|--------|------|
| ① | **test-plan-generator** | 生成测试方案 | 测试方案.md（7 章标准化） |
| ② | **test-scenario-analyzer** | 分析业务场景 | 业务场景清单（10 类全覆盖） |
| ③ | **test-case-generator** | 生成测试用例 | 功能+流程用例（P0~P3） |
| ④ | **test-case-reviewer** | 评审测试用例 | 5 维评审报告 |
| ⑤ | **smoke-test-selector** | 筛选冒烟用例 | 冒烟套件（≤8/15/25） |
| ⑥ | **smoke-test-executor** | 执行冒烟测试 | 冒烟执行报告 |
| ⑦ | **test-script-generator** | Playwright 脚本 | .spec.js + auth.json |
| ⑧ | **universal-test-rules** | 自动化规则 | 通用测试规范基座 |
| ⑨ | **test-quality-analyzer** | 质量评估 / DI 分析 | 质量报告（DI 指数 + 上线判定） |

### 性能测试链（3 个）

| 步骤 | Skill | 触发词 | 产出 |
|:----:|-------|--------|------|
| ⑩ | **perf-plan-generator** | 性能测试方案 | 性能方案（三场景+SLA） |
| ⑪ | **perf-script-generator** | JMeter 脚本 | .jmx + CSV + .bat |
| ⑫ | **perf-report-analyzer** | 分析性能报告 | 性能报告（瓶颈诊断） |

```
需求文档 ──→ ①方案 ──→ ②场景 ──→ ③用例 ──→ ④评审
                                              ↓
                                    ⑤冒烟套件 ──→ ⑥冒烟执行
                                              ↓
                                    ⑦Playwright ──→ ⑧规则基座
                                              ↓
                                    ⑨DI 质量评估 ──→ 上线判定

API 文档 ──→ ⑩性能方案 ──→ ⑪JMeter 脚本 ──→ ⑫性能报告
```

---

## 📋 11 条测试规范

| # | 规范 | 核心约束 |
|---|------|---------|
| 01 | 测试流程 | 需求评审→测试点→工作量→用例→评审→冒烟→执行→封版→上线 |
| 02 | 用例设计 | P0~P3 四级，1天50条，每功能点≥10条 |
| 03 | 设计方法 | 场景法/边界值/等价类/错误推测/状态迁移 |
| 04 | 测试策略 | 功能+系统+探索性，5 维度（功能/界面/权限/数据/兼容） |
| 05 | 冒烟测试 | 转测门槛 95%，套件 ≤8/15/25 |
| 06 | 自动化 | Playwright + Element Plus，两阶段（数据闭环+全按钮覆盖） |
| 07 | 性能测试 | JMeter 5.6.3，三场景，P99<500ms，11 条 XML 强制规则 |
| 08 | 质量门禁 | DI=致命×10+严重×3+一般×1+轻微×0.1，密度<0.3 |
| 09 | 缺陷管理 | 录入规范、分级、回归规则 |
| 10 | 测试报告 | 报告模板、上线验证 ≤1.5h |
| 11 | 数据安全 | 脱敏、不碰生产、AT_ 前缀 |

---

## 🔌 契约驱动（run-gen）

从 kit/bd 的机器契约**自动生成**测试资产：

```bash
# 生成测试用例（支持三种契约格式）
npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json

# 生成 Playwright 脚本
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type playwright

# 生成 JMeter jmx（200 并发）
npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --type jmeter --threads 200
```

| 契约来源 | 格式 | 自动生成 |
|---------|------|---------|
| kit | `wl-api-contract.json` | CRUD 用例矩阵 + 权限 + 必填校验 |
| bd | `wl-contract.json` | 5 标准操作 + customOperations + 必填 |
| kit | `page-spec.json` | 页面 CRUD 推断 + Playwright 选择器 |

---

## 🔧 7 个 MCP 工具

| 工具 | 用途 |
|------|------|
| `wls_test_standards` | 查询测试规范（按编号或名称） |
| `wls_test_contract_read` | 读取 kit/bd 契约，提取可测试资源 |
| `wls_test_case_generate` | 按契约+需求生成测试用例 |
| `wls_test_smoke_select` | 从全量用例筛选冒烟套件 |
| `wls_test_env_check` | 校验测试环境连通性 |
| `wls_test_quality_analyze` | DI 缺陷指数质量评估 + 上线判定 |
| `wls_test_jmeter_validate` | 校验 JMeter jmx 有效性 |

MCP server 通过 stdio 运行（零依赖 JSON-RPC）：

```bash
# 直接启动 MCP server
node node_modules/@agile-team/wl-skills-test/mcp/index.js

# 或通过 CLI
npx @agile-team/wl-skills-test --mcp
```

---

## 🎖️ DI 质量门（CI 集成）

```bash
# CI 中运行质量门（退出码 0=通过 / 1=阻断）
node node_modules/@agile-team/wl-skills-test/scripts/quality-gate.js \
  --defects defects.json --cases 150
```

上线判定 4 指标：

| # | 指标 | 阈值 |
|---|------|------|
| 1 | DI 密度 | < 0.3 |
| 2 | 致命缺陷关闭率 | 100% |
| 3 | 严重缺陷关闭率 | 100% |
| 4 | 最差模块缺陷收敛 | ≤20% |

---

## 📁 包结构

```
wl-skills-test/
├── bin/wl-skills-test.js          # CLI 入口（init/doctor/validate/run-gen/clean/--mcp）
├── lib/
│   ├── index.js                   # 命令路由 + 参数解析
│   ├── contract-consumer.js       # 契约消费（kit/bd/page-spec 三格式）
│   ├── test-codegen.js            # 用例生成 + DI + 冒烟 + Markdown
│   ├── playwright-generator.js    # Playwright 脚本生成
│   ├── jmeter-generator.js        # JMeter jmx 生成
│   ├── write-guard.js             # 安全写链（哈希确认 + 回滚）
│   ├── plan-hash.js               # 计划哈希
│   └── templates/                 # 输出模板（5 个）
├── mcp/
│   ├── index.js                   # stdio MCP server（零依赖 JSON-RPC）
│   ├── server.js                  # MCP server 工厂
│   ├── registry.js                # 7 个工具注册表
│   └── tools/handlers.js          # 7 个工具实现
├── scripts/
│   └── quality-gate.js            # DI 质量门 CI 脚本
├── files/                         # 安装到用户项目的内容
│   ├── .github/standards/         # 11 条规范
│   ├── .github/skills/            # 12 个 Skill（5 组）
│   ├── .mcp.json                  # MCP 配置
│   └── 9 个编辑器适配文件
├── docs/                          # 架构设计 + 分析文档
└── test/                          # 35 个单元测试
```

---

## 📊 能力总览

| 维度 | 数量 | 说明 |
|------|:----:|------|
| 测试规范 | 11 | 对齐在线 QC 流程规范 |
| AI Skill | 12 | 功能链 9 + 性能链 3 |
| MCP 工具 | 10 | wls_test_* 前缀，全部实现并有测试 |
| 审计规则 | 12 | T1-T12 确定性扫描器（Playwright/JMeter/用例） |
| 自动修复 | 3 | F1-F3（v-deep/beforeEach/waitForTimeout） |
| API 执行 | 1 | run-api 零依赖 HTTP 请求验证 + 冒烟报告 |
| 契约格式 | 3 | wl-api-contract / wl-contract / page-spec |
| 输出模板 | 5 | 测试方案/自测清单/Playwright/质量报告/JMeter |
| 单元测试 | 42 | 全部通过 |
| 编辑器适配 | 9 | Copilot/Cursor/Windsurf/Claude/Kiro/Trae/Cline/AGENTS/Qoder |

---

## 📐 工程能力闭环矩阵

> 对标 kit（R1-R16 审计 + safe-fix + validate 卡门）、bd（B1-B29 审计 + safe-fix + J1-J8 质量门）、ui（R001-R039 扫描 + fix + check 卡门）三包的成熟模式。

### 测试全生命周期能力覆盖

| 阶段 | 能力 | 状态 | 覆盖程度 | 说明 |
|:----:|------|:----:|:--------:|------|
| **规划** | 测试方案生成 | ✅ | 完整 | test-plan-generator + 7 章模板 |
| | 业务场景分析 | ✅ | 完整 | test-scenario-analyzer，10 类场景 |
| **设计** | 测试用例生成 | ✅ | 完整 | 契约驱动矩阵 + P0~P3 分级 + Skill |
| | 用例评审 | ⚠️ | 部分 | test-case-reviewer Skill（AI 驱动），无确定性规则引擎 |
| | 冒烟套件筛选 | ✅ | 完整 | 定量算法（≤8/15/25）+ Skill |
| **执行** | 冒烟执行 | ⚠️ | 部分 | smoke-test-executor Skill + run-api 实际发 HTTP 请求 |
| | Playwright 脚本生成 | ✅ | 完整 | 从 page-spec/契约生成选择器+数据闭环 |
| | JMeter 脚本生成 | ✅ | 完整 | 从契约 operations 生成，遵循 11 条 XML 规则 |
| | API 接口测试执行 | ✅ | 完整 | run-api 从契约自动发起 HTTP 请求验证 + 冒烟报告 |
| | Playwright 执行 | ❌ | 缺失 | 可生成脚本但无法调用 `playwright test` |
| | JMeter 执行 | ❌ | 缺失 | 可生成 jmx 但无法调用 `jmeter -n -t` |
| **审计** | 测试代码规范审计 | ✅ | 完整 | T1-T12 确定性扫描器（Playwright/JMeter/用例） |
| | 测试脚本质量检查 | ✅ | 完整 | T6-T9 JMeter 4 项 + 完整 11 条 XML 规则覆盖 |
| | 用例覆盖率校验 | ❌ | 缺失 | 无"功能点→用例"映射校验 |
| **修复** | 测试代码自动修复 | ✅ | 完整 | F1-F3（v-deep/beforeEach/waitForTimeout） |
| | 脚本反模式修复 | ✅ | 完整 | T2 硬编码检测 + T12 硬等待替换 |
| **质量门** | DI 缺陷指数卡门 | ✅ | 完整 | quality-gate.js CI 集成（但第 4 指标未实现） |
| | 冒烟通过率卡门 | ❌ | 缺失 | 转测门槛 95% 无执行器 |
| | 测试覆盖率卡门 | ❌ | 缺失 | 无覆盖率红线 |
| **报告** | 质量报告生成 | ✅ | 完整 | DI 报告 + 质量报告模板 |
| | 测试报告生成 | ⚠️ | 部分 | 模板存在，无从执行结果自动生成 |
| **工程** | 自检/体检 | ✅ | 完整 | doctor 命令 |
| | 文件校验 | ✅ | 完整 | validate 命令 |
| | 安全写链 | ✅ | 完整 | write-guard + hash + 回滚 |
| | 契约消费 | ✅ | 完整 | 3 格式自动检测 |
| | 版本占位符 | ✅ | 完整 | init 动态替换 |

### 与其他 wl-skills 包能力对标

| 能力维度 | kit (前端) | bd (后端) | ui (样式) | **test (测试)** | 差距 |
|---------|:----------:|:--------:|:--------:|:--------------:|:----:|
| 规范审计引擎 | R1-R16 (AST) | B1-B29 | R001-R039 (39条) | **T1-T12** | ✅ 已补齐 |
| 自动修复 | safe-fix (F1-F5) | code-fix-be (B3/B5) | fix (12条) | **F1-F3** | ✅ 已补齐 |
| 质量门对象 | 源码本身 | 源码本身 | 源码本身 | **外部 DI + 内部审计** | ✅ 已增强 |
| MCP 工具数 | 23 | 16 | 10 | **10** | 🟡 可继续扩展 |
| 确定性 vs AI 驱动 | 确定性 | 确定性 | 确定性 | **确定性+AI** | ✅ 已补齐 |
| 执行能力 | ❌ | ❌ | ❌ | **API 执行 ✅** | ✅ 领先 |

### 核心差距与优先级

| # | 缺失能力 | 影响程度 | 优先级 | 说明 |
|---|---------|:--------:|:------:|------|
| ~~1~~ | ~~测试代码审计引擎~~ | ~~🔴 致命~~ | ~~P0~~ | ✅ v0.4.0 已实现 T1-T12 |
| ~~2~~ | ~~测试代码自动修复~~ | ~~🔴 致命~~ | ~~P0~~ | ✅ v0.4.0 已实现 F1-F3 |
| ~~3~~ | ~~API 接口测试执行~~ | ~~🟡 高~~ | ~~P1~~ | ✅ v0.4.0 已实现 run-api |
| 4 | 质量门第 4 指标 | 🟢 中 | P2 | 最差模块缺陷收敛 ≤20% 未实现 |
| 5 | Playwright/JMeter 执行 | 🟢 中 | P2 | 可生成脚本但无法调用执行 |
| 6 | 用例覆盖率校验 | 🟢 中 | P2 | 无"功能点→用例"映射 |

---

## 🛠️ 技术栈

| 类别 | 基线 |
|------|------|
| 前端自动化 | Playwright + TypeScript |
| UI 框架 | Element Plus + Vue 3（脚本生成目标） |
| 性能测试 | JMeter 5.6.3 + ServerAgent |
| 后端测试目标 | Java 8 / Spring Boot 2 / jh4j-cloud 3 |
| Node.js | >= 20 |
| 依赖 | 零运行时依赖（纯 Node 内置模块） |

---

## 📖 文档

- [架构设计](./docs/architecture.md) — 包结构、五包协作、技能流水线
- [分析文档](./docs/analysis.md) — testing-skills-0723 迁移决策
- [CHANGELOG](./CHANGELOG.md) — 版本变更记录

---

## 📝 版本历程

| 版本 | 核心 |
|------|------|
| v0.1.0 | 工程骨架 + 11 规范 + 12 技能迁移 |
| v0.2.0 | 契约消费 + MCP 骨架 + 质量门 CI |
| v0.2.1 | ESM 修复（全命令可用）+ 回滚实现 |
| v0.3.0 | 自动化生成（Playwright+JMeter）+ 编辑器适配 |
| v0.3.1 | P0/P1 审计修复（MCP stdio + bd/page-spec 矩阵 + route-evals） |
| v0.3.2 | arg parser 强化 + 版本占位符 + npm 发布 |
| **v0.4.0** | **审计引擎 T1-T12 + 自动修复 F1-F3 + API 执行器 + 能力矩阵** |

---

Copyright © 2026 AGILE TEAM · All Rights Reserved
