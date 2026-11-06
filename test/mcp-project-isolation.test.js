import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "../mcp/server.js";

const stdioEntry = fileURLToPath(new URL("../mcp/index.js", import.meta.url));
const ownPackage = "@agile-team/wl-skills-test";

function setup(t) {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-mcp-boundary-")));
  const root = path.join(outer, "bound");
  const outside = path.join(outer, "outside");
  for (const folder of [root, outside]) {
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: path.basename(folder), dependencies: { [ownPackage]: "*" } }));
  }
  t.after(() => fs.rmSync(outer, { recursive: true, force: true }));
  return { root, outside };
}

function toolCalls(mode, root, outside) {
  if (mode === "embedded") {
    const server = createServer({ projectRoot: root });
    return async requests => Promise.all(requests.map(([name, args]) => server.callTool(name, args)));
  }
  return async requests => {
    const input = requests.map(([name, args], index) => JSON.stringify({
      jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name, arguments: args },
    })).join("\n") + "\n";
    const child = spawnSync(process.execPath, [stdioEntry], { cwd: outside, env: { ...process.env, WL_PROJECT_ROOT: root }, input, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    const replies = child.stdout.trim().split("\n").map(line => JSON.parse(line)).sort((a, b) => a.id - b.id);
    assert.equal(replies.length, requests.length);
    return replies.map(reply => reply.result);
  };
}

for (const mode of ["stdio", "embedded"]) {
  test(`${mode}: task, status, reports and file tools share the bound project boundary`, async t => {
    const { root, outside } = setup(t);
    const calls = toolCalls(mode, root, outside);
    const outsideCases = path.join(outside, "cases.json");
    const sentinel = path.join(outside, "sentinel.md");
    const outsideSpec = path.join(outside, "foreign.spec.js");
    const cases = [{ name: "本地正常路径", type: "api", priority: "P0" }];
    fs.writeFileSync(outsideCases, JSON.stringify([{ ...cases[0], name: "项目外正常路径" }]));
    fs.writeFileSync(sentinel, "preserve");
    fs.writeFileSync(outsideSpec, "const value = 1;");
    fs.writeFileSync(path.join(root, "cases.json"), JSON.stringify(cases));
    fs.mkdirSync(path.join(root, "nested"));
    fs.copyFileSync(path.join(outside, "package.json"), path.join(root, "nested", "package.json"));
    fs.writeFileSync(path.join(root, "nested", "cases.json"), JSON.stringify(cases));
    fs.writeFileSync(path.join(root, "defects.json"), JSON.stringify({ defects: [{ severity: "minor", status: "closed" }], caseCount: 1 }));
    fs.symlinkSync(outsideCases, path.join(root, "linked-cases.json"));
    fs.symlinkSync(sentinel, path.join(root, "linked-output.md"));
    fs.mkdirSync(path.join(root, "test-reports"));
    fs.writeFileSync(path.join(outside, "history.jsonl"), "{}\n");
    fs.symlinkSync(path.join(outside, "history.jsonl"), path.join(root, "test-reports", "history.jsonl"));

    const task = { action: "task", task: "生成测试用例", runId: "scope-test" };
    const report = { defects: "defects.json", cases: 1, allowLegacy: true };
    const rejected = await calls([
      ["wls_test_task", { ...task, root: outside }],
      ["wls_test_task", { action: "status", root: outside, runId: task.runId }],
      ["wls_test_task", { ...task, files: [outsideSpec] }],
      ["wls_test_task", { ...task, files: ["nested/cases.json"] }],
      ["wls_test_smoke_select", { casePath: outsideCases }],
      ["wls_test_smoke_select", { casePath: "linked-cases.json" }],
      ["wls_test_report_generate", { ...report, output: sentinel }],
      ["wls_test_report_generate", { ...report, output: "linked-output.md" }],
      ["wls_test_report_generate", { ...report, defects: outsideCases, output: "should-not-exist.md" }],
      ["wls_test_report_generate", { ...report, trend: true, output: "should-not-exist.md" }],
      ["wls_test_audit", { target: outsideSpec, runId: "outside-audit" }],
      ["wls_test_audit", { target: "cases.json", reportsDir: outside, runId: "outside-audit" }],
      ["wls_test_fix", { root: outside, target: outsideSpec }],
      ["wls_test_run_playwright", { testDir: outside, runId: "outside-playwright" }],
      ["wls_test_sit_verify", { root: outside, inputFile: "cases.json", phase: "pre-sit" }],
    ]);
    for (const result of rejected) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.errorCode, "MCP_PROJECT_SCOPE", JSON.stringify(result.structuredContent));
    }
    assert.equal(fs.existsSync(path.join(outside, ".wl-skills")), false);
    assert.equal(fs.existsSync(path.join(root, ".wl-skills")), false);
    assert.equal(fs.existsSync(path.join(root, "nested", ".wl-skills")), false);
    assert.equal(fs.existsSync(path.join(root, "should-not-exist.md")), false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve");

    const [selection, generated, planned] = await calls([
      ["wls_test_smoke_select", { casePath: "cases.json" }],
      ["wls_test_report_generate", { ...report, output: "results/local.md" }],
      ["wls_test_task", { ...task, root: ".", files: ["cases.json"] }],
    ]);
    assert.equal(selection.structuredContent.cases[0].name, cases[0].name);
    assert.equal(generated.isError, undefined);
    assert.equal(generated.structuredContent.ok, true);
    assert.equal(generated.structuredContent.reportStatus, "generated");
    assert.equal(generated.structuredContent.quality.pass, false);
    assert.match(generated.content[0].text, /报告=已生成；质量验证=(?:failed|unverified)；质量判定=blocked/u);
    assert.equal(fs.existsSync(path.join(root, "results", "local.md")), true);
    assert.equal(planned.structuredContent.notice.projectRoot, root);
    assert.equal(fs.existsSync(path.join(root, planned.structuredContent.recordPath)), true);
  });
}

test("embedded Playwright launches the version probe and runner in the bound project", {
  skip: process.platform === "win32" ? "POSIX executable fixture" : false,
}, async t => {
  const { root } = setup(t);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, "tests"));
  const fake = path.join(bin, "npx");
  fs.writeFileSync(fake, `#!/usr/bin/env node\n${String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync("runner-observed.jsonl", JSON.stringify({ cwd: process.cwd(), args }) + "\n");
console.log(args.includes("--version") ? "Version 1.59.0" : "1 passed");
`}`, { mode: 0o700 });
  const previous = process.env.PATH;
  process.env.PATH = bin + path.delimiter + previous;
  t.after(() => { process.env.PATH = previous; });

  const result = await createServer({ projectRoot: root }).callTool("wls_test_run_playwright", { testDir: "tests", runId: "pw-bound" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.execution.executionStatus, "completed");
  const lines = fs.readFileSync(path.join(root, "runner-observed.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(lines.map(item => item.cwd), [root, root]);
  assert.deepEqual(lines[1].args, ["playwright", "test", path.join(root, "tests"), "--reporter=list"]);
});
