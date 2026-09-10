/**
 * cli/commands/validate-contract.js — 契约快速校验（生成→执行之间的质量门）
 */
import { validateContractFile } from "../../contract-validate.js";

export function cmdValidateContract(parsed) {
  const target = parsed.opts.contract || parsed.opts.target || parsed.positional[0];
  if (!target) {
    console.log(`
用法: wl-skills-test validate-contract --contract <契约.json>

契约快速校验（规则源自 consumeContract 真实归一逻辑）:
  - JSON 可解析 / 实体标识存在
  - 操作路径以 / 开头、{id} 占位只允许 detail/update/remove、method 合法
  - createRequest 字段非空且不重名、required 布尔
  - transport.successCode 数值、maxSize ≥ defaultSize
  - page-spec: dir 反斜杠提示、columns 空提示

error 级违规 → 退出码 1（run-api 执行前也会串联同样校验）

示例:
  wl-skills-test validate-contract --contract ./wl-contract.json
`);
    process.exitCode = 2;
    return;
  }

  const result = validateContractFile(target);
  const kindText = result.kind ? `（类型: ${result.kind}）` : "";
  console.log(`\n[validate-contract] ${target}${kindText}\n`);
  if (result.findings.length === 0) {
    console.log("✅ 契约校验通过，无发现问题\n");
    return;
  }
  for (const f of result.findings) {
    console.log(`  ${f.severity === "error" ? "❌" : "⚠️"} ${f.message}`);
  }
  const errors = result.findings.filter((f) => f.severity === "error").length;
  console.log(`\n${result.valid ? "✅ 无 error 级问题" : `❌ ${errors} 项 error 级问题（run-api 将拒绝执行）`}\n`);
  if (!result.valid) process.exitCode = 1;
}
