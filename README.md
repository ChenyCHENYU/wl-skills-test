# @agile-team/wl-skills-test

<p align="center">
  <strong>测试工程 AI 技能包</strong><br>
  11 条测试规范 · 13 个 AI Skill · 19 个 MCP 工具 · 契约驱动生成 · 深度 E2E 工程 · 报告聚合 · 性能基线
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.24.0-blue.svg" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-green.svg" />
  <img src="https://img.shields.io/badge/standards-11-orange.svg" />
  <img src="https://img.shields.io/badge/skills-13-purple.svg" />
  <img src="https://img.shields.io/badge/MCP-19-teal.svg" />
  <img src="https://img.shields.io/badge/audit-T1--T25-red.svg" />
  <img src="https://img.shields.io/badge/API-%E5%9B%9B%E5%B1%82%E6%96%AD%E8%A8%80-yellow.svg" />
  <img src="https://img.shields.io/badge/tests-265%20pass-brightgreen.svg" />
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

# 深度接口测试（DAG 编排 + 四层断言 + 负例 + 契约漂移 + 零污染）
npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url http://localhost:8080

# 执行 Playwright 自动化测试
npx @agile-team/wl-skills-test run-playwright --test-dir ./tests/

# 执行 JMeter 性能测试（-Jthreads 运行时生效）
npx @agile-team/wl-skills-test run-jmeter --jmx ./perf-test.jmx --threads 200

# 性能基线对比（劣化即非零退出，CI 卡门）
npx @agile-team/wl-skills-test perf-compare --current ./jmeter-results/result.jtl --baseline ./baseline/result.jtl

# 生成深度 E2E 工程脚手架（7 层 project + 归属清单强校验 + 路由映射 + UI 契约拦截 + 隔离机制）
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e
npx @agile-team/wl-skills-test run-gen --contract ./src/views --type e2e --routes ./routes.sit.json  # 目录批量 + 显式路由映射

# E2E 工程强校验（归属闭环/安全标记/隔离声明，CI 卡门）
npx @agile-team/wl-skills-test e2e-check --target ./e2e

