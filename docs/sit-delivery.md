# SIT 客户交付与模板保真

`sit` 属于 Test 包。CLI、MCP 与 Harness 的公开执行器复用同一输入校验、模板生成、交付检查和回执代码；不要求安装 Kit/UI/BD/Design，不引入另一套 Harness 测试规则。

## 模板与内容的区别

用户提供的四份测试工作一览表是同一套十三页测试准备/资产/场景/用例/方案/报告管理工作簿，列宽存在差异。它们管理准备状态和文档链接，不含测试方案、报告正文。另一个问题记录工作簿包含总览和八个领域，子表有二十四个问题字段，总览保留原一百三十五条公式。

发行包保存四个不同的净化版式 profile，而非重新画一张简化表。原 styles、列宽、行高、合并区、视图、打印设置保留；旧客户姓名、项目实例、外链、共享字符串残值、属性及个人水印不进入公开发行包。来源与模板 sha256、styles sha256 由 `sit templates` 返回，生成前校验模板完整性。

功能/跨模组用例复用测试小组提供的十四列表格：故事线编号、步骤、序号、名称、等级、分组、子模组、前置步骤、测试步骤、预期结果、类型、系统交互、编写人、时间。执行记录在其基础上增加轮次/实际结果/执行人/时间/问题/证据/清理字段，并保留原列样式、扩展列宽。方案和报告正文生成为 Markdown 附件，工作一览表引用这些附件；不宣称保留了测试小组 Word 方案的正文版式。空执行记录明确写“未执行”。

问题表数据按原列填充，超过原三行时按原数据行样式扩展。日期使用 Excel 数值日期，保留原日期格式和延期统计公式；不写伪造公式缓存，实际重算由 Excel 完成。最低级别 minor 沿用原“提示”分类，避免漏出总览统计。原 Feishu 导出陈旧的 `dimension=A1` 按真实单元格修正。文本作为 inline string，`=...` 不转换为公式。

原工作一览表有二十二个模组槽位；问题模板有八个领域槽位。可使用实际其他领域替换未使用槽位，并同步工作簿名与总览引用，不能丢掉问题。超过容量明确拒绝，需先评审更大的 profile，不截断数据。跨模组允许同一个 PC 系统的不同模组，不要求必须跨系统；全流程文件包含同故事线功能前置步骤，保留原用例类型。

## 使用

```sh
wl-skills-test sit templates --json
wl-skills-test sit generate --input sit.json --output ./SIT-delivery-v1 --json
wl-skills-test sit verify --input sit.json --phase pre-sit --json
wl-skills-test sit verify --input sit.json --phase pre-uat --json
```

完整 Schema 位于 `sit templates` 返回的 `result.inputSchema`，示例为 `docs/examples/sit-input.json`。`templateVariant` 可选 `worklist/worklist-1/worklist-2/worklist-3`。输出目录必须全新、父目录已存在；生成先在同级独立暂存目录完成，再整体发布，既有交付物/客户修改不覆盖。当前拒绝路径经过符号链接的输出目录，macOS 临时目录可先取 realpath。

输出内的 sit-input.json 是事实归档；证据路径仍相对原输入目录，manifest.evidencePathBase 明确该位置，不假装证据已经搬到交付目录。复验使用原输入，若迁移目录需重新安置证据并核对 hash。

输出包含工作一览、功能用例、跨模组用例、至少两份空白或实际填充的执行记录、问题记录、方案/报告正文、事实输入、检查结果及逐文件 hash 清单。这里的“至少两份”仅指文件准备；没有两轮真实执行时，校验仍阻断。

`templates` 与不带 `--run-id` 的 `verify` 只读，无网络。`generate` 不发业务请求、不创建业务数据、不代签客户回执。CLI 调用错误退出 2；检查记录不满足退出 1；满足退出 0。`ok` 仅表示调用成功，以 `result.passed/validationStatus` 判断校验结论。

## 核验条件

| 阶段 | 必须具备 |
| --- | --- |
| SIT 前 | 真实需求来源和逐需求用例覆盖；版本/环境/系统/责任人；用例评审通过；方案、用例在 SIT 开始前至少七个日历日交付客户，有回执文件与 hash |
| 转 UAT 前 | 以上条件；至少两轮顺序独立、同用例基线的全量执行；每条有实际结果/人/时间/证据；最后一轮全量通过；问题正确关联失败用例，负责人/原因/计划解决时间明确；致命/严重问题闭环；执行/问题/报告在最后一轮完成后、转 UAT 前交付 |

