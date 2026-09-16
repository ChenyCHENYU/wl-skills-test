# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [Unreleased]

---

## [0.25.0] — 2026-09-16（软失败检出：业务码成功但提示异常的假成功不再漏检）

> 全量 268 测试绿（新增 3 条软失败回归）。命中用户实战痛点：HTTP 200 + code 成功 + message 异常。

### Added

- **软失败检出**：写操作（新增/更新/删除）业务码报成功但 message 命中异常关键词
  （异常/失败/错误/不存在/已存在/重复提交/超时/禁止/拒绝/无效/非法/回滚）→ 判 fail，
  专属诊断指引（吞异常/半成功：转后端确认事务是否回滚）。关键词保守，正常成功提示零误报
  （负例的预期拒绝路径不受影响，有回归测试）。

---

## [0.24.0] — 2026-09-10（产物 JSON 化统一 + case_generate 紧凑化收尾 + 测试计划数据侧）

> 全量 265 测试绿（新增 4 条 JSON 化回归）。四个维度（精准/健壮/高效/token 经济）至此无已知短板。

### Added — 全维度 JSON 产物（平台/AI 消费零失真、省 token）

- `run-gen --json <path>`：用例矩阵 + 细粒度用例结构化输出（含稳定 ID）。
- `diff --json <path>`：变更明细 + 受影响用例清单结构化输出。
- `perf-compare --json <path>`：劣化判定 + 指标结构化输出。
- 与既有 `api-result/perf-result/audit-result/plan-input` JSON 共同构成全维度结构化产物体系。

### Added — 测试计划数据侧（`report --plan-input`）

- 聚合"写测试计划需要的一次性数据"到 `test-reports/plan-input.json`：本次判定/质量分/检查项、
  API 维度覆盖追溯、审计/性能摘要、最近 10 次历史趋势。计划本身仍由 AI 按模板写（决策文档），
  数据由工具给全——AI 写计划不再从多个 Markdown 报告里人肉拼数据。

### Changed — MCP token 经济收尾

- `wls_test_case_generate` 默认紧凑输出（计数/分布/采样 + hint）——MCP 里最后一处全量数组；
  `detail:"full"` 或 `output` 落文件取全量。至此 4 个大结果工具（run_api/audit/report/case_generate）
  全部紧凑化。

---

## [0.23.0] — 2026-09-10（健壮性加固：总时长保护 / 进程树终止 / 参数下限 / history 轮转 / MCP 类型校验）

> 全量 261 测试绿（新增 5 条健壮性回归）。全部面向"坏环境/坏输入下不产生怪行为"。

### Fixed — 挂死与孤儿进程

- **run-api 总时长保护**（`--max-duration <秒>`，默认 600s）：超预算后未执行步骤标 skip
  （原因可解释："检查环境健康度或 --max-duration"）并正常收尾出报告——慢环境/大契约下 CI 不再挂死；
  skipped 拉低通过率 → 判定不通过（诚实呈现"没跑完"而非假通过）。
- **Windows 进程树终止**：playwright/jmeter 超时 kill 改用 `taskkill /T /F`——
  此前 `child.kill()` 只杀直接子进程，npx→node→playwright 链留孤儿进程持续吃 CPU。

### Fixed — 坏输入不产生怪诊断

- **数值参数下限**：库层夹紧（timeout ≥1000ms、maxDuration ≥30s，`timeout=0/NaN` 不再导致"全超时"误诊）；
  CLI 层非法值给用法错误（退出码 2）。
- **MCP 数值类型校验**：`validateToolInput` 对声明 number 的字段拒绝字符串/对象（-32602），
  不再流进 handler 变 NaN；`quality_analyze` 的 caseCount 数字字符串容错（"150"→150，不再吞成默认 50）。

### Fixed — 资源增长

- **history.jsonl 轮转**：超 500 行自动裁剪头部保留最近记录（长期项目不再无限增长；
  轮转失败容忍不影响本次追加）。

---

## [0.22.0] — 2026-09-03（内在深化：声明维度全部真执行 + 严格成功码 + swagger 导入增强 + 压测基线串联）

> 全量 256 测试绿（新增 8 条内在回归）。原则不变：不向外扩，把测试本身做到极致闭环。

