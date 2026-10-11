import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(repo, 'bin/wl-skills-test.js');
const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-invoke-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@agile-team/wl-skills-test': version } }));
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(run(['init']).status, 0);
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests/sample.test.js'), 'import { test, expect } from "@playwright/test";\ntest("example", async ({ page }) => { await expect(page.locator("main")).toBeVisible(); });\n');
  const request = input => {
    const file = path.join(os.tmpdir(), `wl-invoke-request-${process.pid}-${Math.random()}.json`);
    fs.writeFileSync(file, JSON.stringify({ projectRoot: root, ...input }));
    try { const result = run(['protocol', 'request', '--input-file', file]); return { ...result, envelope: JSON.parse(result.stdout) }; }
    finally { fs.unlinkSync(file); }
  };
  return { root, run, request };
}
test('single test package: structured audit reuses native receipts; rejected parameters write nothing', t => {
  const { root, request } = fixture(t);
  const planned = request({ operation: 'task', task: '检查测试代码规范', targets: ['tests/sample.test.js'], runId: 'invoke-audit' });
  assert.equal(planned.envelope.result.integration.ready, true);
  const targets = planned.envelope.result.integration.targets;
  const directory = path.join(root, '.wl-skills-test/runs/invoke-audit');
  const snapshot = () => JSON.stringify(fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')]));
  const before = snapshot();
  const rejected = request({ operation: 'execute', runId: 'invoke-audit', executorId: 'audit', parameters: { targets, invented: true } });
  assert.equal(rejected.envelope.ok, false);
  assert.equal(rejected.envelope.error.code, 'invalid-executor-input');
  assert.equal(snapshot(), before);
  const result = request({ operation: 'execute', runId: 'invoke-audit', executorId: 'audit', parameters: { targets } });
  assert.equal(result.envelope.ok, true, JSON.stringify(result.envelope.error));
  assert.equal(result.envelope.result.execution.exitCode, 0, result.envelope.result.execution.stdout);
  const reports = result.envelope.result.execution.reportsDirectory;
  t.after(() => fs.rmSync(reports, { recursive: true, force: true }));
  assert.ok(!reports.startsWith(root + path.sep));
  assert.equal(result.envelope.result.integration.executionStatus, 'completed');
  assert.equal(result.envelope.result.integration.validationStatus, 'partial', 'audit 不替代计划要求的真实行为测试');
  const status = request({ operation: 'status', runId: 'invoke-audit' });
  assert.deepEqual(result.envelope.result.integration, status.envelope.result.integration);
});
