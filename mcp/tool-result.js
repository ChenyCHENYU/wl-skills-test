/** One MCP result boundary for embedded and stdio callers. Domain evidence stays intact. */
import protocol from "../lib/task-observability.cjs";
import { taskOptions } from "../lib/observed-execution.js";
import { PKG } from "../lib/cli/context.js";
import { validateToolOutput } from "./result-schema.js";

function receiptView(payload, context) {
  if (!payload.execution?.recordPath || !payload.runId) return { record: payload.notice ? payload : {}, unavailable: "" };
  try {
    const record = protocol.readStatus(taskOptions({ root: context.projectRoot || process.cwd(), runId: payload.runId }));
    const matched = record.records.some(item => item.kind === "tool-finished" && item.eventId === payload.execution.receiptId);
    if (!matched) return { record: {}, unavailable: "\n执行回执不可用：当前项目未找到对应工具完成记录" };
    return { record, unavailable: "" };
  } catch (error) { return { record: {}, unavailable: `\n执行回执不可用：${error.message}` }; }
}

export function toolResult(value, context = {}) {
  let payload = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  const generatedReport = context.tool === "wls_test_report_generate" && payload.reportStatus === "generated";
  const qualityFailed = ["pass", "passed", "valid", "ready"].some(key => payload[key] === false)
    || payload.validationStatus === "failed" || payload.execution?.validationStatus === "failed" || payload.releaseDecision === "blocked";
  let failed = Boolean(payload.error || payload.inputErrors?.length || payload.ok === false || payload.success === false
    || (!generatedReport && qualityFailed) || payload.execution?.executionStatus === "failed"
    || ["blocked", "failed"].includes(payload.state));
  let structuredContent = { ...payload, ok: !failed };
  if (!validateToolOutput(context.tool, structuredContent)) {
    payload = {
      error: "MCP 输出契约验证失败；如操作可能已执行，请用同一 runId 查询回执后再决定是否重试",
      errorCode: "INVALID_TOOL_OUTPUT", ...(typeof payload.runId === "string" ? { requestedRunId: payload.runId } : {}),
    };
    failed = true;
    structuredContent = { ...payload, ok: false };
  }
  const { record, unavailable } = receiptView(payload, context);
  const mcpOutcome = context.mcpOutcome || (failed ? "failed" : payload.dryRun === true ? "preview" : "returned");
  const summary = protocol.formatExecutionReceipt(record, { tool: context.tool, packageName: PKG.name, packageVersion: PKG.version, mcpOutcome });
  const report = !failed && generatedReport ? `\n报告=已生成；质量验证=${payload.quality.validationStatus}；质量判定=${payload.quality.decision}` : "";
  const failure = failed && typeof payload.error === "string" ? `\n工具结果：${payload.error}` : "";
  return {
    content: [{ type: "text", text: summary + unavailable + report + failure }, { type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    ...(failed ? { isError: true } : {}),
  };
}

export function toolFailure(error, extra = {}, context = {}) {
  return toolResult({ error: error.message || String(error), errorCode: error.code || "TOOL_EXECUTION_ERROR", ...extra }, context);
}
