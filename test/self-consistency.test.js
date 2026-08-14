/**
 * 自一致性测试 — 生成物必须通过自家审计与校验器（防"生成→审计"闭环自卡）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateJmeterScript } from "../lib/jmeter-generator.js";
import { generatePlaywrightScript } from "../lib/playwright-generator.js";
import { generateE2eScaffold } from "../lib/e2e-generator.js";
import { audit, checkSteppingThreadGroup } from "../lib/test-audit.js";
import { HANDLERS } from "../mcp/tools/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(process.cwd(), ".tmp-selfcheck");

const SAMPLE_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  protocolVersion: "1.0",
  resource: { contractId: "self-001", module: "order", entity: "Order&Co", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}", permission: "order_delete_by_id" },
    detail: { method: "GET", externalPath: "/order/getById/{id}", permission: "order_get_by_id" },
  },
  models: {
    createRequest: [{ name: "orderNo", description: "订单号", required: true, type: "string" }],
  },
  transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
};

const SAMPLE_PAGE_SPEC = {
  page: "订单列表",
  mode: "LIST",
  dir: "/views/order/list",
  query: [{ name: "orderNo", label: "订单号", type: "input" }],
  columns: [{ name: "orderNo", label: "订单号", type: "text" }],
  toolbar: [{ label: "新增", color: "primary", action: "openModal" }],
  operations: [{ label: "编辑", action: "edit" }, { label: "删除", action: "delete" }],
  formSections: [{ name: "basic", label: "基本信息", fields: [{ name: "orderNo", required: true }] }],
};

test("自一致性: 生成的 jmx 通过自家 audit（T1-T20）", () => {
  mkdirSync(TMP, { recursive: true });
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const jmxPath = join(TMP, "perf-test.jmx");
  try {
    const jmx = generateJmeterScript(contract, { threads: 50 });
    writeFileSync(jmxPath, jmx);
    const result = audit(jmxPath);
    assert.equal(result.error, undefined);
    assert.equal(
      result.pass,
      true,
      `生成的 jmx 应通过自审计，实际: ${JSON.stringify(result.findings.map((f) => f.rule + ":" + f.message))}`,
    );
    // 关键规则逐条确认
    assert.ok(jmx.includes("<CSVDataSet"), "应含 CSV 参数化（T13）");
    assert.ok(jmx.includes("DurationAssertion"), "应含响应时间断言（T16）");
    assert.ok(jmx.includes("${__P(threads,"), "线程数应属性化，-Jthreads 才能生效");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("自一致性: 生成的 jmx 通过 wls_test_jmeter_validate", () => {
  mkdirSync(TMP, { recursive: true });
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const jmxPath = join(TMP, "perf-test.jmx");
  try {
    writeFileSync(jmxPath, generateJmeterScript(contract, {}));
    const result = HANDLERS.wls_test_jmeter_validate({ jmxPath });
    assert.equal(result.valid, true, `issues: ${JSON.stringify(result.issues)}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("自一致性: 从契约生成的 Playwright 脚本通过自家 audit", () => {
  mkdirSync(TMP, { recursive: true });
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const specPath = join(TMP, "auto-test.spec.js");
  try {
    writeFileSync(specPath, generatePlaywrightScript(contract, { baseUrl: "http://localhost:8080" }));
    const result = audit(specPath);
    assert.equal(result.error, undefined);
    assert.equal(
      result.pass,
      true,
      `生成的 spec 应通过自审计: ${JSON.stringify(result.findings.map((f) => f.rule + ":" + f.message))}`,
    );
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("自一致性: 从 page-spec 生成的 Playwright 脚本通过自家 audit", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "page-spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const specPath = join(TMP, "auto-test.spec.js");
  try {
    writeFileSync(specPath, generatePlaywrightScript(spec, { baseUrl: "http://localhost:8080" }));
    const result = audit(specPath);
    assert.equal(result.pass, true, `: ${JSON.stringify(result.findings.map((f) => f.rule + ":" + f.message))}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("自一致性: 生成的 E2E 脚手架整体通过自家 audit", () => {
  mkdirSync(TMP, { recursive: true });
  const spec = join(TMP, "page-spec.json");
  writeFileSync(spec, JSON.stringify(SAMPLE_PAGE_SPEC));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(spec, { outputDir: outDir, baseUrl: "http://localhost:8080" });
    assert.ok(existsSync(join(outDir, "playwright.config.js")));
    // 审计整个脚手架目录（spec 文件按 Playwright 规则审计）
    const result = audit(outDir);
    assert.equal(
      result.pass,
      true,
      `E2E 脚手架应通过自审计: ${JSON.stringify(result.findings.map((f) => f.rule + ":" + f.message))}`,
    );
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("T8 回归: 正确的 SteppingThreadGroup（小写空格属性名）不误报", () => {
  const good = `<jmeterTestPlan><hashTree><SteppingThreadGroup guiclass="SteppingThreadGroupGui" testclass="SteppingThreadGroup" testname="阶梯加压"><stringProp name="Threads initial delay">0</stringProp><stringProp name="Start users count">10</stringProp><stringProp name="Start users ramp up (sec)">10</stringProp><stringProp name="flight time">60</stringProp></SteppingThreadGroup></hashTree></jmeterTestPlan>`;
  assert.equal(checkSteppingThreadGroup(good), false, "正确属性名不应被判驼峰违规");
});

test("T8 回归: 驼峰属性名仍能检出", () => {
  const bad = `<jmeterTestPlan><hashTree><SteppingThreadGroup guiclass="SteppingThreadGroupGui" testclass="SteppingThreadGroup"><stringProp name="threadsStartCount">10</stringProp></SteppingThreadGroup></hashTree></jmeterTestPlan>`;
  assert.equal(checkSteppingThreadGroup(bad), true, "threadsStartCount 是驼峰，应检出");
});

test("T11 回归: 预期结果列全空能检出", () => {
  const md = `# 测试用例\n\n| 序号 | 名称 | 优先级 | 预期结果 |\n|---|---|---|---|\n| TC-001 | 新增 | P0 |  |\n| TC-002 | 删除 | P0 |  |\n| TC-003 | 查询 | P0 |  |\n| TC-004 | 编辑 | P0 |  |\n`;
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, "cases.md");
  writeFileSync(p, md);
  try {
    const result = audit(p);
    assert.ok(result.findings.some((f) => f.rule === "T11"), "预期结果全空应触发 T11");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("XML 转义: 实体名含特殊字符生成合法 jmx", () => {
  mkdirSync(TMP, { recursive: true });
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT)); // entity 含 &
  const jmxPath = join(TMP, "perf-test.jmx");
  try {
    const jmx = generateJmeterScript(contract, {});
    assert.ok(!jmx.includes("Order&Co"), "实体名 & 必须转义");
    assert.ok(jmx.includes("Order&amp;Co"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