每轮 `caseBaselineSha256` 由 `generate` 返回，亦可从生成清单获取。用例基线忽略 JSON 对象键的传输顺序，保留用例次序与全部内容。两轮不能仅改 roundId 重用同一批执行时间；同轮未知/重复/跳过/阻塞用例不算全量。故事线依赖必须先通过再执行后续步骤。失败必须绑定本用例问题；后续轮复现同一问题可以复用同一 case 的缺陷编号，原失败来源仍要真实存在。关闭需要对应通过重测及关闭时间；“非问题”需要复核依据。写入测试必须附已完成清理的证据。

实际执行/交付/评审/关闭时间不能在未来。证据是 `{path, sha256}`，路径相对于输入 JSON 的目录；绝对路径、目录、上级逃逸及外部符号链接不接受。存在且 hash 一致只证明文件与声明相符：本命令没有观察真实业务行为、客户签收或模型加载，回执保留相应 false/unverified 状态，不以生成文档充当这些事件。

## 同 runId 与 Harness

```sh
wl-skills-test task --task 'SIT交付校验' --files sit.json --run-id sit-2026-01 --json
wl-skills-test sit verify --input sit.json --phase pre-uat --run-id sit-2026-01 --root . --json
wl-skills-test status --run-id sit-2026-01 --json
```

带 runId 的检查会写本包任务回执，并将输入和通过 hash 校验的证据文件纳入快照。证据后来改变，status 会过期。纯检查的“通过”与真实模型/业务测试事件仍分层展示。

公开 `executor-invoke-v1` 的 `sit-verify` 参数为 `{targets:[输入JSON绝对路径],phase:'pre-sit'|'pre-uat'}`。先建立同项目、同 runId、允许 `sit-delivery-checks` 的任务计划，随后 `protocol request` 执行；宿主必须使用返回的 canonical targets。调用原 CLI，不在适配器复制交付规则。

MCP 提供 `wls_test_sit_templates`、`wls_test_sit_generate`、`wls_test_sit_verify`。后者可传 root/runId 关联真实工具回执，省略 runId 时只读。MCP 运行时按 Schema 拒绝无效类型；不会把 required 仅写作说明。

## 测试小组补充的取舍

纳入：故事线/需求追溯、跨模组明确依赖、评审状态、准备/交付时点、两轮逐用例执行、问题身份和复验、写入清理证据、Office 原模板优先、缺事实列 gap。

沿用 Test 已有：OpenAPI/契约消费、细粒度用例、冒烟、真实 API/Playwright/JMeter、清理账本、DI/质量门、任务路由/notice/status。

不复制：项目专用 URL/账号/业务断言/客户资料、固定系统版本和 SLA、凑用例数量，以及仅根据日志关键词推断 passed 的第二套 Harness 引擎。T19 仅检查 Markdown 中项目明确声明的 `<!-- wl-test:min-cases=N -->`，无默认配额；需求覆盖由 SIT 的实际追溯记录检查，数量不等于覆盖。

## 离线维护模板

开发脚本 `scripts/prepare-sit-templates.py --help` 使用明确的四份工作一览、问题表、用例表和可选布局映射准备净化资产；固定 ZIP 时间/顺序，同输入可复现，所有 XML/关系与 MIME 引用校验后提交。原件不可作输出，不通过网络抓取客户资料。运行时无需 Python、源 Excel 或兄弟包。

本轮仍保留 0.x：新增客户交付场景先经实际 Office 全表重算/打印与客户试点验证，再评估稳定 API 的 1.0 承诺。原始行高保留；超长内容交付前应在实际 Excel 中检查换行和打印分页，事实输入 JSON 保留完整文本。

## 性能执行的事实边界

run-jmeter 未指定 --threads 时保留 JMX 自身线程配置，不注入100；显式值必须是正整数。空、仅表头或含无效采样的 JTL 不通过。--baseline-compare 在执行回执收尾前计算，回执和报告保留同一轮基线劣化，不能 CLI 退出失败而 status 仍显示通过。现有 JTL 默认筛查阈值为兼容行为，回执明确 assessmentBasis=legacy-package-screening-defaults/projectSlaVerified=false，不能把它当项目 SLA 已确认；项目要求仍须真实计划/阈值和评审。

项目级 owners 仅作为方案和报告的参与人员事实，不按数组顺序推断模组负责人；缺少模块归属事实时，工作一览对应字段明确填“待确认”。

所有事实字符串在创建输出前校验 XML 1.0 字符范围：非法控制符、U+FFFE/U+FFFF、未配对代理项带字段路径拒绝，不删除原事实后假装生成成功；合法 emoji、制表符与换行保留。
