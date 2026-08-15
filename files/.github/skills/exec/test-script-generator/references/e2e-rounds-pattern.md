# E2E 三轮策略与硬门模式（源自 wl-ui-produce 实战沉淀）

> 本参考文档把 wl-ui-produce（炼钢生产平台，32+ 页面 e2e）验证有效的模式固化为团队标准。
> 配套脚手架一键生成：`npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e`
> v0.7.0 增强：目录批量生成（`--contract ./src/views`）、登录态自动化（auth-setup）、UI 级受控写入、路由自动推导（`src/views/...` → `/...`）。
> v0.8.0 增强：7 层 project 编排、A/B/C 编号体系、用例归属清单强校验（e2e-check）、显式路由映射（routes.json）、
> UI 契约拦截（ui-contract）、高风险流程隔离（quarantine）、证据附件（testInfo.attach）、测试填充器标准（test-fill-standard.md）。

---

## 〇、A/B/C 编号体系与 project 路由（v0.8.0）

同一个 spec 文件内的用例按风险分层编号，由 playwright project 路由到不同执行策略：

| 编号 | 含义 | 归属 project | 风险 |
|------|------|-------------|------|
| A 组 | 只读验收（页面/搜索/重置/字典/列级断言） | round1-readonly / round1-detail | 零 |
| B 组 | 受控写入（账本 + 正式清理接口保护） | round2-write | 中（三重门禁） |
| C 组 | API 独立验证（queryPage 结构/落库复核） | 并入各 spec 或 run-api | 零（只读接口） |
| B 组（高风险） | 共享状态变更（下达/退回/分割） | quarantine（默认全部 skip） | 高 |

**工程强校验**：`fixtures/suites.js` 的 `assertE2ESpecCatalog()` 在 config 加载阶段执行——
未归类/重复归属/文件缺失/test.only/写入组缺安全标记/Bearer 截断/隔离声明漂移/UI 契约缺拦截，任一命中即拒绝运行。
独立执行：`npx @agile-team/wl-skills-test e2e-check --target ./e2e`。

**显式路由映射**：真实路由常与目录无关（`/lgBaseData/lgBaseDataMaster` ≠ `src/views/base-data/master`），
必须提供 `routes.json`（pageId→路由，生成器双向一致性校验，missing/extra 即失败）；仅无映射时回退 dir 推导并在 pages.js 标注 `routeSource: "derived"` 待人工核对。

---

## 一、三轮测试策略

测试不是一轮跑完，而是按**风险递增**分轮，每轮有独立的准入门槛：

| 轮次 | 定位 | 风险 | 准入 |
|------|------|------|------|
| ROUND1 只读冒烟 | 打开页面 → 表格/空态断言 → 网络监控 | 零风险 | 无门槛，随时可跑 |
| ROUND2 受控写入 | 新增 → 真实落库校验 → 清理 → 复查 | 写测试环境数据 | 三重门禁（见下） |
| CLEANUP 恢复清理 | 按账本恢复未完成的清理 | 删除测试数据 | 必须显式指定账本文件 |

**测试到什么程度（硬标准）：**

1. ROUND1 每个页面**必须**覆盖：登录态有效、页面渲染表格或明确空态、至少观察到一个业务接口响应
2. ROUND2 写入**必须**覆盖：新增返回真实主键 → queryPage 查到该主键（真实落库）→ 清理 → queryPage 查不到（零污染）
3. 可写页面必须验证至少一个可见业务操作按钮

## 二、五道硬门（防假通过）

来自实战踩坑，任何一道不过 = 测试失败：

| # | 硬门 | 防什么 |
|---|------|--------|
| 1 | **必须观察到至少一个业务接口响应** | 防"只看页面元素不看接口"的假通过（页面渲染了但接口全挂） |
| 2 | **HTTP≥400 / 业务码≠2000 / console error / pageerror 任一即失败** | 防只断言 UI 不看链路的宽泛通过 |
| 3 | **只读套件观察到写请求即失败** | 防"冒烟测试"偷偷改了数据 |
| 4 | **跳转登录页 = 失败，不是 skip** | 防登录态失效被当成用例跳过，覆盖率虚高 |
| 5 | **新增接口必须返回真实业务主键** | 没有主键就无法精确清理，测试会留脏数据 |

## 三、网络监控（network-monitor）

每个用例挂载页面级监控，结束时统一断言：

```javascript
const monitor = monitorPage(page, { readonly: true, isBusinessApi });
// ... 页面操作 ...
await monitor.assertClean("页面标识"); // 内部: 等 pending 响应 → 无业务响应抛错 → 有失败抛明细
```

- console error 监听需忽略 favicon / sourcemap 噪音
- 写请求识别：DELETE/PUT/PATCH 全算；POST 按 path 模式（/save、/updateById、/deleteById、/submit 等）
- 响应检查是异步的，断言前必须 `Promise.allSettled(pending)`

## 四、清理账本（run-ledger）

写入必须登记、清理必须可恢复，核心安全约束：

1. **业务键必须包含 runId**（如 `AT_TS20260815-AB12`）——禁止把共享业务数据写入清理账本
2. **清理请求必须携带本条记录的真实主键**——拒绝任何可能扩大范围的清理
3. 清理路径必须是当前网关相对路径（禁 `..`、`://`），方法只允许 DELETE/POST
4. 账本**原子落盘**（tmp + rename）；清理失败保留 pending 状态，可按账本恢复
5. runId 格式 `TS[A-Z0-9_-]{4,40}`，账本文件禁止覆盖

