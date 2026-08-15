# @agile-team/wl-skills-test

<p align="center">
  <strong>测试工程 AI 技能包</strong><br>
  11 条测试规范 · 12 个 AI Skill · 14 个 MCP 工具 · 契约驱动生成 · E2E 三轮策略 · 报告聚合 · 性能基线
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.7.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green.svg" />
  <img src="https://img.shields.io/badge/standards-11-orange.svg" />
  <img src="https://img.shields.io/badge/skills-12-purple.svg" />
  <img src="https://img.shields.io/badge/MCP-14-teal.svg" />
  <img src="https://img.shields.io/badge/audit-T1--T20-red.svg" />
  <img src="https://img.shields.io/badge/e2e-%E4%B8%89%E8%BD%AE%E7%AD%96%E7%95%A5-yellow.svg" />
  <img src="https://img.shields.io/badge/tests-122%20pass-brightgreen.svg" />
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

# 执行 API 接口测试（从契约自动发请求，{id} 自动取真实主键，新增自动清理）
npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url http://localhost:8080

# 执行 Playwright 自动化测试
npx @agile-team/wl-skills-test run-playwright --test-dir ./tests/

# 执行 JMeter 性能测试（-Jthreads 运行时生效）
npx @agile-team/wl-skills-test run-jmeter --jmx ./perf-test.jmx --threads 200

# 性能基线对比（劣化即非零退出，CI 卡门）
npx @agile-team/wl-skills-test perf-compare --current ./jmeter-results/result.jtl --baseline ./baseline/result.jtl

# 生成成熟 E2E 工程脚手架（三轮策略 + 网络监控 + 清理账本 + 写入门禁 + 登录态自动化）
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e
npx @agile-team/wl-skills-test run-gen --contract ./src/views --type e2e   # 目录批量扫描（真实项目 32 页面验证）

# 聚合各执行结果生成测试报告（对齐规范 10，含上线判定）
npx @agile-team/wl-skills-test report --api smoke.json --playwright playwright-result.json --defects defects.json --cases 150
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

> **生成即合规**：所有生成物均通过自家 T1-T20 审计（含 CSV 参数化、SLA 断言、`__P` 属性化线程参数），由 `test/self-consistency.test.js` 回归保证。

---

## 🎭 E2E 三轮策略（v0.6.0 引入，v0.7.0 落地增强，源自 wl-ui-produce 实战）

把炼钢生产平台 32+ 页面 e2e 验证有效的模式固化为**一键生成**的工程脚手架：

```bash
# 单页面（page-spec / 契约）
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e

# 批量：目录递归扫描 page-spec.json（真实项目 32 页面验证通过）
npx @agile-team/wl-skills-test run-gen --contract ./src/views --type e2e --output ./e2e
```

生成 12 个文件（support 五模块 + fixtures/pages.js + 四个 spec + config + README）：

```
e2e/
├── playwright.config.js          # 四 project：auth-setup / round1-readonly / round2-write / cleanup
├── fixtures/pages.js             # 页面清单（批量自动生成，路由从 page-spec dir 自动推导）
├── support/
│   ├── environment.js            # 写入门禁 + 登录态配置 + Authorization 捕获
│   ├── network-monitor.js        # 五道硬门（防假通过）
│   ├── run-ledger.js             # 清理账本（runId 业务键 + 主键归属校验 + 原子落盘）
│   ├── api-probe.js              # API 探针（信封校验）
│   └── cleanup.js                # 按账本逆序清理
└── tests/
    ├── auth-setup.spec.js        # 登录态自动化（env 驱动自动登录生成 storageState）
    ├── round1-readonly.spec.js   # 只读冒烟（批量循环页面 + 业务响应监控 + 写请求检测）
    ├── round2-write.spec.js      # 受控写入（有表单→UI 级闭环；否则 API 级）
    └── cleanup.spec.js           # 按账本恢复清理
```

**登录态自动化**：`E2E_LOGIN_USER/PASSWORD` 配置后 `npx playwright test --project=auth-setup` 自动登录保存 storageState，其余 project 检测到即自动复用；未配置账号时优雅跳过。

**ROUND2 双模式**：page-spec 提供表单必填字段 → UI 级闭环（点新增→按 label 填表→捕获保存响应真实主键→复用页面登录态做 API 落库校验→账本清理→零污染复查）；否则 API 级闭环。