### Added — 声明 ↔ 执行的最后补齐（run-api）

- **数值边界负例**（`field-numeric-boundary` → autoExec）：契约 `constraints.min/max` 驱动，
  min-1 / max+1 越界值必须被拒绝；意外成功登记清理（零污染兜底）。swagger-import 导入的
  minimum/maximum 直接成为探针数据源——OpenAPI 到边界测试全自动。
- **组合查询收敛探针**（`op-query-combine` → autoExec）：显式声明 ≥2 查询字段（page-spec query
  或导入的 queryRequest）才执行——用本次创建的记录锚定：按 A 查必命中、A+改值 B 查必不命中，
  检出"查询条件被后端忽略、列表过滤失真"这类静默缺陷；执行位置在清理之前（锚定记录存活期）。
- **严格成功码**（`--strict-code`）：默认宽松兼容多后端信封（0/200/缺省），严格模式只认契约
  `transport.successCode`——jh4j 单一体系统一口径。
- CLI 暴露 `--timeout`。

### Added — swagger-import 增强

- **OpenAPI 2.x basePath 拼接**（真 bug：v2 的 paths 相对 basePath，此前生成缺前缀的路径）。
- **`--token`**：有鉴权的 swagger 网关可携带 Authorization 拉取。
- **响应模型导入**：detail 的 200 响应 schema（解 data/records 信封）→ `models.record`——
  契约漂移检测基准从"create 字段≈响应字段"的假设升级为声明的响应模型。
- **查询模型导入**：page 请求体剔除分页参数 → `models.queryRequest`（组合查询探针的数据源）。
- v2 的 `parameters[in=body]` 兼容（此前只认 v3 requestBody）。

### Added — 串联与工具

- `run-jmeter --baseline-compare`：压测完成自动用 result.jtl 对比基线存档（首次存档/劣化即退出码 1）。
- MCP 第 19 个工具 `wls_test_gen_contract`（紧凑输出：操作映射/字段数/核对项，可选落契约文件）。

---

## [0.21.0] — 2026-09-03（AI 接入故事：OpenAPI→契约转换 + setup 接入引导 + test-onboarding Skill）

> 全量 248 测试绿（新增 8 条接入回归）。接入从"人写契约"变成"AI 按引导读后端已有资产"。

### Added — OpenAPI/Swagger → 契约转换（人不再手写第二份契约）

- 新命令 `gen-contract --swagger <URL或openapi.json>`（`lib/swagger-import.js`）：
  确定性关键词映射（queryPage/save/getById/updateById/deleteById → 五操作），
  requestBody schema 解引用 → createRequest（**required/maxLength/min·max/枚举全保留**——
  这些正是负例与断言深度的来源）；OpenAPI v2/v3 兼容；`--module` 按模块提取；
  转换结果强制过 validate-contract；输出"需人工核对"清单（业务成功码 OpenAPI 不含，默认 2000）。

### Added — setup 接入探测引导

- 新命令 `wl-skills-test setup [--base-url]`：探测项目形态（Java Maven/Gradle、前端框架）、
  接口描述来源（Swagger 在线探测 v3/api-docs 等 → 本地 openapi.json → api.md）、
  规范安装状态；生成 `wl-test.config.json` 骨架（sit/uat 档案 + auth 凭据 $ENV 引用，不覆盖已有）；
  **输出可直接发给 AI 的标准接入指令**。

### Added — 第 13 个 Skill：test-onboarding（AI 编排 SOP）

- `.github/skills/onboarding/test-onboarding/`：用户一句"接入测试"即触发。
  六步 SOP 全部绑定确定性工具：setup 探测 → gen-contract 提取（AI 不手写）→
  validate-contract 把关（不过不往下走）→ 配置确认（**凭据不碰明文**）→
  run-api 试跑 → 汇报+固化 CI。AI 只编排与理解文档，执行全部走工具。

---

## [0.20.0] — 2026-09-02（内在闭环收口：声明用例全部真执行 / detail 漂移 / fix 复验 / 契约校验前置）

> 全量 240 测试绿（新增 4 条闭环回归）。原则：不向外扩、不做外部集成——把测试本身的闭环做严。

### Added — 声明 ↔ 执行的最后两块补齐（run-api）