# 聚合各执行结果生成测试报告（对齐规范 10，含上线判定）
npx @agile-team/wl-skills-test report --api smoke.json --playwright playwright-result.json --defects defects.json --cases 150
```

安装后，AI 编辑器自动识别 `.github/skills/` 下的 13 个 Skill 和 `.github/standards/` 下的 11 条规范。

---

## 🧪 13 个 AI Skill

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

## 📊 test-reports 统一报告体系（v0.11.0）

安装包的项目里，**每个维度的测试都自动产出报告到 `test-reports/`**，并支持陆续迭代的趋势追踪：

| 命令 | 产出 |
|------|------|
| `run-api` | `api-报告.md`（四层断言/负例/权限/漂移/零污染章节）+ `api-result.json` |
| `run-playwright` | `e2e-报告.md`（解析 Playwright 原生 results.json，含失败明细）+ `playwright-result.json` |
| `run-jmeter` | `perf-报告.md`（P50/95/99 SLA 判定）+ `perf-result.json` |
| `audit` | `audit-报告.md`（T1-T25 规则分布+文件明细+修复入口）+ `audit-result.json` |
| `perf-compare` | `perf-compare-报告.md`（基线劣化判定） |
| `report`（不传参数） | **自动发现**上述结果 → `测试报告.md`（规范 10 + 上线判定）+ `index.md`（索引） |
| `report --trend` | 追加**最近 5 次汇总趋势表**（history.jsonl 数据源，跨迭代追踪质量） |

```
test-reports/
├── api-报告.md / api-result.json        # 接口维度
├── e2e-报告.md / playwright-result.json  # UI 维度
├── perf-报告.md / perf-result.json       # 性能维度
├── audit-报告.md / audit-result.json     # 审计维度
├── 测试报告.md / index.md                # 汇总 + 索引
└── history.jsonl                          # 运行历史（趋势数据源）
```

## 🧩 细粒度用例生成（v0.11.0）

```bash
npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --granularity field
npx @agile-team/wl-skills-test run-gen --contract ./wl-contract.json --granularity field --json cases.json   # v0.24.0 结构化输出
```

> **v0.24.0 JSON 化统一**：`run-gen / diff / perf-compare` 均支持 `--json <path>` 结构化产物；
> `report --plan-input` 聚合"写测试计划的一次性数据"（本次判定/质量分/维度覆盖/审计/性能/趋势）到
> `test-reports/plan-input.json`——计划由 AI 写，数据由工具给全。MCP 四个大结果工具全部默认紧凑输出。

基线矩阵（CRUD/权限/必填）之上，**颗粒度到字段**：必填置空、超长、数值 min/max 边界、非数值类型、
非法枚举、XSS/SQL 注入特殊字符、前后空格；操作级：重复提交、不存在主键、重复删除、无权限（每个写操作）、
分页边界、组合查询收敛。每条含优先级/前置/步骤/预期，且标注 **dimension ↔ run-api DAG 执行映射**
（大部分负例/权限/重复/分页用例由 run-api 自动执行闭环）。

---

## 🔬 沙箱模拟跑（v0.10.0，零污染验证）

```bash
node node_modules/@agile-team/wl-skills-test/scripts/simulate-e2e.mjs
```

**只读消费真实 page-spec + 路由映射，生成与执行全在临时沙箱 + 进程内 mock 前后端**（结束即删，源项目零写入）：
真实 32 页 steel 形态 → `--ui steel` 生成 → 语法/e2e-check 校验 → 沙箱安装 playwright → mock 前端
（steel-list-panel HTML）+ mock API（jh4j 信封）→ 真实浏览器逐页执行 ROUND1 五硬门（复用生成的
monitor/selectors/pages 资产）→ 32/32 全绿。环境不具备（无 Chrome/源项目）时优雅跳过，CI 安全。

**UI 适配层**：`run-gen --type e2e --ui element-plus|steel|ant-design`，选择器集中 `support/selectors.js`
（换组件库只改一个文件）；`E2E_CHANNEL=chrome` 用系统浏览器免下载。

**工位页模板**：page-spec 声明 `features.workstation: true` 生成 `workstation.spec.js`——查看态禁用断言、
进阶查询回填（拦截模拟计划行）、save/submit 契约（拦截 + 断言炉号），全部 page.route 零污染。
**子表页签**：`subTables` 自动生成逐页签渲染用例。

---

## 🧪 深度接口测试（v0.9.0）

```bash
npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json \
  --base-url http://sit.example.com --token "$TOKEN" \
  --token-no-perm "$NO_PERM_TOKEN" --dict-file ./dict.json
```

**执行链路（DAG，前置失败级联 skip 并标注原因）**：

```
列表冒烟 → 新增 → 写后读回比对 → 更新 → 详情 → 负例(必填缺失/类型错误/超长越界)
→ 重复提交(拒绝或幂等) → 权限拒绝(读探针/写探针) → 分页边界 → 清理 → 零污染复查
```

**每步四层断言**：

| 层 | 断言内容 | 防什么 |
|----|---------|--------|
| L1 | 成功信封（HTTP + 契约 successCode） | 接口挂了/业务失败 |
| L2 | 结构（records/total/契约字段存在且类型匹配） | 响应结构漂移 |
| L3 | 数据正确性（写后读回逐字段比对、清理后无残留） | 假成功（成功码但没写对/没写进去） |
| L4 | 负例与安全（必填/类型/超长必须被拒、重复提交、权限拒绝） | 后端校验缺口、越权 |

**契约漂移检测**：响应实际字段 vs 契约 models 全量 diff（契约声明但缺失 / 响应未声明 / 类型不符）——后端改了字段而契约没跟上，第一时间报出。

**精准性保障**：网络错误/超时记 error 绝不判为"被拒绝"（负例不会因连不上而假通过）；负例用独立业务键（与正例的重复校验互不掩盖）；意外成功的负例自动登记清理（零污染兜底）；每步报文快照留证可回溯。

**参数**：`--token-no-perm`（无权限账号，启用权限验证）· `--dict-file`（枚举字段真实合法值）· `--lenient-coercion`（后端隐式转换记 warn）· `--perm-write-probe`（写操作权限探针）· `--json`（供 quality-gate/report 消费）

---

## 🎭 深度 E2E 工程（v0.6 引入，v0.7 落地，v0.8 做深——全面对齐并超越 wl-ui-produce 实战）

```bash
# 单页面（page-spec / 契约）
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e

