# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [Unreleased]

---

## [0.10.0] — 2026-08-15（真实落地闭环：选择器适配层 + 沙箱模拟跑 + 工位模板 + 字典同步 + 质量门聚合）

> 本轮以"沙箱模拟跑"为核心验证手段：**只读消费 wl-ui-produce 真实 page-spec（32 页）+ 真实路由映射**，
> 生成物与执行全部在临时沙箱 + 进程内 mock 前后端完成（`scripts/simulate-e2e.mjs`，结束即删，源项目零写入）。
> 模拟跑一次性抓出并修复 3 个真实落地 bug（见 Fixed）。

### Added — 选择器适配层（换组件库只改一个文件）

- `run-gen --type e2e --ui element-plus|steel|ant-design`（默认 element-plus，运行时 `E2E_UI` 可切）：
  生成 `support/selectors.js` 集中管理 grid/row/empty/headerCells/dialog/toolbar/工位 选择器；
  **steel = AG Grid + steel-list-panel 自研组件（wl-ui-produce 形态）**；全部 spec 模板改走 `sel.*`。

### Added — 沙箱模拟跑（scripts/simulate-e2e.mjs）

- 端到端验证链：真实 page-spec + routes → 生成 → node --check + e2e-check → 沙箱安装 playwright →
  进程内 mock 前端（steel-list-panel HTML）+ mock API（jh4j 信封）→ 真实浏览器逐页执行 ROUND1 五硬门
  （复用生成的 monitor/selectors/pages 资产）→ 32/32 全绿 → 沙箱即删。
- 环境自检优雅跳过（无 Chrome/无源项目时 exit 0，CI 安全）；浏览器优先级 E2E_CHANNEL > 系统 Chrome > bundled chromium。

### Added — 工位页模板 + 子表页签

- `features.workstation: true`（或 mode=WORKSTATION）生成 `workstation.spec.js`：查看态表单禁用断言、
  进阶查询选计划回填（拦截 plan 查询返回模拟行，确定性验证）、新增后可编辑、save/submit 契约
  （page.route 拦截 + 断言携带炉号）——**全部拦截零污染**；归属清单 WORKSTATION_SPECS 强校验必须含 page.route。
- page-spec `subTables` → round1-detail 逐页签用例（tab 角色定位 → 网格渲染断言，非页签布局优雅 skip）。

### Added — 字典同步 / 质量门聚合 / webhook

- `dict-sync` 命令 + MCP `wls_test_dict_sync`：拉取系统字典归一化（兼容 map-of-arrays / jh4j 列表式 /
  map-of-items 三形态自动识别），`--map 字段=字典码` 字段级映射，输出供 run-api --dict-file / round2 消费。
- `gate` 命令 + MCP `wls_test_gate`：一条命令聚合 审计(T1-T25) + e2e-check + 冒烟通过率 + DI 质量门 +
  性能基线（复用各 lib 实现），任一失败 exit 1；输入无效 fail-closed。
- `report --webhook <url>` / `gate --webhook`：结论推送企微/钉钉/raw（失败明细 Markdown，推送失败仅告警）。
- config 支持 `E2E_CHANNEL`（chrome/msedge 系统浏览器，免下载）。

### Fixed — 模拟跑抓出的真实 bug

- 生成 config 在 `"type": "module"` 包内使用 `__dirname` → ESM 加载即崩（改 `import.meta.url`）。
- `video: "retain-on-failure"` 依赖 ffmpeg 二进制，无下载环境全部用例挂 → 默认关闭，`E2E_VIDEO=1` 按需启用。
- 系统 Chrome（151）与 Playwright 1.62 的 runner 组合在本机导航挂起（裸 launch 正常）→ 模拟驱动改进程内
  复用生成资产直驱；channel 兼容性已在 README 标注。

### Tests

- 149 → **164 个**全部通过：新增 selectors/workstation/tabs 生成(4)、dict-sync 三形态+错误(6)、
  gate 聚合(4)、CLI gate/webhook(2)；修复测试间 ESM URL 缓存干扰（独立 outDir）。