- **不存在主键探针**（`op-notfound`，detail/update/remove 三处）：对确定性不存在的主键断言
  "业务拒绝或空数据 + 非 5xx"——细粒度用例早已声明（此前 autoExec:false 留人工，实则执行器数据齐备）。
- **删除幂等探针**（`op-idempotent`）：对已删主键重复 remove，断言非 5xx 并记录行为（拒绝/幂等）；
  "不误删"由 verify-gone 兜底。两个维度均已翻转为 autoExec:true 并进 dimensionCoverage 追溯。
- **detail 响应参与契约漂移检测**（此前仅 list 首记录参与——detail 投影常与列表不同，覆盖面翻倍）。

### Added — 修复与契约的闭环

- **fix 复验**：自动修复写入后对修改文件 re-audit，输出"剩余致命/错误"计数与人工处理入口
  （此前 audit→fix 之后是死胡同，修没修干净无人知晓）。
- **契约快速校验**：新命令 `validate-contract`（规则全部源自 consumeContract 真实归一逻辑：
  路径 / 开头、{id} 占位范围、method 合法性、字段重名、successCode 数值、分页约束等）；
  **run-api 执行前串联同样校验**——契约写错不再跑到一半才炸、且不再被误诊为"服务不可用"。

---

## [0.19.0] — 2026-09-02（报告门户与度量：质量分 / HTML 单文件报告 / SVG 趋势 / 飞书推送）

> 全量 236 测试绿（新增 5 条门户回归）。v0.16.0 → v0.19.0 四版本"可用性 + 有效性 + 性能 + 门户"迭代完成。

### Added — 质量分（管理层看得懂的一个数字）

- `computeQualityScore`：多维度检查项 → **质量分 0-100 + A/B/C/D 等级**（每未达标项 -25，确定性可解释）；
  聚合报告结论区、HTML 报告头部、history.jsonl 趋势三处带出。

### Added — 单文件 HTML 交互报告（零依赖）

- `report --html` / MCP `report_generate(html:true)`：数据内嵌 JSON + 原生 JS——
  全部/未达标/通过筛选、离线可看、无外部资源；AI 只需回传文件路径，token 零消耗。

### Added — SVG 趋势与飞书

- Markdown 报告内嵌 **SVG 通过率折线**（API/UI 双系列，≥2 个历史点自动绘制）。
- webhook 新增 **飞书**（text 消息，自动剥离 markdown 星号）；`buildWebhookBody` 导出可测。

---

## [0.18.0] — 2026-09-02（性能工程化：p90/TPS/错误TopN + 基线自动管理 + 混合场景压测）

> 全量 231 测试绿（新增 4 条性能回归）。

### Added — 性能指标补全

- jtl 解析（流式直方图）增补 **p90、吞吐量 TPS（样本时间窗）、错误分布 TopN**（label 归类）；
  性能维度报告/聚合报告同步展示（P50/P90/P95/P99 + req/s + 错误 TopN 表）。

### Added — 基线自动管理

- `perf-compare --auto-baseline`：首次运行当前指标自动存档为基线（test-reports/perf-baseline.json），
  此后自动对比存档；**劣化不会自动更新基线**——确认优化到位后 `--update-baseline` 人工更新
  （防"慢性漂移"被自动吞掉）；`--baseline` 显式路径优先。

### Added — 混合场景压测

- `run-gen --type jmeter --scenario mixed`：读写权重混合（查询 80% / 新增 15% / 更新 5%，
  ThroughputController percentExecution；契约缺操作时权重自动归一化），模拟真实读写比例，
  remove 不参与压测；生成物通过 T1-T25 自审计。

---

## [0.17.0] — 2026-09-02（测试有效性：更新生效验证 / 非法枚举负例 / 并发重复探针 / 契约 diff + MCP 工具）

> 全量 227 测试绿（新增 7 条有效性回归）。门禁从"跑得通"升级为"拦得住真缺陷"。

### Added — run-api 深度断言

- **更新生效验证**：S04 用差异化字段值（业务键保持原值——真实系统业务键更新时不可变；
  字典/枚举字段保持合法值）执行 update，S05 详情读回逐字段比对——
  "更新被后端忽略/不落库"从此被检出（此前回放 create payload，更新链路假覆盖）。
