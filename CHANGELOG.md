# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [Unreleased]

---

## [0.7.0] — 2026-08-15（落地增强：批量 E2E + 登录态自动化 + 断言精确化 + 数据工厂 + 报告聚合 + 性能基线）

> 已用 wl-ui-produce 真实项目验证：32 个炼钢页面 page-spec 目录一键生成 12 文件脚手架，
> 路由全部正确推导（src/views/... → /produce/...），生成物通过 T1-T20 自审计。

### Added — E2E 落地能力

- **批量多页面**：`run-gen --type e2e --contract <page-spec目录>` 递归扫描生成 `fixtures/pages.js` 清单，round1 循环全部页面（真实项目 32 页面验证通过）；支持 manifest JSON（`{pages:[...]}`）。
- **路由自动推导**：真实 page-spec 的 `dir` 是文件系统路径（`src/views/produce/xxx`），自动推导为路由 `/produce/xxx`。
- **登录态自动化**：新增 `auth-setup` project 与 `tests/auth-setup.spec.js`——配置 `E2E_LOGIN_USER/PASSWORD`（选择器可覆盖）自动登录生成 storageState，round1/round2/cleanup 检测到登录态文件自动复用。
- **UI 级 round2**：page-spec 含表单必填字段时生成 UI 级受控写入闭环（点新增→按 label 填表→捕获保存响应真实主键→`captureAuthorizationHeader` 复用页面登录态做 API 落库校验→账本清理）；无表单时保持 API 级。
- **toolbar 操作推断**：真实项目 CRUD 常在工具栏（勾选行后点修改/删除）而非行内 operations，契约消费现同时从 toolbar 推断 create/update/remove（用例矩阵同步增强）。

### Added — 精准与度量

- **断言精确化（T3/T4 块级解析）**：`parseTestBlocks()` 字符串/模板串/注释感知的轻量解析器，T3 精确到"每个 test 块至少一个 expect"（旧文件级计数在多块场景会漏判，实测抓出 playwright-generator 查询用例缺断言的真实缺陷并已修复），T4 不再误判字符串中的 `test(` 字样；支持 `test.skip/only/fixme` 与模板串名。
- **测试数据工厂** `lib/test-data-factory.js`：enum > constraints > 类型 > 字段名语义（email/phone/idcard/status/remark...）的合法值生成，maxLength 截断、数值 min/max 夹取、编号字段生成含 runId 的唯一值（零污染识别）；run-api 的 create payload 升级为工厂驱动。
- **报告聚合** `report` 子命令 + MCP `wls_test_report_generate`（第 14 个工具）：聚合 run-api/run-playwright/run-jmeter/DI 结果生成对齐规范 10 的测试报告，含上线判定（任一来源不达标即阻断，CI 非零退出）；`run-playwright` 现输出 JSON 结果供聚合消费。
- **性能基线对比** `perf-compare` 子命令 + `lib/perf-compare.js`：当前 jtl/json vs 基线，P50/P95/P99 相对劣化超阈值（默认 15%）或错误率上升超 1pp 即判劣化（CI 非零退出），jtl 解析支持引号字段。
- **MCP resources**：11 条测试规范以只读资源暴露（`wl-test://standards/01-xxx.md`），支持 `resources/list`/`resources/read`，AI 编辑器按需读取省 token。
- **CI 工作流**：`.github/workflows/ci.yml`（双 OS × Node 20/22 矩阵跑全量测试 + `npm pack` 产物校验 + release 前缀自动发布）。

### Fixed

- T3 旧文件级计数漏判：multi-test 文件中 expect 集中在一个块时其余块缺断言不报——已由块级解析修复（并修复 playwright-generator 查询用例缺断言）。
- `parseJtlResults` 未导出（perf-compare 复用）。

### Tests

- 90 → **122 个**全部通过：新增 data-factory(10) / perf-compare(5) / report-generator(5) / 块级解析回归(4) / e2e 批量+路由+UI round2+auth(4) / MCP resources(5-1 调整)。

