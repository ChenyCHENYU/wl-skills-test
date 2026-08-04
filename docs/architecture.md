# 架构设计 — wl-skills-test

> 版本：v0.1.0 · 创建日期：2026-08-04 · 维护：AGILE TEAM

---

## 一、定位

`@agile-team/wl-skills-test` 是 wl-skills 生态的**第五个包**，补齐测试验证环节，形成设计→开发→测试的完整闭环：

```
design(产品设计) → kit(前端代码) → ui(视觉对齐) → bd(后端代码) → test(测试验证)
```

不重新发明测试方法论，而是把测试团队已有的流程规范（在线 QC 文档）和实战经验（testing-skills-0723 的 12 个技能）工程化为可安装、可校验、可与上游代码生成包协作的 AI 技能包。

---

## 二、包结构

```
wl-skills-test/
├── package.json                    # @agile-team/wl-skills-test v0.1.0
├── bin/
│   └── wl-skills-test.js           # CLI 入口（init/doctor/validate/run-gen/clean）
├── lib/
│   ├── index.js                    # 命令路由
│   ├── templates/                  # 输出模板
│   │   ├── test-plan.md            # 测试方案模板（7 章）
│   │   ├── smoke-checklist.md      # 自测清单模板
│   │   ├── playwright-base.spec.js # Playwright 基础脚本
│   │   └── quality-report.md       # DI 质量报告模板
│   └── （第二阶段）contract-consumer.js / test-codegen.js / write-guard.js
├── mcp/
│   ├── server.js                   # MCP 服务骨架
│   ├── registry.js                 # 7 个工具注册表（wls_test_*）
│   └── tools/                      # （第二阶段）具体 handler
├── files/
│   └── .github/
│       ├── standards/              # 11 条测试规范（01-11）
│       └── skills/                 # 12 个 AI Skill
│           ├── _registry.md        # 触发词路由表
│           ├── _pipeline.md        # 流水线编排
│           ├── plan/               # 测试方案组（2 个）
│           ├── case/               # 用例设计组（3 个）
│           ├── exec/               # 测试执行组（3 个）
│           ├── quality/            # 质量评估组（1 个）
│           └── perf/               # 性能测试组（3 个）
├── docs/
│   ├── architecture.md             # 本文件
│   └── analysis.md                 # 分析文档（迁移决策）
└── test/                           # 包自身自动化测试
```

---

## 三、五包协作架构

### 3.1 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                    design (产品设计) v0.8.0                          │
│  产物：需求文档 / design-model.json (稳定ID) / API 报文              │
└────────────────────────────┬────────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                                     ▼
┌─────────────────────┐               ┌─────────────────────┐
│  kit (前端) v2.14.3 │ ◄═ 契约握手 ═► │  bd (后端) v0.17.10 │
│  • page-spec JSON   │   wl-api-     │  • wl-contract.json │
│  • api.md           │   contract    │  • ServiceTest.java │
│  • mock/            │               │  • 权限码清单        │
└────────┬────────────┘               └────────┬────────────┘
         │                                     │
         │      ┌──────────────────────────────┘
         │      │
         ▼      ▼
┌─────────────────────────────────────────────────────────────────────┐
│              ★ wl-skills-test (测试) v0.1.0 ★                       │
│                                                                     │
│  消费：需求文档 → 测试方案/场景                                      │
│        page-spec → 功能用例                                          │
│        api.md → 接口用例+断言                                        │
│        wl-contract.json → 接口矩阵+行为测试                          │
│        permissions → 权限矩阵用例                                    │
│                                                                     │
│  产出：测试方案.md / 场景清单 / 用例.xlsx / 自测清单.md              │
│        Playwright 脚本 / JMeter jmx / 质量报告(DI) / 测试报告.md    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 契约消费点（第二阶段实现）

| 上游包 | 产物 | test 消费方式 |
|--------|------|-------------|
| design | 需求文档 | test-plan-generator / test-scenario-analyzer 输入 |
| kit | page-spec JSON | 解析页面字段+交互模式 → 功能用例 |
| kit | api.md | 接口约定 → 接口测试断言 |
| bd | wl-contract.json | 资源+操作+字段 → 接口测试矩阵 |
| bd | permissions | 权限码 → 角色×菜单×动作权限用例 |
| bd | ServiceTest | 行为测试结果 → 质量评估复用 |

---

## 四、12 个技能流水线

### 功能测试链（9 个）