- **非法枚举负例**：dict.json 提供合法值的字段自动传确定性非法值（`__WL_INVALID_ENUM__`）
  验证拒绝（上限 4 字段）——field-enum 从人工用例变为自动执行，dimensionCoverage 可核对。
- **并发重复探针**（`duplicate-concurrent`）：同业务键 5 并发，顺序 duplicate 测不出
  race 窗口的重复落库——本步骤直接暴露唯一约束/幂等缺失，失败诊断明确指引
  "必须加数据库唯一索引而非仅应用层校验"。

### Added — 契约变更影响面（diff）

- 新命令 `wl-skills-test diff --old <旧> --new <新>` 与 MCP 工具 `wls_test_contract_diff`
  （第 18 个）：操作级/字段级/传输层变更明细 + 受影响用例清单（新增/作废/需重跑，
  基于内容哈希稳定 ID 精确到条）+ Markdown 报告（test-reports/契约变更影响面.md）。
  MCP 返回紧凑结构化结果（changes + counts + hint），契约升级后回归范围一目了然。

### Changed

- 细粒度用例：`field-enum` 翻转为 autoExec:true（dict 提供后自动执行）；新增
  `op-update`（更新后字段回读一致）、`op-duplicate-concurrent`（并发重复提交）两条
  autoExec 用例，与 run-api 新步骤一一对应。
- README/MCP 工具数 17 → 18（文档口径测试守护）。

---

## [0.16.0] — 2026-09-02（可用性落地 + token 经济学：配置档案 / auth 自动登录 / CI 模板 / 失败诊断 / MCP 紧凑输出）

> 全量 220 测试绿（新增 6 条可用性回归）。目标：把「采用摩擦」与「AI token 浪费」一起砍掉。

### Added — 零配置上手

- **项目级配置 `wl-test.config.json` + 环境档案**：`--profile sit|uat` 切换 base-url/token/dict 等；
  字符串值支持 `$VAR`/`${VAR}` 环境变量引用（token 不落盘明文）；`.env` 零依赖解析注入；
  CLI 显式参数 > 档案 > 根级默认；run-api/run-playwright/run-jmeter/dict-sync/gate/report 全部接入。
- **Auth 适配层**：jh4j 风格登录（账号密码→token），run-api 无 token 自动登录、
  **401/token 过期自动重登重试一次**（配置 auth 段经 usernameEnv/passwordEnv 引用凭据）。
- **CI 模板开箱即用**：新命令 `wl-skills-test ci --type github|gitlab|jenkins` 生成质量门流水线
  （audit 阻断 + 按需 run-api + report 产物上传），已存在不覆盖（--force 覆盖）、--dry-run 预览。

### Added — 失败可自助诊断

- run-api 每个失败/错误步骤附带 **`hint` 诊断指引**（负例失败→"后端校验缺口，找后端补 XX"；
  权限→越权风险；readback→数据一致性；401→token/auth 配置；5xx→环境健康度…），
  CLI 控制台、Markdown 报告（新增"诊断指引"列）、MCP 摘要三处带出——
  开发拿到结果就知道下一步找谁，不再来回问。

### Added — token 经济学（AI 调用降本）

- **MCP 紧凑输出**：`wls_test_run_api` / `wls_test_audit` / `wls_test_report_generate` 默认返回
  「结论 + 失败 TopN + 诊断指引」紧凑摘要（典型 run-api 全量含报文快照数十 KB → 摘要 ~1-2KB），
  `detail:"full"` 或读结果文件才取全量（`lib/shared/compact.js`）。
- 报告聚合结果新增 `checks` 明细导出，紧凑摘要按未达标项裁剪。

---

## [0.15.0] — 2026-09-02（收口：write-guard 字节级回滚并接线 + plan-hash 归一化 + MCP fix 路径约束 + 文档口径单一事实源）

> 全量 214 测试绿（新增 5 条收口回归）。v0.11.1 → v0.15.0 五阶段优化完成。

### Changed — 安全写链（健壮）