---

## [0.6.0] — 2026-08-15（精准健壮修复 + E2E 成熟能力固化）

> 本次修复了 v0.5.0 全面分析发现的 6 个 P0 缺陷（其中 3 个导致核心命令崩溃）与一批 P1 健壮性问题，
> 并把 wl-ui-produce 炼钢平台 e2e 的实战模式（三轮策略/网络监控/清理账本/写入门禁）固化为可生成资产。

### Fixed — P0 致命缺陷

- `run-gen` 命令崩溃（`contractPath` 未定义引用）：旗舰功能恢复可用，补 CLI 集成测试防回归。
- `quality-gate.js` 按文档用法在包外目录调用必然崩溃：模块路径改为基于脚本自身的 `pathToFileURL` 解析。
- `quality-gate.js` 参数解析缺陷：`--defects x.json`（空格风格）解析失败、路径无效静默跳过（fail-open）→ 统一 arg parser + 输入无效即退出码 1（fail-closed）+ 缺陷 JSON 数组校验。
- MCP stdio 未 await 异步 handler：`wls_test_run_api` 等异步工具返回 `{}` → 全部 await 后序列化，补 stdio round-trip 测试。
- T8 规则误杀所有正确的 SteppingThreadGroup（正则匹配到标签名本身）→ 只检查属性名，与 jmeter_validate 共享同一实现；正确的小写空格属性名不再误报。
- T11 规则死代码（filter(Boolean) 后判空永远为假）→ 按表头定位"预期结果"列逐行判空。
- 自产 jmx 过不了自审计（缺 CSV 参数化/SLA 断言）→ 生成器补 `<CSVDataSet>` + `DurationAssertion`，新增"生成物必须通过自审计"回归测试。

### Fixed — P1 健壮性

- `run-api`：`{id}` 占位符原样发请求（detail/remove 必 404）→ 先调 queryPage 取真实主键再替换；save 空 body → 按契约必填字段+类型构造合法 payload；新增后自动精确清理（零污染），并输出 JSON 结果供 `quality-gate --smoke-result` 消费；不通过时非零退出。
- `run-jmeter`：`-Jthreads` 与 jmx 硬编码线程数不对齐 → 线程组改 `${__P(threads,...)}` 属性化（rampUp/loops 同理）；`-e -o` 报告目录已存在即失败 → 运行前自动清理；jtl 解析支持双引号字段（failureMessage 含逗号不错位）；百分位索引 off-by-one 修正。
- `run-playwright`：无条件追加 `--project=chromium` → 未指定时不追加；testDir 含空格路径加引号。
- `audit`：目录扫描不排除 node_modules/.git → 增加 IGNORED_DIRS；单文件读取异常不再让整个审计崩溃；二进制/资源扩展名跳过；审计不通过时非零退出（可直接 CI 卡门）。
- `update` 命令：`force:true` 全量覆盖用户本地修改 → 增量模式（无变化跳过、用户改过的文件保留并提示，`--force` 显式覆盖）。
- `doctor`：Node 版本字符串比较（v9 误判通过）→ 按 major 数值比较。
- T13 规则过松（注释含 "CSV" 即通过）→ 精确匹配 `<CSVDataSet`；T16 对齐 JMeter 实际元素 `DurationAssertion`。
- Playwright 审计误报：只审计 `*.spec.*`/`*.test.*` 文件，playwright.config/支撑模块不再误判。
- jmeter 生成器：实体名/字段名含 `& < > "` 时产出非法 XML → 全量 XML 转义；自违反 T12 的 `waitForTimeout(1000)` → `waitForResponse`。
- MCP：版本号硬编码 0.3.1 → 读 package.json；新增 `ping` 响应；`wls_test_fix` 默认预览、需 `confirm: true` 才写文件；`wls_test_env_check` 支持向上探测项目根。
- 生成契约脚本的请求补 Authorization 头透传（`--token`）。