**五道硬门（防假通过）**：

| # | 硬门 | 防什么 |
|---|------|--------|
| 1 | 必须观察到至少一个业务接口响应 | 防"只看元素不看接口"的假通过 |
| 2 | HTTP≥400 / 业务码≠成功码 / console error / pageerror 即失败 | 防链路级问题漏检 |
| 3 | 只读套件观察到写请求即失败 | 防冒烟偷偷改数据 |
| 4 | 跳转登录页 = 失败不是 skip | 防覆盖率虚高 |
| 5 | 新增必须返回真实主键 | 没主键就无法零污染清理 |

方法论详见安装后的 `.github/skills/exec/test-script-generator/references/e2e-rounds-pattern.md`（含"测试到什么程度、用例写到什么程度"的硬标准）。

---

## 🔧 14 个 MCP 工具

| 工具 | 用途 |
|------|------|
| `wls_test_standards` | 查询测试规范（按编号或名称） |
| `wls_test_contract_read` | 读取 kit/bd 契约，提取可测试资源 |
| `wls_test_case_generate` | 按契约+需求生成测试用例 |
| `wls_test_smoke_select` | 从全量用例筛选冒烟套件 |
| `wls_test_env_check` | 校验测试环境连通性 |
| `wls_test_quality_analyze` | DI 缺陷指数质量评估 + 上线判定 |
| `wls_test_jmeter_validate` | 校验 JMeter jmx 有效性 |
| `wls_test_audit` | 审计测试代码（T1-T20 确定性规则） |
| `wls_test_fix` | 自动修复反模式（默认预览，`confirm:true` 才写盘） |
| `wls_test_run_api` | 执行 API 接口测试（契约驱动发请求） |
| `wls_test_run_playwright` | 执行 Playwright 自动化测试 |
| `wls_test_run_jmeter` | 执行 JMeter 性能测试 |
| `wls_test_e2e_generate` | 生成 E2E 三轮策略脚手架（支持目录批量） |
| `wls_test_report_generate` | 聚合执行结果生成测试报告（含上线判定） |