- **write-guard 字节级回滚**：备份/恢复改用 Buffer——二进制/BOM/CRLF/文件模式保真，
  不再依赖 UTF-8 文本往返；回滚失败如实上报（`rollbackErrors`，此前吞掉且
  `written/rolledBack` 计数失真）；重复目标路径直接拒绝（同计划双写同路径会互相踩备份）。
- **plan-hash 归一化**：对象键序无关 + 路径斜杠归一（`D:\a` 与 `D:/a` 同哈希）+ 文件顺序无关。
- **CLI fix 接线安全写链**：auto-fix 实际写入经哈希确认 + 备份回滚（此前裸 writeFileSync，
  中途失败留下半完成状态）；**MCP `wls_test_fix` 增加 root 路径约束**
  （confirm:true 也只能写 root 之下，防 AI 误触项目外文件）且同样走安全写链。
- contract-consumer 契约读取剥离 UTF-8 BOM（与 report/gate/dict 统一）。

### Changed — 文档口径单一事实源（直观）

- README 徽章/正文/包结构/版本历程与代码对齐（MCP 工具数从注册表派生、版本号与 package.json
  一致、测试数与实际一致、包结构反映 lib/cli + lib/shared + lib/report 拆分）；
  新增 `final-v15.test.js` 文档一致性测试——工具数/版本徽章/测试数漂移会在 CI 被拦下。

---

## [0.14.0] — 2026-09-02（生成器精准化：稳定 ID + 基线去重 + UI 适配层补漏 + 逐字段负例 + 维度覆盖追溯）

> 全量 209 测试绿（新增 7 条生成器回归）。

### Added — 细粒度用例稳定 ID 与去重（精准）

- **FG 用例 ID 内容哈希化**（`FG-<sha256前8>`，由 dimension+module+title 决定）——契约增删一个字段
  不再让后续所有 `FG-###` 编号漂移，缺陷追溯链稳定；同语义字段生成内置去重。
- **基线 ↔ 细粒度去重**：`run-gen --granularity field` 合并输出时，基线矩阵
  「实体 - 字段 必填校验」已覆盖的 field-required 细粒度用例剔除（此前双重覆盖）。

### Added — 声明 ↔ 执行一致（精准）

- **逐字段负例**：run-api 必填缺失/类型错误/超长越界从"每类采样第一个字段"扩展为
  **每类全字段（上限 8）**——兑现细粒度用例 `autoExec: true` 的全字段承诺。
- **维度覆盖追溯**：`summary.dimensionCoverage`（各 dimension 的 executed/passed）——
  细粒度用例声明与 run-api 实际执行可对照核对。

### Fixed — E2E 生成器（健壮/精准）

- **批量模式表单字段合并**：首个 spec 无 formSections 时不再永久屏蔽后续 spec 的字段
  （旧 first-wins 导致多页批量生成错误的 round2 形态）；manifest 模式跨页面合并。
- **UI 适配层**：非法 `--ui` 直接报错（旧实现静默回退 element-plus，生成物跑不通才发现）；
  支持 `options.selectors` **注入自定义适配层**（第四个组件库不用改生成器）；
  修复 3 处 spec 内硬编码 `.el-*` 绕过适配层（fillQueryInput/clickAction/W5 确认框），
  适配层新增 `queryForm`/`toolbarButton`/`messageBoxConfirm` 键。
- **round2 生成物**：`data` 为对象信封时正确提取主键（旧 `String(obj)` 得 "[object Object]"
  污染账本）；落库校验/零污染复查 `size 10→100`（防第一页漏查）且改用**精确主键匹配**
  （与 run-api 同口径，子串误命中修复）；`fillLines` label 经 `JSON.stringify` 转义
  （含引号标签此前生成语法错误的 spec）。
- **路由**：Windows 反斜杠 dir 推导归一（`src\views\x` → `/x`）；无效 page-spec/routes JSON
  记入 warnings（此前静默丢弃）；自动合并的路由映射多余项降级为警告（陈旧 routes.dev.json
  不再一刀切阻断生成），显式 `--routes` 保持严格双向校验。

---

## [0.13.0] — 2026-09-02（引擎层：jtl 流式解析 + run-api 重试/并行 + 执行器异步化防注入 + 审计规则表驱动）

