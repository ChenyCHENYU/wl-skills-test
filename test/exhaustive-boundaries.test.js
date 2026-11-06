import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../mcp/server.js";
import { e2eCheck } from "../lib/e2e-check.js";
import { runGate } from "../lib/gate.js";
import { generateSmokeSuite } from "../lib/test-codegen.js";

function fixture(t) {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-exhaustive-test-")));
  const root = path.join(outer, "project");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  return { outer, root, server: createServer({ projectRoot: root }) };
}

test("JMX structure requires real XML, real root and in-project input", async t => {
  const { outer, root, server } = fixture(t);
  const pathFor = name => path.join(root, name);
  fs.writeFileSync(pathFor("malformed.jmx"), "<jmeterTestPlan><ThreadGroup></jmeterTestPlan>");
  fs.writeFileSync(pathFor("spoof.jmx"), "<other><!-- <jmeterTestPlan><ThreadGroup/> --></other>");
  fs.writeFileSync(pathFor("valid.jmx"), "<jmeterTestPlan><hashTree><ThreadGroup/></hashTree></jmeterTestPlan>");
  fs.writeFileSync(path.join(outer, "outside.jmx"), "<jmeterTestPlan><ThreadGroup/></jmeterTestPlan>");
  const call = jmxPath => server.callTool("wls_test_jmeter_validate", { jmxPath });
  assert.equal((await call("malformed.jmx")).structuredContent.valid, false);
  assert.equal((await call("spoof.jmx")).structuredContent.valid, false);
  assert.equal((await call("valid.jmx")).structuredContent.valid, true);
  assert.equal((await call(path.join(outer, "outside.jmx"))).structuredContent.errorCode, "MCP_PROJECT_SCOPE");
});

test("nested E2E files and empty scans cannot produce a passing gate", async t => {
  const { root, outer } = fixture(t);
  const tests = path.join(root, "tests");
  const fixtures = path.join(root, "fixtures");
  fs.mkdirSync(tests);
  fs.mkdirSync(fixtures);
  const catalog = path.join(fixtures, "suites.ts");
  fs.writeFileSync(catalog, "const OWNED_SPEC_GROUPS = [] as const;\n");
  assert.equal((await e2eCheck(root)).validationStatus, "unverified");
  assert.equal((await runGate({ e2eDir: root })).pass, false);
  fs.mkdirSync(path.join(tests, "orders"));
  const spec = path.join(tests, "orders", "list.test.tsx");
  fs.writeFileSync(spec, "test.only('hidden', () => {});\n");
  const unowned = await e2eCheck(root);
  assert.equal(unowned.totalSpecs, 1);
  assert.ok(unowned.findings.some(row => row.file === 'tests/orders/list.test.tsx' && row.message.includes('test.only')));
  assert.equal((await runGate({ e2eDir: root })).pass, false);
  fs.writeFileSync(catalog, 'export const CORE = ["orders/list.test.tsx"] as const;\nconst OWNED_SPEC_GROUPS = [CORE] as const;\n');
  fs.writeFileSync(spec, "test('nested', () => {});\n");
  const gate = await runGate({ e2eDir: root });
  assert.equal(gate.pass, true);
  assert.deepEqual(gate.checkedFiles, [spec]);
  assert.match(gate.summary.verdict, /所选检查/);
  assert.doesNotMatch(gate.summary.verdict, /允许上线/);
  fs.symlinkSync(outer, path.join(tests, "redirect"));
  assert.equal((await e2eCheck(root)).validationStatus, "unverified");
  assert.equal((await runGate({ e2eDir: root })).pass, false);
});

test("smoke selection reports selected coverage without an execution pass rate", () => {
  const result = generateSmokeSuite([{name: "正常路径", type: "api", priority: "P0"}]);
  assert.equal(result.smokeCount, 1);
  assert.equal(result.selectionRate, 100);
  assert.equal(result.executionStatus, "not-executed");
  assert.equal(Object.hasOwn(result, "passRate"), false);
});

test("E2E MCP bounds generation and validates legacy literal ownership without executing modules", async t => {
  const { outer, root, server } = fixture(t);
  const outside = path.join(outer, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, "page-spec.json"), JSON.stringify({ page: "订单", mode: "LIST", dir: "/views/orders" }));
  const generate = outputDir => server.callTool("wls_test_e2e_generate", { contractPath: "page-spec.json", outputDir });
  assert.equal((await generate(outside)).structuredContent.errorCode, "MCP_PROJECT_SCOPE");
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.mkdirSync(path.join(root, "unsafe"));
  fs.symlinkSync(outside, path.join(root, "unsafe", "fixtures"));
  assert.equal((await generate("unsafe")).structuredContent.errorCode, "MCP_PROJECT_SCOPE");
  assert.equal(fs.existsSync(path.join(root, "unsafe", "support")), false);
  assert.equal((await generate("safe")).isError, undefined);
  const suites = path.join(root, "safe", "fixtures", "suites.js");
  const marker = path.join(outer, "executed.txt");
  fs.appendFileSync(suites, `\nfs.writeFileSync(${JSON.stringify(marker)}, "must remain untouched");\n`);
  const checked = await server.callTool("wls_test_e2e_check", { target: "safe", runId: "no-import" });
  assert.equal(checked.structuredContent.pass, true, JSON.stringify(checked.structuredContent));
  assert.equal(fs.existsSync(marker), false);
  fs.appendFileSync(suites, "\nconst OWNED_SPEC_GROUPS = getDynamicGroups();\n");
  fs.writeFileSync(suites, fs.readFileSync(suites, "utf8").replace("const OWNED_SPEC_GROUPS = [", "const DYNAMIC_ORIGINAL = ["));
  assert.equal((await server.callTool("wls_test_e2e_check", { target: "safe" })).structuredContent.pass, false);
  assert.equal(fs.existsSync(marker), false);
});
