/**
 * MCP Handler 测试 + 生成器测试
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDLERS } from "../mcp/tools/handlers.js";
import { generatePlaywrightScript } from "../lib/playwright-generator.js";
import { generateJmeterScript } from "../lib/jmeter-generator.js";
import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  protocolVersion: "1.0",
  resource: { contractId: "test-mcp", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    detail: { method: "GET", externalPath: "/order/getById/1", permission: "order_get_by_id" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
  },
  models: {
    createRequest: [
      { name: "orderNo", description: "订单号", required: true, type: "string" },
    ],
  },
  transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
};

const SAMPLE_PAGE_SPEC = {
  page: "订单列表",
  mode: "LIST",
  dir: "/views/order/list",
  query: [{ name: "orderNo", label: "订单号", type: "input" }],
  columns: [{ name: "orderNo", label: "订单号", type: "text", clickable: true }],
  toolbar: [{ label: "新增", color: "primary", action: "openModal" }],
  operations: [{ label: "编辑", action: "edit" }, { label: "删除", action: "delete" }],
  formSections: [{ name: "basic", label: "基本信息", fields: [{ name: "orderNo", required: true }] }],
};

// ── MCP Handler 测试 ──────────────────────────

test("MCP: wls_test_standards 无参数返回列表", () => {
  const result = HANDLERS.wls_test_standards({});
  assert.ok(Array.isArray(result.standards));
  assert.ok(result.standards.length >= 11);
});

test("MCP: wls_test_standards 按 ID 返回内容", () => {
  const result = HANDLERS.wls_test_standards({ id: "01" });
  assert.ok(result.id === "01" || result.error === undefined);
  if (result.content) assert.ok(result.content.includes("流程") || result.content.includes("测试"));
});

test("MCP: wls_test_contract_read 消费契约", () => {
  const tmpFile = join(process.cwd(), ".tmp-mcp-contract.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const result = HANDLERS.wls_test_contract_read({ path: tmpFile });
    assert.equal(result.type, "wl-api-contract");
    assert.equal(result.summary.entity, "Order");
    assert.equal(result.summary.operations.length, 3);
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("MCP: wls_test_contract_read 无效路径返回错误", () => {
  const result = HANDLERS.wls_test_contract_read({ path: "/nonexistent.json" });
  assert.ok(result.error);
});

test("MCP: wls_test_case_generate 从契约生成用例", () => {
  const tmpFile = join(process.cwd(), ".tmp-mcp-contract2.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const result = HANDLERS.wls_test_case_generate({ contractPath: tmpFile });
    assert.ok(result.caseCount > 0);
    assert.ok(result.cases.length > 0);
    assert.equal(result.summary.entity, "Order");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("MCP: wls_test_case_generate 无路径返回错误", () => {
  const result = HANDLERS.wls_test_case_generate({});
  assert.ok(result.error);
});

test("MCP: wls_test_quality_analyze DI 计算", () => {
  const result = HANDLERS.wls_test_quality_analyze({
    defects: [{ severity: "critical", status: "open" }],
    caseCount: 100,
  });
  assert.equal(result.di, 3);
  assert.equal(result.releaseDecision, "blocked");
});

test("MCP: wls_test_quality_analyze 无缺陷时允许上线", () => {
  const result = HANDLERS.wls_test_quality_analyze({ defects: [], caseCount: 100 });
  assert.equal(result.di, 0);
  assert.equal(result.releaseDecision, "pass");
});

test("MCP: wls_test_jmeter_validate 校验有效 jmx", () => {
  const tmpFile = join(process.cwd(), ".tmp-valid.jmx");
  writeFileSync(tmpFile, `<?xml version="1.0"?><jmeterTestPlan><hashTree>
    <ThreadGroup guiclass="ThreadGroupGui"/>
    <ResultCollector guiclass="StatVisualizer"/>
  </hashTree></jmeterTestPlan>`);
  try {
    const result = HANDLERS.wls_test_jmeter_validate({ jmxPath: tmpFile });
    assert.equal(result.valid, true);
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("MCP: wls_test_jmeter_validate 检测 ConfigTestElement 致命坑", () => {
  const tmpFile = join(process.cwd(), ".tmp-bad.jmx");
  writeFileSync(tmpFile, `<jmeterTestPlan>
    <ThreadGroup guiclass="ThreadGroupGui"/>
    <ConfigTestElement guiclass="TestPlanGui"/>
    <ResultCollector/>
  </jmeterTestPlan>`);
  try {
    const result = HANDLERS.wls_test_jmeter_validate({ jmxPath: tmpFile });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.severity === "fatal"));
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("MCP: wls_test_jmeter_validate 无效路径返回错误", () => {
  const result = HANDLERS.wls_test_jmeter_validate({ jmxPath: "/nonexistent.jmx" });
  assert.ok(result.error);
});

test("MCP: wls_test_env_check 返回环境信息", () => {
  const result = HANDLERS.wls_test_env_check({});
  assert.ok(result.checks.nodeVersion);
  assert.equal(typeof result.ready, "boolean");
});

test("MCP: wls_test_smoke_select 无路径返回错误", () => {
  const result = HANDLERS.wls_test_smoke_select({});
  assert.ok(result.error);
});

// ── Playwright 生成器测试 ──────────────────────

test("Playwright: 从 page-spec 生成脚本含选择器", () => {
  const tmpFile = join(process.cwd(), ".tmp-page-spec.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_PAGE_SPEC));
  try {
    const script = generatePlaywrightScript(tmpFile, { baseUrl: "http://test.com" });
    assert.ok(script.includes("import"));
    assert.ok(script.includes("订单列表"));
    assert.ok(script.includes("新增"));
    assert.ok(script.includes("数据闭环"));
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("Playwright: 从 wl-api-contract 生成 CRUD 测试", () => {
  const tmpFile = join(process.cwd(), ".tmp-api-contract.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const script = generatePlaywrightScript(tmpFile, { baseUrl: "http://test.com" });
    assert.ok(script.includes("queryPage"));
    assert.ok(script.includes("save"));
    assert.ok(script.includes("Order"));
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

// ── JMeter 生成器测试 ─────────────────────────

test("JMeter: 生成有效 jmx 含线程组和采样器", () => {
  const tmpFile = join(process.cwd(), ".tmp-bd-contract.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const jmx = generateJmeterScript(tmpFile, { threads: 50 });
    assert.ok(jmx.includes("<jmeterTestPlan"));
    assert.ok(jmx.includes("<ThreadGroup"));
    assert.ok(jmx.includes("<HTTPSamplerProxy"));
    assert.ok(jmx.includes("num_threads"), "应含线程数属性");
    assert.ok(jmx.includes("__P(threads,50)"), "线程数应属性化（-Jthreads 运行时可调）");
    assert.ok(jmx.includes("ResultCollector"));
    assert.ok(jmx.includes("queryPage"));
    assert.ok(jmx.includes("<CSVDataSet"), "应含 CSV 参数化");
    assert.ok(jmx.includes("DurationAssertion"), "应含响应时间 SLA 断言");
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

test("JMeter: 生成的 jmx 不含 ConfigTestElement 致命坑", () => {
  const tmpFile = join(process.cwd(), ".tmp-jmx-check.json");
  writeFileSync(tmpFile, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const jmx = generateJmeterScript(tmpFile, {});
    assert.ok(!jmx.includes('ConfigTestElement guiclass="TestPlanGui"'));
  } finally {
    rmSync(tmpFile, { force: true });
  }
});

// ── 生成的 jmx 能通过 validator ────────────────

test("JMeter: 生成的 jmx 通过 wls_test_jmeter_validate", () => {
  const tmpContract = join(process.cwd(), ".tmp-validate-contract.json");
  const tmpJmx = join(process.cwd(), ".tmp-validate-out.jmx");
  writeFileSync(tmpContract, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const jmx = generateJmeterScript(tmpContract, { threads: 100 });
    writeFileSync(tmpJmx, jmx);
    const result = HANDLERS.wls_test_jmeter_validate({ jmxPath: tmpJmx });
    assert.equal(result.valid, true, `生成的 jmx 无效: ${JSON.stringify(result.issues)}`);
  } finally {
    rmSync(tmpContract, { force: true });
    rmSync(tmpJmx, { force: true });
  }
});