> 全量 202 测试绿（新增 8 条引擎回归：200k 行 jtl 基准 / CSV 双写引号 / 规则表完整性 /
> T13·T14·T18 精准化 / 网络抖动重试 / 并行执行顺序稳定性）。

### Changed — jtl 解析流式化（性能）

- `parseJtlResults` 改为 **readline 逐行流式 + 整数直方图分位数**——内存与样本数解耦，
  百 MB 级结果（默认 100 线程多循环常见）不再整文件 + 全行数组 + 全 times 数组进内存（OOM 风险）。
- `splitJtlLine` 支持 **CSV 双写引号转义**（`""` → `"`）——failureMessage 含引号逗号不再错位到 success 列。
- JMeter 非零退出时也解析已生成的部分 jtl（压测中断时已采样数据仍有统计价值）。

### Changed — 执行器异步化与防注入（健壮/安全）

- `runPlaywright` / `runJmeter` 由 `execSync`（阻塞单线程最长 5-10 分钟，MCP server 全程冻结）
  改为 **spawn 参数数组 + shell:false**——路径含空格/`&`/`|` 不再破坏命令或注入 shell；
  Windows 下自动解析 `npx.cmd` / `jmeter.bat` 候选。
- `perfCompare` 及其调用链（gate / CLI / MCP）随之异步化。

### Changed — run-api 重试与并行（性能/健壮）

- **幂等读抖动重试**：冒烟/详情/分页等 GET 语义步骤遇传输层错误（status=0）按抖动退避重试 2 次——
  一次网络抖动不再让步骤 error 并级联 skip 大半链路；业务失败/HTTP 4xx/5xx 原样返回不重试。
- **有界并行**：负例×3 + 重复提交 + 权限探针（均为独立业务键/只读探针，互不依赖）并行执行，
  主干（冒烟→新增→读回→更新→详情）与清理复核保持顺序；报告仍按步骤定义顺序输出。

### Changed — 审计规则表驱动（扩展性）

- T1-T25 重构为**自包含规则对象**（`{id, severity, desc, target, check(ctx)}`）——新增 T26+
  只需在对应目标数组追加一个对象，单规则异常自动隔离；`RULES` 元数据导出形状不变。
- 精准化修复：**T13** 认可 `__CSVRead`/`UserParameters` 等替代参数化（此前 fatal 误伤合法方案）；
  **T14** 循环控制器判定精确到 `LoopController.loops` 配置（此前注释里出现"loops"字样即豁免）；
  **T18** 解析 ramp_time 实际值（支持 `${__P(rampUp,默认值)}`），`ramp_time=0` 瞬时打满被检出
  （此前只查存在性）。

---

## [0.12.0] — 2026-09-02（架构地基：共享层 + CLI 分层拆分 + 报告维度注册表 + MCP 一致性防线）

> 不改行为的结构重构（除列明的小修正），全量 194 测试保持绿。
> 加一个命令 / 一个报告维度 / 一个 MCP 工具，从此各只需改一处。

### Added — lib/shared 共享基础层（消灭 10+ 处重复实现）

- `shared/thresholds.js`：95% / DI 0.3 / 模块收敛 ≤20% / P99<500ms 等质量阈值单一事实源
  （此前散落 8+ 处魔法数字，口径漂移风险）。
- `shared/types.js`：契约字段类型分类器单一实现（数值/整数/布尔/日期/枚举/declaredJsType）——
  此前用例生成（case-fine-gen）、数据工厂（test-data-factory）、执行负例（api-executor）各有一套正则，
  生成与执行对"什么算数值"口径不一。
- `shared/utils.js`：readJsonFile（BOM 剥离 + fail-open/closed 显式化）/ writeTextFile（mkdir+write）/
  escapeMdCell / normalizeAuthHeader / toBool / checkCommandAvailable。
- `calculateDI` 补齐**模块收敛**（byModule + 最差模块判定）——gate.js 文档承诺但实现缺失，
  与 scripts/quality-gate.js 的第二份 DI 实现收敛为单一实现。

### Changed — CLI 分层（lib/index.js 1150 行 → 薄路由 + lib/cli/）

- `lib/index.js` 仅保留命令注册表（COMMANDS + ROUTERS）与 run() 分发；
  实现拆至 `lib/cli/{args,context,installer,system,webhook}.js` 与
  `lib/cli/commands/{generation,execution,quality,reports}.js`。
