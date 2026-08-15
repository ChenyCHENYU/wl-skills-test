# 测试填充器标准（test-fill-standard）

> 源自 wl-ui-produce `test-fill-runtime` 实战沉淀（v0.8.0 固化为标准）。
> 解决的问题：UI 级写入测试靠 placeholder 猜填极脆弱——字典字段填错选项、数值越界、日期格式不符，
> 测试还没验证业务就死在填表上。应用侧提供的受控填充钩子比测试侧猜填健壮一个数量级。

---

## 一、为什么需要（测试侧填表的四大坑）

| 坑 | 测试侧猜填 | 应用侧填充器 |
|----|-----------|-------------|
| 字典/枚举字段 | 填任意文本 → 校验失败或落脏数据 | 从**字典快照**取第一个合法选项 |
| 数值边界 | 填 1 可能低于 min / 超出精度 | 按 min/max/step/fractionDigits 夹取 |
| 关联上下文字段（炉号/计划号） | 随便填 → 外键不存在 | **保护字段白名单**拒绝填充 |
| 未绑定字典的枚举 | 猜值 → 落错分类 | **不猜**（hasUnmanagedEnumSemantics 拒填） |

## 二、应用侧实现标准（被测项目）

1. **环境硬门**：仅 dev/SIT 构建暴露（`["dev","sit"].includes(import.meta.env.MODE)`），UAT/预发/生产恒为不可用。
2. **触发方式**：表单弹窗内提供按钮 `data-testid="wl-test-fill"`（wl-skills-test 生成器会优先识别此钩子，兼容 `steel-test-fill`）。
3. **填值规则**（按字段语义，与 wl-skills-test 数据工厂对齐）：
   - 备注/说明类 → `ROUND2测试-{runId}`；名称类 → `测试{runId}`；编码/编号类 → `{runId}`
   - 数值 → min（含 minExclusive 偏移 step），受 max/精度约束
   - 日期 → 开始类当前时间，结束类 +30min；按 date/time/datetime 格式化
   - 字典字段 → 从字典快照取第一个选项（**禁止发 HTTP 请求取字典**）
4. **保护字段**：`id/revision/company_id/heat_id/heat_no/plan_no/work_order_no/cast_no` 等真实计划上下文字段**拒绝填充**（防篡改他人数据链）。
5. **禁止行为**：填充器内部不得调用任何 HTTP/业务接口（纯本地填值）；不得自动提交——**填充后必须显示"请核对后手动保存"**，由测试或人工确认再保存。
6. **runId 规范**：`TS{MMDDHHmmss}{序号}` 或账本 runId，保证业务键可识别、可清理。

## 三、对测试填充设施本身做安全审计

被测项目应有类似 `verify-steelmaking-test-fill.mjs` 的自检脚本进 CI，校验：
- 环境硬门存在（dev/SIT 白名单）
- 保护字段清单存在且覆盖核心上下文字段
- 无 HTTP 调用
- 不猜未绑定字典的枚举
- 弹窗含"请核对后手动保存"提示

wl-skills-test 侧对应的静态规则：T22（写入 spec 安全标记）、T23（禁止 Bearer 截断）+ 本标准的 `wl-test-fill` testid 约定。

## 四、生成器/测试侧如何消费

- `run-gen --type e2e`：page-spec 声明 `features.testFill: true` 时，round2/UI 契约 spec 自动优先点击 `[data-testid="wl-test-fill"]`，无钩子时回退 placeholder 填充
- UI 契约 spec（拦截模式）同样优先使用填充钩子——拦截 + 填充 = 任何环境可跑完整行为契约验证

## 五、page-spec 声明方式

```json
{
  "page": "原物料主档",
  "features": { "testFill": true }
}
```