### Added — E2E 成熟能力固化（源自 wl-ui-produce 实战）

- `lib/e2e-generator.js` + `run-gen --type e2e`：一键生成完整 E2E 工程脚手架：
  - **三轮策略**：round1-readonly（只读冒烟）/ round2-write（受控写入）/ cleanup（按账本恢复清理）
  - **network-monitor**：五道硬门（必须观察到业务响应防假通过、HTTP/业务码/console/pageerror 监控、只读模式写请求检测、登录态失效即失败、新增必须返回真实主键）
  - **run-ledger 清理账本**：业务键必须含 runId、清理必须携带真实主键、原子落盘、可恢复
  - **environment 写入门禁**：E2E_ENABLE_WRITE + E2E_WRITE_CONFIRM + 主机白名单三重确认
  - **round2 数据闭环**：新增 → 真实落库校验 → 账本登记 → 精确清理 → 零污染复查
- MCP 新工具 `wls_test_e2e_generate`（第 13 个）。
- Skill 参考 `exec/test-script-generator/references/e2e-rounds-pattern.md`：把"测试到什么程度、用例写到什么程度"沉淀为团队标准。

### Added — 测试体系（35 → 90 个，全部通过）

- `test/cli-integration.test.js`：CLI 子命令真实执行回归（拦截"lib 全绿但 bin 崩溃"）。
- `test/quality-gate.test.js`：CI 脚本双参数风格、fail-closed、包外目录调用回归。
- `test/self-consistency.test.js`：生成物（jmx/playwright/e2e 脚手架）必须通过自家审计与校验器；T8/T11 精准性回归；XML 转义回归。
- `test/mcp-stdio.test.js`：stdio JSON-RPC round-trip（initialize/ping/tools/list/异步工具序列化）。
- `test/e2e-generator.test.js`：脚手架结构与安全模式断言。

---

## [0.5.0] — 2026-08-14（全部缺口清零）

> 详见 git 历史：T13-T20 审计规则、F4-F6 修复、Playwright/JMeter 执行器、质量门 4 指标、覆盖率校验。

---

## [0.3.2] — 2026-08-05（工程化完善 + README 重写）

### Added

- arg parser 强化：统一 `parseArgs()` 函数，防止 flag 误吞。
- init 版本占位符：安装时自动替换版本号。
- clean 命令增强：清理全部 13 个安装产物。
- npm 发布验证通过：67 个文件，315KB。

### Changed

- README 全面重写：结构化 11 章节，badge 化。
- 编辑器文件版本号改为占位符 `__WL_SKILLS_TEST_VERSION__`。

---

## [0.3.0] — 2026-08-05（自动化生成 + MCP 完善 + 编辑器适配）

### Added — 自动化脚本生成

- `lib/playwright-generator.js`：从 page-spec 或契约自动生成 Playwright 测试脚本（含查询选择器、新增数据闭环、操作列测试）。
- `lib/jmeter-generator.js`：从契约 operations 自动生成 JMeter jmx 脚本（含线程组/采样器/Header/JSON 断言/聚合报告/结果树），遵循 11 条强制规则避免致命坑。
- CLI `run-gen --type playwright`：一键从契约生成 Playwright 脚本。
- CLI `run-gen --type jmeter`：一键从契约生成 JMeter jmx（支持 `--threads` 参数）。

### Added — MCP 与编辑器适配

- `files/.mcp.json`：安装后自动注册 MCP server。
- 新增 6 个编辑器适配文件：CLAUDE.md / .cursor / .windsurf / .kiro / .trae / .clinerules。

### Added — 测试覆盖增强

- 新增 18 个测试（MCP handler 14 个 + Playwright 生成器 2 个 + JMeter 生成器 3 个，含生成器产物通过 jmeter_validate 闭环验证）。
- 总计 33 个测试全部通过。

### Verification