- 新增命令从改 4 处（表/帮助/函数/switch）→ 注册表各加一行。
- doctor 工具探测超时 5s→10s（npx 冷启动常超 5s 造成"未安装"误报）。

### Changed — 报告维度注册表（lib/report/dimensions.js）

- api / playwright / jmeter / audit / defects 五维度改为声明式注册
  （key/label/patterns/render），新增维度 = 注册一个对象；
  report-generator 只负责来源读取（fail-closed）→ 渲染 → 判定，章节序号动态生成。

### Added — MCP 一致性防线与协议修正

- **启动期 parity 校验**：`assertRegistryParity` 确保 TOOL_DESCRIPTORS 与 HANDLERS 键完全一致
  （stdio 入口退出码 1 拒绝启动，server 工厂抛错）；测试断言从 `>= 15` 收紧为精确一致。
- **inputSchema.required 运行时校验**：tools/call 缺必填参数返回 `-32602`（此前流进 handler 变 -32603）。
- **notification 不应答**（此前对无 id 请求回 `id:undefined` 帧）；批量请求明确 `-32600` 拒绝。
- Handler 胶水对齐 CLI：gate 数值参数解析、report 支持 audit/trend/reportsDir、
  e2e_generate 透传 ui/workstation/routes、smoke_select 坏 JSON 返回明确错误、
  env_check 增加 Node>=20 检查、quality_analyze 不再把 caseCount=0 吞成 50。

---

## [0.11.1] — 2026-09-02（精准性止血：6 个 P0 判定/写盘缺陷 + 退出码统一 + 门禁布尔化）

> 本版本全部为判定正确性修复：报告 fail-closed、权限探针死代码、主键精确匹配、e2e-check 假通过、
> MCP stdio 污染、`--flag=true` 失效。新增 12 条回归测试（总 191 全绿）。

### Fixed — 判定与安全（P0）

- **report fail-closed**：`api/playwright/jmeter/audit/defects` 来源文件存在但损坏（非法 JSON/结构无效）时，
  不再静默丢弃维度导致"残缺数据具备上线条件"，改为计入未达标检查项并在报告注明（`report-generator.js`）。
- **权限探针死代码**：detail/remove 权限探针在步骤构建期判断 `ctx.createdId`（恒为 null）导致永不注册、
  权限覆盖虚报——移入 gate 闭包运行期判断（`api-executor.js`）。
- **主键匹配精确化**：`findRecordById` 由 `JSON.stringify(rec).includes(id)` 子串匹配改为
  显式主键字段全等 + 任意字段值全等（防 id=123 命中含"1234"记录的假通过）；verify-gone 同步修复。
- **e2e-check fail-closed**：缺 `fixtures/suites.js` 归属清单由 warning 假通过改为 error 阻断；
  suites.js 存在但未导出 `assertE2ESpecCatalog` 同样记 error。
- **MCP stdio 污染**：run-playwright/run-jmeter 执行器进度输出改走 stderr，
  不再破坏 MCP JSON-RPC 帧（`executors.js`）。
- **`--flag=true` 失效**：参数解析器布尔归一（`true`/`false`），此前 `--dry-run=true` 以字符串
  参与 `=== true` 判断而静默执行真实写盘。

### Fixed — 判定与健壮（P1）

- **未知 `--flag` 不再触发真实安装**：打错选项名（如 `--dry-runn`）此前默认路由到 init 全量写盘，
  现退出码 2 并提示。
- **perf-compare 基线校验**：基线缺 p50/p95/p99 指标 → 报错；基线为 0 且当前有值 → 直接判劣化
  （此前除零返回 0 永不告警的假阴性）。
- **update 占位符比对**：含 `__WL_SKILLS_TEST_VERSION__` 的文件安装时已替换为当期版本，
  此前与原始内容比较被永久误判"用户已修改"而永不更新——现与任意历史版本替换结果比对。
- **`__fieldMap__` 接通**：dict-sync `--map` 写出的字段级映射此前从未被 run-api 消费（文档承诺的死集成），
  现 buildPayload 按 `字段 → 字典码` 映射优先注入合法值。