---

## [0.9.0] — 2026-08-15（接口测试做扎实：DAG 编排 + 四层断言 + 负例 + 契约漂移）

> run-api 从"成功码冒烟"（L2）升级为"深度接口测试"（L3+）。
> mock 后端集成验证：故意留的安全缺口（必填不校验/类型宽恕/超长放行/权限不拦截/读回篡改/重复提交）
> 全部被精确检出并定位到字段；全部场景零数据残留。

### Added — 深度执行引擎（lib/api-executor.js 重写）

- **DAG 编排**（替代平铺用例循环）：列表冒烟 → 新增 → 写后读回 → 更新 → 详情 → 负例×3 → 重复提交
  → 权限拒绝 → 分页边界 → 清理 → 零污染复查；前置失败级联 skip 并标注原因（不再盲目继续）。
- **四层断言**：
  - L1 成功信封（HTTP + 契约 successCode）
  - L2 结构（records 数组 / total 数值 / 契约声明字段存在且类型匹配）
  - L3 数据正确性（写后读回逐字段比对写入值；清理后复查列表无残留）
  - L4 负例与安全（必填缺失/类型错误/超长必须被拒；重复提交拒绝或幂等；无权限 token 必须被拒）
- **负例执行**：按契约 required/type/maxLength 自动构造三类负例；`--lenient-coercion` 对后端隐式转换记 warn；
  负例使用独立业务键（与正例的重复校验互不掩盖）；**意外成功的负例自动登记清理**（零污染兜底）。
- **契约漂移检测**：响应实际字段 vs 契约 models 全量 diff——契约声明但缺失 / 响应未声明（排除审计字段）/ 类型不符，
  空库时在读回阶段补齐基准。
- **权限双账号**：`--token-no-perm` 启用（读探针默认，`--perm-write-probe` 加写探针）；权限未拦截判失败。
- **报文快照留证**：每步请求/响应体（截断）进 JSON 报告，失败可回溯到具体报文。
- **字典注入**：`--dict-file` 提供枚举字段真实合法值。
- **网络错误防假通过**：超时/连不上（status=0）记 error，绝不判为"被拒绝"——负例/权限步骤的网络故障
  不会伪装成校验通过（回归测试覆盖）。
- 报告新增章节：负例执行 / 权限验证 / 契约漂移检测 / 零污染清理 / 步骤详情（断言级明细）。

### Added — 接口

- CLI：`run-api --token-no-perm --dict-file --lenient-coercion --perm-write-probe --json`。
- MCP `wls_test_run_api` 同步透传全部新参数。

### Tests

- 135 → **149 个**全部通过：新增 mock 后端集成测试 14 个（全链路 DAG/权限通过/权限未拦截/校验缺口/
  lenient warn/幂等/读回不一致/漂移 missing/级联 skip/分页 strict/快照与报告章节/字典注入/空库自举/网络错误防假通过）。

---

## [0.8.0] — 2026-08-15（做深：全面对齐 wl-ui-produce e2e 工程化水平并模板化超越）

> 对照 wl-ui-produce e2e（32 页面、suites 归属校验、工位契约、隔离机制、测试填充器）逐维度做深。
> 真实项目复验：wl-ui-produce 32 页面目录 + 真实 routes.sit.json → 17 文件全部生成、路由全命中
> （PLBD001 → /lgBaseData/lgBaseDataMaster）、语法全过、归属强校验 PASS、自审计 PASS。

### Added — E2E 工程化做深（对标 wl-ui-produce 全部工程约束并模板化）