另将 11 条测试规范以 **MCP resources** 只读资源暴露（`wl-test://standards/*.md`），AI 编辑器按需读取。

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
# CI 中运行质量门（退出码 0=通过 / 1=阻断；参数支持 --x=v 与 --x v 两种风格）
node node_modules/@agile-team/wl-skills-test/scripts/quality-gate.js \
  --defects defects.json --cases 150 \
  --audit-dir ./tests/ \
  --smoke-result smoke-result.json
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
├── bin/wl-skills-test.js          # CLI 入口（init/update/doctor/validate/run-gen/audit/fix/run-api/run-playwright/run-jmeter/perf-compare/report/clean/--mcp）
├── lib/
│   ├── index.js                   # 命令路由 + 参数解析 + CI 退出码
│   ├── contract-consumer.js       # 契约消费（kit/bd/page-spec 三格式 + 路由推导 + toolbar 操作推断）
│   ├── test-codegen.js            # 用例生成 + DI + 冒烟 + Markdown
│   ├── test-data-factory.js       # 测试数据工厂（枚举/约束/类型/字段名语义）
│   ├── playwright-generator.js    # Playwright 脚本生成
│   ├── jmeter-generator.js        # JMeter jmx 生成（CSV 参数化 + SLA 断言 + __P 属性化）
│   ├── e2e-generator.js           # E2E 三轮策略脚手架（批量 + 登录态 + UI/API 双模式 round2）
│   ├── api-executor.js            # API 执行器（真实主键替换 + 工厂 payload + 零污染清理）
│   ├── executors.js               # Playwright/JMeter 执行器 + jtl 解析（引号感知）
│   ├── perf-compare.js            # 性能基线对比（劣化判定）
│   ├── report-generator.js        # 测试报告聚合（规范 10 模板 + 上线判定）
│   ├── write-guard.js             # 安全写链（哈希确认 + 回滚）
│   ├── plan-hash.js               # 计划哈希
│   └── templates/                 # 输出模板（5 个）
├── mcp/
│   ├── index.js                   # stdio MCP server（零依赖 JSON-RPC，含 ping + resources）
│   ├── server.js                  # MCP server 工厂
│   ├── registry.js                # 14 个工具注册表
│   └── tools/handlers.js          # 14 个工具实现 + standards 资源
├── scripts/
│   └── quality-gate.js            # DI 质量门 CI 脚本（fail-closed）
├── files/                         # 安装到用户项目的内容
│   ├── .github/standards/         # 11 条规范
│   ├── .github/skills/            # 12 个 Skill（5 组）
│   ├── .mcp.json                  # MCP 配置
│   └── 9 个编辑器适配文件
├── .github/workflows/ci.yml       # 包自身 CI（双 OS × Node 20/22 + npm pack 校验 + 自动发布）
├── docs/                          # 架构设计 + 分析文档
└── test/                          # 122 个测试（单元 + CLI 集成 + 自一致性 + MCP stdio + 块级解析）
```

---

## 📊 能力总览

| 维度 | 数量 | 说明 |
|------|:----:|------|
| 测试规范 | 11 | 对齐在线 QC 流程规范（另以 MCP resources 只读暴露） |
| AI Skill | 12 | 功能链 9 + 性能链 3 |
| MCP 工具 | 14 | wls_test_* 前缀，全部实现并有测试（含 stdio round-trip + resources） |
| 审计规则 | 20 | T1-T20 确定性扫描器（T3/T4 块级精确解析） |
| 自动修复 | 6 | F1-F6（v-deep/beforeEach/waitForTimeout/硬编码/afterEach/测试名） |
| 执行器 | 3 | run-api（HTTP）/ run-playwright / run-jmeter + jtl 解析 |
| 契约格式 | 3 | wl-api-contract / wl-contract / page-spec（含目录批量） |
| E2E 脚手架 | 12 文件 | 三轮策略 + 五道硬门 + 清理账本 + 写入门禁 + 登录态自动化 |
| 数据工厂 | 1 模块 | 枚举/约束/类型/字段名语义驱动的合法测试值 |
| 性能基线 | 1 命令 | perf-compare 劣化判定（CI 非零退出） |
| 报告聚合 | 1 命令 | report 对齐规范 10 模板 + 上线判定 |
| 输出模板 | 5 | 测试方案/自测清单/Playwright/质量报告/JMeter |
| 单元+集成测试 | 122 | 全部通过（含 CLI 集成/自一致性/MCP stdio/quality-gate/块级解析） |
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
| **执行** | 冒烟执行 | ✅ | 完整 | smoke-test-executor Skill + run-api 实际发 HTTP 请求（真实主键 + 零污染清理） |
| | E2E 工程脚手架 | ✅ | 完整 | run-gen --type e2e 三轮策略（只读冒烟/受控写入/恢复清理） |
| | Playwright 脚本生成 | ✅ | 完整 | 从 page-spec/契约生成选择器+数据闭环 |
| | JMeter 脚本生成 | ✅ | 完整 | 从契约 operations 生成，CSV 参数化 + SLA 断言 + __P 属性化 |
| | API 接口测试执行 | ✅ | 完整 | run-api 从契约自动发起 HTTP 请求验证 + 冒烟报告 |
| | Playwright 执行 | ✅ | 完整 | run-playwright 调用 `playwright test` + 解析结果 |
| | JMeter 执行 | ✅ | 完整 | run-jmeter 调用 `jmeter -n -t` + 解析 jtl（P50/P95/P99/错误率） |
| **审计** | 测试代码规范审计 | ✅ | 完整 | T1-T20 确定性扫描器（Playwright/JMeter/用例，跳过 node_modules，容错单文件） |
| | 测试脚本质量检查 | ✅ | 完整 | T6-T18 覆盖 JMeter 全 11 条 XML 强制规则 |
| | 用例覆盖率校验 | ✅ | 完整 | T19（数量 < 10 条/功能点）+ T20（异常场景缺失） |
| **修复** | 测试代码自动修复 | ✅ | 完整 | F1-F6（v-deep/beforeEach/waitForTimeout/硬编码URL/afterEach/测试名） |
| | 脚本反模式修复 | ✅ | 完整 | T2 硬编码检测 + T12 硬等待替换 + F4-F6 |
| **质量门** | DI 缺陷指数卡门 | ✅ | 完整 | quality-gate.js 4 指标全部实现 + CI 集成 |
| | 冒烟通过率卡门 | ✅ | 完整 | quality-gate --smoke-result 支持 |
| | 测试覆盖率卡门 | ✅ | 完整 | audit T19/T20 + quality-gate --audit-dir |
| | 测试代码审计卡门 | ✅ | 完整 | quality-gate --audit-dir CI 阻断 |
| **报告** | 质量报告生成 | ✅ | 完整 | DI 报告 + 质量报告模板 |
| | 测试报告生成 | ✅ | 完整 | run-api 自动产出 md+json 报告（json 供质量门消费） |
| **工程** | 自检/体检 | ✅ | 完整 | doctor 命令 |
| | 文件校验 | ✅ | 完整 | validate 命令 |
| | 安全写链 | ✅ | 完整 | write-guard + hash + 回滚（库级能力，供程序化写入调用） |
| | 契约消费 | ✅ | 完整 | 3 格式自动检测 |
| | 版本占位符 | ✅ | 完整 | init 动态替换 |

### 与其他 wl-skills 包能力对标

| 能力维度 | kit (前端) | bd (后端) | ui (样式) | **test (测试)** | 差距 |
|---------|:----------:|:--------:|:--------:|:--------------:|:----:|
| 规范审计引擎 | R1-R16 (AST) | B1-B29 | R001-R039 (39条) | **T1-T20** | ✅ 已补齐 |
| 自动修复 | safe-fix (F1-F5) | code-fix-be (B3/B5) | fix (12条) | **F1-F6** | ✅ 已补齐 |
| 质量门对象 | 源码本身 | 源码本身 | 源码本身 | **外部 DI + 内部审计** | ✅ 已增强 |
| MCP 工具数 | 23 | 16 | 10 | **14** | 🟡 可继续扩展 |
| 确定性 vs AI 驱动 | 确定性 | 确定性 | 确定性 | **确定性+AI** | ✅ 已补齐 |
| 执行能力 | ❌ | ❌ | ❌ | **API/UI/性能执行 ✅** | ✅ 领先 |

### 核心差距与优先级

| # | 缺失能力 | 影响程度 | 优先级 | 说明 |
|---|---------|:--------:|:------:|------|
| ~~1~~ | ~~测试代码审计引擎~~ | ~~🔴 致命~~ | ~~P0~~ | ✅ v0.4.0 T1-T12 |
| ~~2~~ | ~~测试代码自动修复~~ | ~~🔴 致命~~ | ~~P0~~ | ✅ v0.4.0 F1-F3 |
| ~~3~~ | ~~API 接口测试执行~~ | ~~🟡 高~~ | ~~P1~~ | ✅ v0.4.0 run-api |
| ~~4~~ | ~~质量门第 4 指标~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 模块收敛 ≤20% |
| ~~5~~ | ~~Playwright 执行~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 run-playwright |
| ~~6~~ | ~~JMeter 执行~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 run-jmeter |
| ~~7~~ | ~~用例覆盖率校验~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 T19/T20 |
| ~~8~~ | ~~JMeter 全规则校验~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 T13-T18 |
| ~~9~~ | ~~自动修复 F4-F6~~ | ~~🟢 中~~ | ~~P2~~ | ✅ v0.5.0 硬编码/afterEach/测试名 |
| ~~10~~ | ~~审计接入 CI 卡门~~ | ~~🟡 高~~ | ~~P1~~ | ✅ v0.5.0 quality-gate --audit-dir |

> **全部缺口已清零**。v0.5.0 实现了完整的工程能力闭环：规范审计（T1-T20）→ 自动修复（F1-F6）→ 执行（API/Playwright/JMeter）→ 质量门（4 指标 + 审计卡门）→ 报告。

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
| v0.4.0 | 审计引擎 T1-T12 + 自动修复 F1-F3 + API 执行器 |
| v0.5.0 | 全部缺口清零：T1-T20 + F1-F6 + Playwright/JMeter 执行 + 质量门 4 指标 |
| v0.6.0 | 精准健壮修复（6 P0 + 全量 P1）+ E2E 三轮策略固化 + 测试 90 个 |
| **v0.7.0** | **落地增强：批量 E2E（32 页面实测）+ 登录态自动化 + T3/T4 块级精确化 + 数据工厂 + 报告聚合 + 性能基线 + MCP resources + CI，测试 122 个** |

---

Copyright © 2026 AGILE TEAM · All Rights Reserved
