import { readFileSync } from "node:fs";
import schemaValidation from "../lib/schema-validation.cjs";

const receipt = JSON.parse(readFileSync(new URL("../lib/task-observability.schema.json", import.meta.url), "utf8"));
const { executionStatus, validationStatus } = receipt.properties;
const text = { type: "string", minLength: 1 };
const count = { type: "integer", minimum: 0 };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };

function result(properties) {
  return { type: "object", required: ["ok"], properties: {
    ok: { type: "boolean" }, error: text, errorCode: text, ...properties,
  } };
}

export const resultSchemas = {
  wls_test_task: { ...result({
    runId: { type: ["string", "null"] },
    notice: receipt.definitions.notice,
    records: { type: "array", items: { type: "object" } },
    pendingChecks: { type: "array", items: text },
    installation: { type: "object" },
  }), definitions: { scope: receipt.definitions.scope } },
  wls_test_fix: result({
    dryRun: { const: true }, planHash: hash, currentPlanHash: hash,
    fileCount: count, fixed: count, written: count, total: count,
    validationStatus: { const: "unverified" },
  }),
  wls_test_run_api: result({
    runId: receipt.properties.runId,
    profile: text, profileSourceChanged: { type: "boolean" },
    execution: { type: "object", required: ["executionStatus", "validationStatus", "recordPath", "receiptId"], properties: {
      executionStatus, validationStatus, recordPath: text, receiptId: text,
    } },
    pass: { type: "boolean" }, correlatedResultFile: text,
  }),
};

export function validateToolOutput(name, value) {
  if (!Object.hasOwn(resultSchemas, name)) return true;
  return schemaValidation.validateSchema(resultSchemas[name], value).valid;
}