```
需求文档
  │
  ├─→ ① test-plan-generator ──── 测试方案（7 章标准化）
  │                             输入：需求文档
  │                             输出：测试方案.md
  │
  ├─→ ② test-scenario-analyzer ── 业务场景（10 类全覆盖）
  │                             输入：需求文档
  │                             输出：业务场景清单
  │
  └─→ ③ test-case-generator ───── 功能+流程用例（P0~P3）
        │                       输入：需求 + 场景 + (第二阶段)page-spec/contract
        │                       输出：测试用例
        │
        ├─→ ④ test-case-reviewer ── 5 维评审（重读需求）
        │                       输入：用例 + 原始需求
        │                       输出：评审报告
        │
        ├─→ ⑤ smoke-test-selector ─ 冒烟套件（≤8/15/25）
        │     │                 输入：全量用例
        │     │                 输出：冒烟套件
        │     │
        │     └─→ ⑥ smoke-test-executor ── 执行+报告
        │
        ├─→ ⑦ test-script-generator ─ Playwright 脚本
        │     │                   输入：页面信息 + (第二阶段)api.md
        │     │                   输出：.spec.js + auth.json
        │     │
        │     └─→ ⑧ universal-test-rules ── 自动化规则基座
        │
        └─→ ⑨ test-quality-analyzer ── DI 质量评估+上线判定
                                      输入：执行结果 + 缺陷单
                                      输出：质量报告
```

### 性能测试链（3 个，独立）

```
API 文档
  │
  ├─→ ⑩ perf-plan-generator ──── 性能方案（三场景+SLA）
  │                            输入：API 文档 + 业务需求
  │                            输出：性能测试方案.md
  │
  ├─→ ⑪ perf-script-generator ── JMeter jmx 脚本
  │                            输入：接口定义 + 并发参数
  │                            输出：.jmx + CSV + .bat
  │
  └─→ ⑫ perf-report-analyzer ──── jtl 分析+瓶颈诊断
                               输入：result.jtl + 监控 CSV
                               输出：性能报告.md
```

---

## 五、MCP 工具规划（7 个，第二阶段实现）

| 工具名 | 用途 | 状态 |
|--------|------|:----:|
| `wls_test_standards` | 查询测试规范 | 骨架 |
| `wls_test_contract_read` | 读取 kit/bd 机器契约 | 骨架 |
| `wls_test_case_generate` | 按契约+需求生成用例 | 骨架 |
| `wls_test_smoke_select` | 筛选冒烟套件 | 骨架 |
| `wls_test_env_check` | 校验测试环境连通性 | 骨架 |
| `wls_test_quality_analyze` | DI 质量评估+上线判定 | 骨架 |
| `wls_test_jmeter_validate` | 校验 JMeter jmx 有效性 | 骨架 |

---

## 六、三阶段演进计划

### 第一阶段（v0.1.0，当前）— 知识资产工程化

- ✅ 工程骨架（package.json / CLI / 目录结构）
- ✅ 11 条测试规范（对齐在线 QC 文档）
- ✅ 12 个 Skill 迁移重构（修复悬空引用/编号/重复）
- ✅ 模板文件（测试方案/自测清单/Playwright/质量报告）
- ✅ MCP 注册表骨架
- ✅ 架构文档 + 分析文档

### 第二阶段（v0.2.0）— 生态连接

- contract-consumer.js（消费 kit page-spec + bd wl-contract.json）
- MCP 7 个工具完整实现
- run-gen 命令（一键从契约生成用例）
- write-guard 安全写链

### 第三阶段（v0.3.0）— 自动化执行

- Playwright 脚本自动生成（消费 kit 页面注册 + api.md）
- JMeter 脚本校验（解决 ConfigTestElement 等坑）
- DI 质量门 CI 集成

---

## 七、设计原则

1. **与四包同构**：遵循 wl-skills-* 统一架构（CLI/standards/skills/MCP/write-guard/编辑器适配）
2. **契约驱动**：不猜测试用例，消费上游机器契约
3. **流程对齐**：与在线 QC 文档的完整测试流程一一对应
4. **实战优先**：保留 testing-skills-0723 的全部踩坑经验（JMeter XML/Element Plus/DI 门禁）
5. **独立可用**：没有上游包也能从需求文档独立工作，有上游包时增强

---

## 八、与 testing-skills-0723 的关系

| 维度 | testing-skills-0723 | wl-skills-test |
|------|---------------------|----------------|
| 形态 | 纯提示词文档 | 工程包（CLI+MCP+standards+模板） |
| 平台 | Hermes 平台专用 | 平台无关，npx 即用 |
| CLI | 无 | init/doctor/validate/run-gen/clean |
| MCP | 无 | 7 个 wls_test_*（规划） |
| 上游连接 | 无 | 消费 design/kit/bd 契约 |
| 缺陷 | 悬空引用/编号混乱/无校验 | 已修复 |
| 知识资产 | 12 个 SKILL.md 原始版 | 迁移重构后保留全部核心内容 |