- `node --test test/*.test.js` → 33 pass / 0 fail。
- `run-gen --contract X --type playwright` → 实测生成含选择器和数据闭环。
- `run-gen --contract X --type jmeter --threads 200` → 实测生成有效 jmx（通过 jmeter_validate 校验）。
- 生成的 jmx 不含 ConfigTestElement 致命坑，能通过 wls_test_jmeter_validate。

---

## [0.2.1] — 2026-08-05（ESM 兼容性修复）

### Fixed

- 修复 ESM 包内混用 `require()` 的致命 bug（init/run-gen/write-guard/MCP case_generate 全部恢复可用）。
- `lib/index.js`：顶层统一 `import`（fs/path/child_process/contract-consumer/test-codegen），删除所有 `require()`。
- `lib/test-codegen.js`：`generateFromContract` 改为静态 import consumeContract。
- `lib/write-guard.js`：`confirmAndWrite` 改为 import + 实现失败回滚（备份→写入→失败恢复）。
- `mcp/tools/handlers.js`：全部改为 import + 路径用 fileURLToPath 替代 URL pathname hack。
- `lib/index.js` `cmdClean`：实现真删除（rmSync recursive），不再是 stub。
- `lib/index.js` `cmdDoctor`：`checkCommand` 改为顶层 import execSync，Playwright/JMeter 检测恢复正常。
- `package.json` scripts：移除不存在的 check.js/lint-skills.js，改为直接 `node --test`。

### Added

- 新增 5 个回归测试（confirmAndWrite 写入/哈希/生产阻断、consumeContract 契约消费、generateFromContract），总计 15 测试全通过。

---

## [0.2.0] — 2026-08-04（生态连接 + 自动化执行）

### 第二阶段：生态连接

- `lib/contract-consumer.js`：消费 kit wl-api-contract / bd wl-contract.json / kit page-spec 三种契约，自动检测格式并提取可测试资源。
- `lib/test-codegen.js`：用例生成引擎（契约→用例矩阵、DI 质量评估、冒烟筛选、Markdown 导出）。
- `lib/write-guard.js` + `lib/plan-hash.js`：安全写链（preview→confirm→写前重算→失败回滚），生产环境默认阻断。
- `mcp/tools/handlers.js`：7 个 MCP 工具完整实现。
- CLI `run-gen`：一键从契约生成测试用例。

### 第三阶段：自动化执行

- `lib/templates/jmeter-base.jmx`：JMeter 5.6.3 基础脚本模板（补齐缺失 jmx）。
- `scripts/quality-gate.js`：DI 质量门 CI 集成脚本（退出码 0/1 卡门）。
- `test/index.test.js`：10 个单元测试全部通过。

---

## [0.1.0] — 2026-08-04（工程骨架 + 知识资产迁移）

### Added

- 工程骨架搭建：`@agile-team/wl-skills-test` v0.1.0，遵循 wl-skills-* 四包统一架构模式。
- CLI 入口 `wl-skills-test`（init / doctor / validate / run-gen），与 kit/bd 同构。
- 11 条测试规范（standards 01-11），对齐在线 QC 测试流程规范文档。
- 12 个 AI Skill 迁移自 testing-skills-0723，分 5 组（plan / case / exec / quality / perf）。
- 模板文件补齐：JMeter 基础 jmx、Playwright 基础脚本、用例 Excel 结构、质量报告模板。
- MCP 注册表骨架（wls_test_* 前缀，7 个工具规划）。
- 架构设计文档与分析文档，记录设计决策与四包协作关系。

### Changed

- 从 testing-skills-0723 迁移时修复悬空引用（browser-mcp-rules / hermes_tools / templates 缺失）。
- 合并重复的 Windows 编码规范为包级共享 reference。
- 清理 SKILL.md 编号跳跃和角色定义重复问题。

---

## [Unreleased]

- 第二阶段：contract-consumer.js（消费 kit/bd 机器契约自动生成用例）。
- 第二阶段：MCP 7 个工具实现（wls_test_*）。
- 第三阶段：Playwright 脚本自动生成 + JMeter 脚本校验 + DI 质量门 CI 集成。