- **7 层 project 编排**：auth-setup → round1-readonly → round1-detail → ui-contract → round2-write → quarantine → cleanup；A/B/C 风险分层。
- **用例归属清单强校验**（fixtures/suites.js + playwright.config 加载即执行 assertE2ESpecCatalog）：未归类/重复归属/清单有但文件缺失/test.only/写入组缺安全标记/Bearer 截断/隔离声明漂移/UI 契约缺 page.route——任一命中拒绝运行，杜绝"文件写了但从未被执行"的假闭环；空清单组生成永不匹配正则（防 Playwright 空 testMatch 退化为全匹配）。
- **显式路由映射**：`--routes routes.json`（pageId→路由）优先于 dir 推导；生成时双向一致性校验（missing/extra 即失败）；pages.js 标记 routeSource（spec/map/derived），derived 产出 warnings 提示人工核对——修复真实路由与目录无关（/lgBaseData/... ≠ src/views/base-data/...）导致的错误路由。
- **登录双模式**：默认人工登录（兼容验证码/SSO/MFA，最长 4 分钟等待），配置 E2E_LOGIN_USER/PASSWORD 时自动填表。
- **逐页深度用例**（round1-detail）：列头渲染断言（AG Grid col-id / el-table 表头 label）、搜索收敛（首行探针值→查询→结果收敛断言）、重置恢复（输入清空+行数恢复）、字典翻译（dict 列应显示中文而非原始编码，E2E_DICT_CJK_ONLY 可调）；SIT 无数据优雅 skip。
- **UI 契约拦截**（ui-contract）：page.route 拦截全部写请求返回成功信封，断言端点+payload 契约——无安全测试数据/危险流程/任意环境均可跑；优先识别测试填充钩子。
- **高风险隔离机制**（quarantine）：默认 test.skip B 组 + 隔离准入准则（共享状态/无专属数据/无可靠逆操作）+ 种子数据声明模板；解除需移出清单（否则加载即 fail）。
- **证据附件**：monitor.assertClean(label, testInfo) 把观察到的全部业务响应（e2e-business-responses.json）与失败明细（e2e-failures.json）attach 进 HTML 报告；round2 保存主键信息附件。
- **e2e/package.json**：type module + 全套 npm scripts（e2e:auth/e2e/e2e:detail/e2e:ui-contract/e2e:round2/e2e:quarantine:list/e2e:cleanup/e2e:report）。
- **`e2e-check` 命令 + MCP `wls_test_e2e_check`（第 15 个工具）**：对任意 e2e 工程独立执行归属闭环+静态安全扫描（复用工程自身 assertE2ESpecCatalog 若存在），CI 非零退出。
- **测试填充器标准**（references/test-fill-standard.md）：应用侧 dev/SIT 门禁 + 字典快照 + 上下文字段保护 + 强制人工核对 + `data-testid="wl-test-fill"`；page-spec 声明 `features.testFill: true` 后 round2/ui-contract 自动接入。

### Added — 审计规则 T21-T25（E2E 工程级，源自 wl-ui-produce 实战约束）

- T21（error）：test.only/describe.only 假闭环
- T22（error）：受控写入 spec 缺安全标记（requireWriteApproval/new RunLedger/finally/cleanupLedger）
- T23（fatal）：截断 Bearer 前缀（.slice("Bearer ".length)/.substring(7)）
- T24（error）：隔离 spec 声明漂移（未 skip 的 B 组/缺 test.skip B 声明）
- T25（error）：ui-contract spec 缺 page.route 拦截

### Fixed

- `run()` 非异步导致 CLI 引入即崩（e2e-check await）——bin 入口补异常兜底。
- 生成物 TS 语法残留（`: Page`/`as const`）导致 .js 不可执行——全部纯 JS 化并有 node --check 级验证。
- 无列信息的契约输入生成 suites 清单含不存在的 detail spec（"文件缺失"校验误报）——清单与实际生成联动 + 空组永不匹配。

### Tests

- 122 → **135 个**全部通过：新增 routes 映射双向校验(2)/归属清单真实执行(1)/深度用例(1)/隔离与契约(1)/scripts(1)/testFill(1)/T21-T25(5)/CLI e2e-check(1)。

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