# 批量：目录递归扫描 + 显式路由映射（真实项目 32 页面 + 真实路由验证通过）
npx @agile-team/wl-skills-test run-gen --contract ./src/views --type e2e --routes ./e2e/fixtures/routes.sit.json
```

生成 17 个文件，**7 层 project 编排**（A/B/C 风险分层 + 工程强校验）：

```
e2e/
├── playwright.config.js          # 加载即执行 assertE2ESpecCatalog 强校验（防假闭环）
├── package.json                  # npm run e2e / e2e:auth / e2e:detail / e2e:ui-contract / e2e:round2 / e2e:cleanup
├── fixtures/
│   ├── pages.js                  # 页面清单（routeSource 标记 spec/map/derived，derived 需人工核对）
│   └── suites.js                 # 用例归属清单 + 加载期强校验
├── support/                      # environment（门禁+登录配置）/ network-monitor（五硬门+证据附件）
│                                 # / run-ledger / api-probe / cleanup
└── tests/
    ├── auth-setup.spec.js        # 登录双模式：默认人工（验证码/SSO/MFA），配账号自动填
    ├── round1-readonly.spec.js   # A组 冒烟（表格/空态 + 业务响应监控 + 写请求检测 + 证据附件）
    ├── round1-detail.spec.js     # A组 深度（列头渲染/搜索收敛/重置恢复/字典翻译，SIT无数据优雅skip）
    ├── ui-contract.spec.js       # 拦截模拟（page.route 断言端点+payload 契约，不落库，任何环境可跑）
    ├── round2-write.spec.js      # B组 受控写入（UI级含test-fill钩子/API级，账本+真实落库校验+零污染）
    ├── quarantine.spec.js        # 高风险隔离（test.skip B组 + 隔离准则声明，解除需移出清单）
    └── cleanup.spec.js           # 按账本恢复清理
