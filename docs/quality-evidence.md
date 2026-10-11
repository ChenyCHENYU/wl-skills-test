# DI 统计、执行证据与质量门

`calculateDI(defects, caseCount, { roundResults })`、MCP `wls_test_quality_analyze` 与原 CLI/CI 质量门使用相同判定。两参数调用仍可取得缺陷权重与统计结果，但统计达标不能证明执行或允许上线。

## 输入与结论

- `caseCount` / `cases` 必须显式提供正整数，表示本次统计的实际执行样本数。缺失、0、空值或非法值不会回退到 50；缺分母时 `diDensity=null`。
- `roundResults` 是执行摘要数组。每轮支持顶层或 `summary` 对象，包含 `total/passed/failed/errors/skipped/passRate`；计数、比率和可选执行明细必须一致。全跳过、零样本、失败断言、未完成清理与未通过的执行回执均不能变成成功。
- 各轮实际执行数（`total-skipped`）合计必须等于分母；不能用计划用例数扩大分母，也不能合并不同统计范围。重复执行属于执行样本数，人工按去重用例数统计的分析应另行说明，不能直接当作此入口的发布证据。
- `metricDecision` / `metricLevel` 描述 DI 统计；`releaseDecision` 仅描述当前提供的 DI 与执行证据，返回 `pass/blocked/unverified`。已有致命、严重或模块收敛失败可明确阻断；样本不足保持未验证。
- 该入口不自动证明全部业务、环境、历史趋势和宿主 Skill 遵循。整项任务仍看同 runId 的真实 `status` 和项目自己的完整 CI。

## MCP 示例

```json
{
  "defects": [],
  "caseCount": 2,
  "roundResults": [{"total":2,"passed":2,"failed":0,"errors":0,"skipped":0,"passRate":100}]
}
```

`caseCount` 已公开在 MCP 参数 Schema 中。摘要必须来自实际执行结果，不能依据模型自报、预估数量或仅有通过率补造。

## 原 CLI 与 CI

```bash
wl-skills-test gate --defects defects.json --cases 2 --round-results rounds.json
node node_modules/@agile-team/wl-skills-test/scripts/quality-gate.js \
  --defects defects.json --cases 2 --round-results rounds.json
```

`rounds.json` 是上述摘要数组；也可提供 `--smoke-result smoke.json`，DI 直接复用该真实摘要。分母必须与该报告的实际执行数一致。证据不足退出 1，不能输出允许上线。只提供源码审计时，该检查仅证明适用 T 规则审计，不证明测试业务执行。

报告消费 `defects.json` 时，支持 `{ "defects": [], "caseCount": 2, "roundResults": [...] }`。旧裸数组仍能分析缺陷；未提供执行摘要时 DI 维度未验证，整合报告不能通过。摘要达标但没有同 runId 的来源哈希与真实回执，任务验证仍未决。

## 自动修复范围

CLI `fix` 和 MCP `wls_test_fix` 共用安全收集器，限定授权 `root` 下的目标子树；目标或祖先实际越出项目时拒绝且零写入。目录内符号链接与循环不跟随，返回/打印 `skippedEntries`。空安全范围保持未验证，存在跳过则显示 `partial`（CLI 退出 1）。MCP 默认预览，明确 `confirm:true` 后才写入。修复统计不等于规则验证，完成后仍须 `audit` 复验。