- **零污染阻断**：契约缺 remove 操作或清理未成功时，run-api 结论不再允许"通过（可转测）"
  （`summary.cleanup.pending`）。
- **history.jsonl 容错**：单行损坏（并发写交错）跳过而非让 `report --trend` 整体崩溃。
- **Playwright 输出解析**：兼容千分位分组数字（"1,234 passed" 此前解析为 1）。

### Changed — 门禁布尔化 + 退出码统一

- run-api / run-playwright / run-jmeter 结果新增 `pass` 布尔字段，CI 门禁判定消费布尔值，
  不再依赖中文文案（`decision.startsWith("不通过")` 等脆弱判断）。
- 退出码规范：**0 通过 / 1 运行失败 / 2 用法错误**。修复 7 个命令缺必填参数退出 0、
  run-gen 生成失败退出 0、doctor/validate 失败退出 0、audit/fix/run-playwright/run-jmeter
  错误路径退出 0 的门禁漏判。
- report 自动发现按 **mtime** 取最新（字典序会让 `result-10` 排在 `result-2` 前），并纳入
  **audit 维度**（`audit-result.json` → 报告"测试代码审计"章节）。
- JSON 读取统一剥离 UTF-8 BOM（Windows 记事本/PowerShell 产出的结果文件不再解析失败）。

---

## [0.11.0] — 2026-08-15（报告体系闭环 + 细粒度用例：每个维度产出到使用项目 + 历史趋势迭代）

> 端到端验证（使用项目视角）：run-api / audit / report 依次执行 → `test-reports/` 汇聚 7 类产物
> （api-报告/api-result/audit-报告/audit-result/测试报告/index/history.jsonl），report 自动发现维度结果、
> 二次运行出现趋势表，mock 后端零数据残留。

### Added — test-reports/ 统一报告体系（报告产出到使用项目）

- **目录约定**：所有报告产出统一进 `test-reports/`（`--reports-dir` 可改）——
  `api-报告.md + api-result.json`（run-api）/ `e2e-报告.md + playwright-result.json`（run-playwright，解析
  Playwright 原生 results.json 提取失败明细）/ `perf-报告.md + perf-result.json`（run-jmeter）/
  `audit-报告.md + audit-result.json`（audit，规则分布+文件明细+修复入口）/ `测试报告.md + index.md`（report）/
  `perf-compare-报告.md`（perf-compare）。
- **report 自动发现**：不传来源参数时扫描 `test-reports/` 约定文件（显式参数优先），聚合各维度生成规范 10 报告 + 上线判定。
- **运行历史与趋势**：`history.jsonl` 记录每次执行（kind/time/pass/通过率）；`report --trend` 追加最近 5 次趋势表
  ——支持"陆续迭代"的跨版本质量追踪；`index.md` 报告索引自动生成。
- gate 亦写入历史（kind=gate）。

### Added — 细粒度测试用例生成（颗粒度到字段，闭环可执行）

- `run-gen --granularity field`（或 MCP `wls_test_case_generate { granularity: "field" }`）：在基线矩阵之上追加
  **字段级**用例——必填置空(P0)/超长(P1)/数值 min·min-1·max·max+1 边界(P1)/非数值类型(P0)/非法枚举(P0)/
  特殊字符 XSS·SQL 注入探测(P2)/前后空格(P3)，以及**操作级**——重复提交(P0)/不存在主键(P1)/重复删除(P2)/
  无权限(P0，每个写操作)/分页边界(P2)/组合查询收敛(P3)。
- **执行闭环映射**：每条用例标注 dimension 与 autoExec——与 run-api DAG 步骤一一对应
  （field-required/type/length、op-duplicate/permission/pagination 等由 run-api 自动执行），其余诚实标注为人工/待扩展。
- 输出对齐规范 02/03（编号/优先级/前置/步骤/预期 + P0-P3 分布统计）。

### Changed

- run-api 默认输出从 cwd 散文件改为 `test-reports/api-报告.md`（`--output` 仍可覆盖）。

### Tests

- 164 → **179 个**全部通过：新增 case-fine-gen 规则(5)、维度报告渲染/解析(5)、自动发现+趋势+快照(2)、
  CLI report 自动发现+索引+历史/audit 维度报告/细粒度生成(4)。

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
