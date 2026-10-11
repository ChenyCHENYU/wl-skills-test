/** Actual subprocess samples exercise the lib, MCP schema and original CLI/CI admission. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { calculateDI } from "../lib/test-codegen.js";
import { runGate } from "../lib/gate.js";
import { createServer } from "../mcp/server.js";
import { HANDLERS } from "../mcp/tools/handlers.js";
import { createInstallPlan, applyInstallPlan } from "../lib/cli/install-state.js";
import { PKG_ROOT, PKG } from "../lib/cli/context.js";
import { generateReport } from "../lib/report-generator.js";

function fixture(t, fail = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-di-real-")));
  const reports = root + ".reports";
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(reports, { recursive: true, force: true }); });
  applyInstallPlan(createInstallPlan(root, { filesDir: path.join(PKG_ROOT, "files"), version: PKG.version }));
  const cases = path.join(root, "actual.test.mjs");
  fs.writeFileSync(cases, `import test from 'node:test';import assert from 'node:assert/strict';test('real first',()=>assert.equal(1,1));test('real second',()=>assert.equal(2,${fail ? 3 : 2}));`);
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const executed = spawnSync(process.execPath, ["--test", "--test-reporter=tap", cases], { cwd: root, encoding: "utf8", env: childEnv });
  assert.equal(executed.status, fail ? 1 : 0, executed.stderr);
  const count = label => Number(executed.stdout.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1]);
  const summary = { total: count("tests"), passed: count("pass"), failed: count("fail"), errors: 0, skipped: count("skipped") };
  summary.passRate = Math.round(summary.passed / (summary.total - summary.skipped) * 100);
  assert.equal(summary.total, 2);
  const rounds = path.join(root, "rounds.json"), defects = path.join(root, "defects.json");
  fs.writeFileSync(rounds, JSON.stringify([summary])); fs.writeFileSync(defects, "[]");
  const cli = args => spawnSync(process.execPath, [path.join(PKG_ROOT, "bin/wl-skills-test.js"), ...args], { cwd: root, encoding: "utf8" });
  return { root, reports, rounds, defects, summary, cli };
}

test("DI lib: statistics without denominator or real samples remain unverified; actual samples pass", t => {
  const f = fixture(t);
  for (const input of [{}, { caseCount: 2 }, { caseCount: 0, roundResults: [f.summary] }, { caseCount: null, roundResults: [f.summary] }, { caseCount: 2, roundResults: [] }, { caseCount: 3, roundResults: [f.summary] }]) {
    const result = calculateDI([], input.caseCount, input);
    assert.equal(result.releaseDecision, "unverified", JSON.stringify(input));
    assert.equal(result.level, "unverified"); assert.ok(result.evidence.errors.length);
  }
  const verified = calculateDI([], 2, { roundResults: [f.summary] });
  assert.equal(verified.releaseDecision, "pass"); assert.equal(verified.evidence.executed, 2);
  assert.equal(calculateDI([{ severity: "fatal", status: "open" }], 2, { roundResults: [f.summary] }).releaseDecision, "blocked");
  assert.equal(calculateDI(false, 2, { roundResults: [f.summary] }).releaseDecision, "unverified");
});

test("DI actual failed subprocess samples block a zero-defect statistical result", t => {
  const f = fixture(t, true); const result = calculateDI([], 2, { roundResults: [f.summary] });
  assert.equal(result.metricDecision, "pass"); assert.equal(result.releaseDecision, "blocked"); assert.equal(result.evidence.failed, 1);
});

test("DI MCP: caseCount is publicly declared; empty/zero/missing/invalid inputs cannot pass", async t => {
  const f = fixture(t); const server = createServer();
  const descriptor = server.listTools().find(tool => tool.name === "wls_test_quality_analyze");
  assert.equal(descriptor.inputSchema.properties.caseCount.type, "number");
  for (const args of [{}, { defects: [], roundResults: [] }, { defects: [], caseCount: 0, roundResults: [f.summary] }, { defects: [], caseCount: 2 }, { defects: [], caseCount: 3, roundResults: [f.summary] }, { defects: false, caseCount: 2, roundResults: [f.summary] }]) {
    const output = await server.callTool("wls_test_quality_analyze", args);
    assert.notEqual(JSON.parse(output.content[0].text).releaseDecision, "pass", JSON.stringify(args));
  }
  const output = await server.callTool("wls_test_quality_analyze", { defects: [], caseCount: 2, roundResults: [f.summary] });
  assert.equal(JSON.parse(output.content[0].text).releaseDecision, "pass");
  assert.equal((await server.callTool("wls_test_quality_analyze", { caseCount: "2" })).isError, true);
});

test("DI gate: lib/MCP/original CLI/CI use actual rounds and preserve nonzero on insufficient evidence", async t => {
  const f = fixture(t);
  const pass = await runGate({ defects: f.defects, cases: 2, roundResults: f.rounds }); assert.equal(pass.pass, true);
  for (const opts of [{ cases: 0, roundResults: f.rounds }, { roundResults: f.rounds }, { cases: 2 }, { cases: 2, roundResults: [] }, { cases: 3, roundResults: f.rounds }]) {
    const result = await runGate({ defects: f.defects, ...opts }); assert.equal(result.pass, false); assert.equal(result.validationStatus, "unverified");
  }
  const mcp = await HANDLERS.wls_test_gate({ root: f.root, reportsDir: f.reports, defects: f.defects, cases: 2, roundResults: [f.summary], runId: "di-mcp-pass" });
  assert.equal(mcp.pass, true); assert.equal(mcp.execution.validationStatus, "passed");
  for (const args of [[], ["--cases", "0"], ["--cases", "2"], ["--cases", "3", "--round-results", f.rounds]]) {
    const run = f.cli(["gate", "--defects", f.defects, ...args, "--reports-dir", f.reports]);
    assert.equal(run.status, 1, run.stdout); assert.ok(!run.stdout.includes("允许上线"));
  }
  const cli = f.cli(["gate", "--defects", f.defects, "--cases", "2", "--round-results", f.rounds, "--reports-dir", f.reports]);
  assert.equal(cli.status, 0, cli.stderr); assert.ok(cli.stdout.includes("允许上线"));
  for (const cases of [undefined, "0", "2", "3"]) {
    const args = cases === undefined ? [] : ["--cases", cases];
    if (cases === "2" || cases === "3") args.push("--round-results", f.rounds);
    const ci = spawnSync(process.execPath, [path.join(PKG_ROOT, "scripts/quality-gate.js"), "--defects", f.defects, ...args], { cwd: f.root, encoding: "utf8" });
    assert.equal(ci.status, cases === "2" ? 0 : 1, ci.stdout + ci.stderr);
  }
});

test("DI report consumer cannot turn statistics or missing samples into a successful business report", t => {
  const f = fixture(t);
  const noSamples = generateReport({ defects: f.defects, cases: 2 });
  assert.equal(noSamples.domainPass, false); assert.equal(noSamples.pass, false);
  const statisticalAndExecuted = generateReport({ defects: { defects: [], caseCount: 2, roundResults: [f.summary] }, cases: 2 });
  assert.equal(statisticalAndExecuted.domainPass, true);
  assert.equal(statisticalAndExecuted.pass, false, "执行摘要仍不等于同 runId 的来源回执验证");
  const concentrated = generateReport({ defects: { defects: [{ severity: "critical", status: "closed", module: "same" }, { severity: "general", status: "closed", module: "same" }], caseCount: 100, roundResults: [{ total: 100, passed: 100, failed: 0, errors: 0, skipped: 0, passRate: 100 }] }, cases: 100 });
  assert.equal(concentrated.domainPass, false, "密度低且缺陷关闭也不能跳过模块收敛指标");
});

test("confirmed fix skips external file/directory links and loops, rejects explicit escapes, CLI propagates partial", async t => {
  const f = fixture(t); const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-di-fix-outside-")));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const target = path.join(f.root, "selected"); fs.mkdirSync(target);
  const content = 'await page.waitForTimeout(5000);\n'; fs.writeFileSync(path.join(outside, "external.js"), content);
  fs.writeFileSync(path.join(target, "local.js"), content);
  fs.symlinkSync(outside, path.join(target, "linked")); fs.symlinkSync(path.join(outside, "external.js"), path.join(target, "external.js")); fs.symlinkSync(target, path.join(target, "loop"));
  const server = createServer(); const fixed = await server.callTool("wls_test_fix", { root: f.root, target, confirm: true });
  const result = JSON.parse(fixed.content[0].text); assert.equal(result.coverageStatus, "partial"); assert.equal(result.skippedEntries.length, 3); assert.equal(result.validationStatus, "unverified");
  assert.equal(fs.readFileSync(path.join(outside, "external.js"), "utf8"), content);
  const escaped = await server.callTool("wls_test_fix", { root: f.root, target: path.join(target, "linked"), confirm: true });
  assert.equal(JSON.parse(escaped.content[0].text).errorCode, "fix-target-outside-project");
  const cli = f.cli(["fix", "--target", target]); assert.equal(cli.status, 1); assert.ok(cli.stderr.includes("partial"));
  const invalid = f.cli(["fix", "--target", path.join(target, "linked")]); assert.equal(invalid.status, 1); assert.ok(invalid.stderr.includes("fix-target-outside-project"));
  assert.equal(fs.readFileSync(path.join(outside, "external.js"), "utf8"), content);
});

test("env-check reports current local prerequisites only, never invokes npx or borrows parent assets", t => {
  const f = fixture(t); const child = path.join(f.root, "unadopted-child"); fs.mkdirSync(child);
  const sentinel = path.join(f.root, "npx-invoked"); const commands = path.join(f.root, "commands"); fs.mkdirSync(commands);
  fs.writeFileSync(path.join(commands, "npx"), `#!/bin/sh\nprintf invoked > '${sentinel}'\n`, { mode: 0o755 });
  const oldPath = process.env.PATH; process.env.PATH = commands + path.delimiter + oldPath;
  try {
    const result = HANDLERS.wls_test_env_check({ root: child });
    assert.equal(result.checks.root, child); assert.equal(result.checks.standardsDir, false); assert.equal(result.checks.skillsDir, false);
    assert.equal(result.ready, false); assert.equal(result.checks.playwright, false);
    assert.equal(result.networkConnectivity, "unverified"); assert.equal(result.readinessScope, "local-prerequisites");
    assert.equal(fs.existsSync(sentinel), false);
    const local = HANDLERS.wls_test_env_check({ root: f.root });
    assert.equal(local.ready, true); assert.equal(local.networkConnectivity, "unverified");
  } finally { process.env.PATH = oldPath; }
});