```javascript
const ledger = new RunLedger(); // 每次运行一个账本
const businessKey = `AT_${ledger.runId}`;
try {
  // 新增 → 拿到真实主键
  ledger.record({ pageId, operation, recordId, businessKey,
    cleanup: { method: "DELETE", path: `/api/xxx/deleteById/${recordId}` } });
  // 真实落库校验（queryPage 查询确认）
} finally {
  await cleanupLedger(request, token, ledger); // 逆序清理，失败保留账本
}
expect(ledger.summary().pending).toBe(0); // 清理后复查
```

## 五、写入门禁（environment）

ROUND2 默认禁止，三重确认才能写：

```
E2E_ENABLE_WRITE=1                    # 显式开关
E2E_WRITE_CONFIRM=<项目确认串>         # 防误触（如 WL_PRODUCE_PL_SIT）
E2E_ALLOWED_WRITE_HOSTS=<目标主机>     # 主机白名单
```

另需校验 API 基址路径只允许 dev/sit 网关，生产环境永远禁止。

## 五½、登录态自动化（auth-setup，v0.7.0 / v0.8.0 双模式）

- **人工模式（默认，兼容验证码/SSO/MFA）**：直接执行 `npm run e2e:auth`，在弹出的浏览器中人工完成登录，脚本等待离开登录页后自动保存 storageState（最长 4 分钟，`E2E_MANUAL_LOGIN_TIMEOUT_MS` 可调）
- **自动模式**：配置 `E2E_LOGIN_USER / E2E_LOGIN_PASSWORD`（选择器可用 `E2E_LOGIN_USER_SELECTOR / E2E_LOGIN_PASSWORD_SELECTOR` 覆盖）后自动填表登录
- 其余 project 检测到 `.auth/user.json` 自动复用
- UI 级 ROUND2 通过 `captureAuthorizationHeader(page)` 从页面业务请求捕获完整 Authorization 头（**禁止截断 Bearer 前缀**，真实系统可能是小写 bearer），复用浏览器登录态执行 API 校验与清理

## 五¾、UI 契约拦截与隔离流程（v0.8.0）

**UI 契约（ui-contract project）**：写请求被 `page.route` 拦截并返回成功信封，断言**端点 + payload 契约**（方法/路径模式/请求体携带业务键）——无安全测试数据、危险流程、任意环境下都能验证前端行为；**拦截结果不得作为真实落库/流程状态/外部集成的通过证据**（suites.js 强校验该组必须含 page.route）。

**隔离流程（quarantine project）**：满足任一条件的高风险 B 组用例必须隔离（默认 test.skip，声明被强校验防漂移）：
1. 共享业务状态变更（影响他人测试数据）
2. 无测试专属数据（无法保证操作对象属于本次 runId）
3. 无可靠逆操作（清理不能恢复原状态）

解除隔离前必须：准备测试专属种子数据（spec 头部显式声明）+ 实现可靠逆操作 + 移除 skip 并在 suites.js 移出隔离清单。

## 五⅘、测试填充钩子（v0.8.0）

UI 写入测试优先使用应用侧受控填充钩子 `[data-testid="wl-test-fill"]`（字典快照/数值边界/上下文字段保护/强制人工核对），
标准详见 `references/test-fill-standard.md`；page-spec 声明 `features.testFill: true` 后生成器自动接入。

## 六、证据附件（v0.8.0）

`monitor.assertClean(label, testInfo)` 把观察到的**全部业务响应**（e2e-business-responses.json）与**失败明细**（e2e-failures.json）attach 进 HTML 报告——失败可回溯到具体接口，不只是断言文本。

## 六、接口测试写到什么程度

| 层级 | 必须断言 | 对应工具 |
|------|---------|---------|
| HTTP 层 | status < 400 | run-api / api-probe |
| 业务层 | code === 2000（成功码可配） | run-api / api-probe |
| 数据层 | queryPage 能查到新增的主键（真实落库） | run-api（自动）/ round2 spec |
| 清理层 | 删除后查不到（零污染） | run-api（自动）/ round2 spec |
| 越权层 | 无权限 token 访问被拒 | 用例矩阵已生成，需无权限账号执行 |

## 七、与 wl-skills-test 工具链的衔接

```bash
# 一键生成全套脚手架（含 support/ 五个模块 + 三个 spec + config + README）
npx @agile-team/wl-skills-test run-gen --contract ./page-spec.json --type e2e --output ./e2e

# 生成后审计（生成的代码必须过 T1-T20）
npx @agile-team/wl-skills-test audit --target ./e2e

# MCP 工具（AI 编辑器内）
wls_test_e2e_generate { contractPath: "./page-spec.json", outputDir: "./e2e" }
```

## 八、用例写到什么程度（引用规范 02/03）

- 每功能点 ≥ 10 条用例（T19 卡门），P0~P3 四级优先级
- 必含异常场景（T20 卡门）：边界值、非法输入、权限拒绝、重复提交
- 用例矩阵由契约自动生成基础集（CRUD 正常路径 + 权限拒绝 + 必填校验），人工补充业务规则用例