```

**超越 wl-ui-produce 之处**：生成器路线（对方 32 页全手写 ~2 万行）+ 工程强校验模板化 + `e2e-check` 可对任意 e2e 工程独立执行 + 审计规则 T21-T25 固化同样约束 + 测试填充器标准（`test-fill-standard.md`，`data-testid="wl-test-fill"`）。

**工程强校验清单**（config 加载即 fail / `e2e-check` CI 卡门）：未归类 spec / 重复归属 / 清单有但文件缺失 / `test.only` / 写入组缺安全标记（requireWriteApproval、new RunLedger、finally、cleanupLedger）/ 截断 Bearer 前缀 / 隔离声明漂移 / UI 契约缺 `page.route`。

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

## 🔧 17 个 MCP 工具

| 工具 | 用途 |
|------|------|
| `wls_test_standards` | 查询测试规范（按编号或名称） |
| `wls_test_contract_read` | 读取 kit/bd 契约，提取可测试资源 |
| `wls_test_case_generate` | 按契约+需求生成测试用例 |
| `wls_test_smoke_select` | 从全量用例筛选冒烟套件 |
| `wls_test_env_check` | 校验测试环境连通性 |
| `wls_test_quality_analyze` | DI 缺陷指数质量评估 + 上线判定 |
| `wls_test_jmeter_validate` | 校验 JMeter jmx 有效性 |
| `wls_test_audit` | 审计测试代码（T1-T25 确定性规则） |
| `wls_test_fix` | 自动修复反模式（默认预览，`confirm:true` 才写盘） |
| `wls_test_run_api` | 执行 API 接口测试（契约驱动发请求） |
| `wls_test_run_playwright` | 执行 Playwright 自动化测试 |
| `wls_test_run_jmeter` | 执行 JMeter 性能测试 |
| `wls_test_e2e_generate` | 生成深度 E2E 工程脚手架（单页/目录批量/routes 映射） |
| `wls_test_report_generate` | 聚合执行结果生成测试报告（含上线判定） |
| `wls_test_e2e_check` | E2E 工程强校验（归属闭环/安全标记/隔离声明） |
| `wls_test_dict_sync` | 同步系统字典到 dict.json（三形态自动识别） |
| `wls_test_gate` | 质量门聚合（审计+E2E+冒烟+DI+性能一条命令卡门） |

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
├── bin/wl-skills-test.js          # CLI 入口（init/update/doctor/validate/run-gen/audit/fix/run-api/run-playwright/run-jmeter/perf-compare/e2e-check/dict-sync/gate/report/clean/--mcp）
├── lib/
│   ├── index.js                   # 命令注册表 + run() 路由（薄层）
│   ├── cli/                       # CLI 分层（v0.12.0 拆分）
│   │   ├── args.js                # 参数解析（布尔归一）
│   │   ├── installer.js           # init/update/clean（占位符版本比对）
│   │   ├── system.js              # doctor/validate
│   │   ├── webhook.js             # 质量门/报告结论推送
│   │   └── commands/              # generation / execution / quality / reports
│   ├── shared/                    # 共享基础层（单一事实源）
│   │   ├── utils.js               # readJsonFile(BOM/fail-closed)/writeTextFile/escapeMdCell
│   │   ├── types.js               # 契约字段类型分类器（生成/执行同口径）
│   │   └── thresholds.js          # 质量阈值常量（95%/DI 0.3/收敛 ≤20% 等）
│   ├── report/dimensions.js       # 报告维度注册表（新增维度 = 注册一个对象）
│   ├── contract-consumer.js       # 契约消费（kit/bd/page-spec 三格式 + 路由推导 + toolbar 操作推断）
│   ├── test-codegen.js            # 用例生成 + DI（含模块收敛）+ 冒烟 + Markdown
│   ├── case-fine-gen.js           # 细粒度用例（FG 内容哈希稳定 ID + dimension 映射）
│   ├── test-data-factory.js       # 测试数据工厂（枚举/约束/类型/字段名语义）
│   ├── playwright-generator.js    # Playwright 脚本生成
│   ├── jmeter-generator.js        # JMeter jmx 生成（CSV 参数化 + SLA 断言 + __P 属性化）
│   ├── e2e-generator.js           # E2E 三轮策略脚手架（批量 + 登录态 + UI/API 双模式 round2 + UI 适配层）
│   ├── api-executor.js            # API 执行器（逐字段负例 + 重试/并行 + 真实主键替换 + 零污染清理）
│   ├── executors.js               # Playwright/JMeter 执行器（异步 spawn 防注入 + jtl 流式解析）
│   ├── test-audit.js              # T1-T25 审计引擎（规则表驱动，T26+ 加一个对象）
│   ├── perf-compare.js            # 性能基线对比（劣化判定，基线缺失/为零不漏判）
│   ├── report-generator.js        # 测试报告聚合（维度注册表 + fail-closed + mtime 自动发现）
│   ├── report-dimensions.js       # 各维度报告渲染 + history.jsonl（容错读取）
│   ├── gate.js                    # 质量门聚合（含模块收敛，与 quality-gate 同口径）
│   ├── write-guard.js             # 安全写链（哈希确认 + 字节级备份回滚 + 重复目标拒绝）
│   ├── plan-hash.js               # 计划哈希（键序/路径/顺序归一化）
│   └── templates/                 # 输出模板（5 个）
├── mcp/
│   ├── index.js                   # stdio MCP server（零依赖 JSON-RPC，parity 启动校验 + required 参数校验）
│   ├── server.js                  # MCP server 工厂（同校验）
│   ├── registry.js                # 工具注册表（assertRegistryParity/validateToolInput）
│   └── tools/handlers.js          # 工具实现（与 CLI 共享 lib/，fix 写入带 root 约束）
├── scripts/
│   └── quality-gate.js            # DI 质量门 CI 脚本（复用 calculateDI 单一实现，fail-closed）
├── files/                         # 安装到用户项目的内容
│   ├── .github/standards/         # 11 条规范
│   ├── .github/skills/            # 13 个 Skill（6 组，含 test-onboarding 接入引导）
│   ├── .mcp.json                  # MCP 配置
│   └── 9 个编辑器适配文件
├── .github/workflows/ci.yml       # 包自身 CI（双 OS × Node 20/22 + npm pack 校验 + 自动发布）
├── docs/                          # 架构设计 + 分析文档
└── test/                          # 209 个测试（单元 + CLI 集成 + 自一致性 + MCP stdio + 引擎/生成器回归）
```

---

## 📊 能力总览

| 维度 | 数量 | 说明 |
|------|:----:|------|
| 测试规范 | 11 | 对齐在线 QC 流程规范（另以 MCP resources 只读暴露） |
| AI Skill | 12 | 功能链 9 + 性能链 3 |
| MCP 工具 | 17 | wls_test_* 前缀，全部实现并有测试（含 stdio round-trip + resources） |
| 审计规则 | 25 | T1-T25 确定性扫描器（T3/T4 块级精确解析 + T21-T25 E2E 工程约束） |
| 自动修复 | 6 | F1-F6（v-deep/beforeEach/waitForTimeout/硬编码/afterEach/测试名） |
| 执行器 | 3 | run-api（HTTP）/ run-playwright / run-jmeter + jtl 解析 |
| 契约格式 | 3 | wl-api-contract / wl-contract / page-spec（含目录批量） |
| E2E 脚手架 | 17 文件 | 7 层 project + 归属清单强校验 + 路由映射 + UI 契约拦截 + 隔离机制 + 登录双模式 |
| 数据工厂 | 1 模块 | 枚举/约束/类型/字段名语义驱动的合法测试值 |
| 性能基线 | 1 命令 | perf-compare 劣化判定（CI 非零退出） |
| 报告聚合 | 1 命令 | report 对齐规范 10 模板 + 上线判定 |
| 输出模板 | 5 | 测试方案/自测清单/Playwright/质量报告/JMeter |
| 单元+集成测试 | 265 | 全部通过（含 mock 后端集成/沙箱模拟跑/CLI/MCP stdio/e2e-check/报告体系/引擎与生成器回归） |
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
| | API 接口测试执行 | ✅ | 完整 | run-api 深度测试：DAG 编排 + 四层断言（成功码/结构/写后读回/负例安全）+ 契约漂移 + 零污染 |
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
| MCP 工具数 | 23 | 16 | 10 | **17** | 🟡 可继续扩展 |
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
| v0.7.0 | 落地增强：批量 E2E（32 页面实测）+ 登录态自动化 + T3/T4 块级精确化 + 数据工厂 + 报告聚合 + 性能基线 + MCP resources + CI |
| v0.8.0 | 做深：7 层 project 编排 + 归属清单强校验（e2e-check）+ 路由映射 + 逐页深用例 + UI 契约拦截 + 隔离机制 + 证据附件 + 测试填充标准 + T21-T25 |
| v0.9.0 | 接口测试做扎实：DAG 编排 + 四层断言 + 负例执行 + 契约漂移检测 + 权限双账号 + 网络错误防假通过 |
| v0.10.0 | 真实落地闭环：选择器适配层 + 沙箱模拟跑（零污染验证）+ 工位模板 + 子表页签 + 字典同步 + 质量门聚合 + webhook |
| v0.11.0 | 报告体系闭环：test-reports/ 统一产出 + 自动发现 + 历史趋势 + 索引；细粒度用例生成（字段级边界/非法值/安全，与 run-api DAG 执行映射） |
| v0.11.1 | 精准性止血：report fail-closed / 权限探针死代码 / 主键精确匹配 / e2e-check 假通过 / MCP stdio 污染 / `--flag=true` 失效 + 退出码统一 + 门禁布尔化 |
| v0.12.0 | 架构地基：lib/shared 共享层（阈值/类型分类器/工具）+ CLI 分层拆分（lib/cli/）+ 报告维度注册表 + MCP parity/required 校验 |
| v0.13.0 | 引擎层：jtl 流式解析（直方图分位数）+ run-api 幂等读重试 + 负例/权限并行 + 执行器异步化防注入 + 审计规则表驱动（T13/T14/T18 精准化） |
| v0.14.0 | 生成器精准化：FG 内容哈希稳定 ID + 基线↔细粒度去重 + 逐字段负例（上限 8）+ dimensionCoverage 追溯 + UI 适配层补漏（校验/自定义注入/泄漏修复）+ 路由归一 |
| **v0.15.0** | **收口：write-guard 字节级回滚并接线 CLI/MCP 写路径（fix 带 root 约束）+ plan-hash 归一化 + 文档口径与代码一致（工具数/结构/测试数单一事实源）** |

---

Copyright © 2026 AGILE TEAM · All Rights Reserved
