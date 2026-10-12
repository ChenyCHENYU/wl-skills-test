import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runJmeter, parseJtlResults } from '../lib/executors.js';
import { createInstallPlan, applyInstallPlan } from '../lib/cli/install-state.js';
import { PKG } from '../lib/cli/context.js';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-jmeter-evidence-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'plan.jmx'), '<jmeterTestPlan/>');
  const bin = path.join(root, 'jmeter');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('Apache JMeter 5.6.3 fixture'); process.exit(0); }
fs.writeFileSync(process.env.WL_JMETER_FIXTURE_ARGS, JSON.stringify(args));
fs.writeFileSync(args[args.indexOf('-l')+1], 'timeStamp,elapsed,label,success\\n1700000000000,300,fixture,true\\n1700000000100,300,fixture,true\\n');
`, { mode: 0o755 });
  return { root, bin, plan: path.join(root, 'plan.jmx'), argsFile: path.join(root, 'args.json') };
}
test('JTL empty/header-only/invalid elapsed cannot become green statistics', async (t) => {
  const { root } = fixture(t), file = path.join(root, 'result.jtl');
  for (const csv of ['', 'timeStamp,elapsed,label,success\n', 'timeStamp,elapsed,label,success\n1700000000000,bad,fixture,true\n', 'timeStamp,elapsed,label,success\n1700000000000,300,fixture,true\n1700000000100,bad,fixture,true\n']) {
    fs.writeFileSync(file, csv); const result = await parseJtlResults(file);
    assert.equal(result.pass, false); assert.ok(result.error);
  }
});
test('JMeter retains JMX threads unless explicitly overridden; invalid override is zero spawn/write', { skip: process.platform === 'win32' }, async (t) => {
  const { root, bin, plan, argsFile } = fixture(t), previous = process.env.WL_JMETER_FIXTURE_ARGS;
  process.env.WL_JMETER_FIXTURE_ARGS = argsFile;
  t.after(() => previous === undefined ? delete process.env.WL_JMETER_FIXTURE_ARGS : process.env.WL_JMETER_FIXTURE_ARGS = previous);
  const result = await runJmeter({ jmxPath: plan, jmeterPath: bin, resultDir: path.join(root, 'results') });
  assert.equal(result.samples, 2); assert.equal(result.threadSource, 'jmx-plan'); assert.equal(result.projectSlaVerified, false);
  assert.equal(JSON.parse(fs.readFileSync(argsFile)).some((arg) => arg.startsWith('-Jthreads=')), false);
  const explicit = await runJmeter({ jmxPath: plan, jmeterPath: bin, threads: 7, resultDir: path.join(root, 'explicit') });
  assert.equal(explicit.threadSource, 'explicit-override'); assert.ok(JSON.parse(fs.readFileSync(argsFile)).includes('-Jthreads=7'));
  const before = fs.readFileSync(argsFile);
  for (const threads of [true, 0, -1, '7', 1.2]) assert.ok((await runJmeter({ jmxPath: plan, jmeterPath: bin, threads, resultDir: path.join(root, 'invalid') })).error);
  assert.deepEqual(fs.readFileSync(argsFile), before); assert.equal(fs.existsSync(path.join(root, 'invalid')), false);
});
test('CLI performance regression is preserved in the same runId receipt and report', { skip: process.platform === 'win32' }, (t) => {
  const { root, argsFile } = fixture(t); applyInstallPlan(createInstallPlan(root, { filesDir: path.join(pkg, 'files'), version: PKG.version }));
  const reports = path.join(root, 'test-reports'); fs.mkdirSync(reports);
  fs.writeFileSync(path.join(reports, 'perf-baseline.json'), JSON.stringify({ samples: 2, p50: 100, p95: 100, p99: 100, errorRate: 0, throughput: 5 }));
  const cli = (args) => spawnSync(process.execPath, [path.join(pkg, 'bin/wl-skills-test.js'), ...args], { cwd: root, env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, WL_JMETER_FIXTURE_ARGS: argsFile }, encoding: 'utf8', timeout: 30000 });
  const run = cli(['run-jmeter', '--jmx', 'plan.jmx', '--baseline-compare', '--run-id', 'perf-regression']);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(reports, 'perf-result.json')));
  assert.equal(report.summary.pass, false); assert.equal(report.summary.baselineComparison.regressed, true);
  const status = JSON.parse(cli(['status', '--run-id', 'perf-regression', '--json']).stdout);
  assert.ok(status.tools.some((tool) => tool.checks?.some((c) => c.id === 'performance-baseline' && c.status === 'failed')), JSON.stringify(status));
  const before = fs.readFileSync(argsFile);
  assert.equal(cli(['run-jmeter', '--jmx', 'plan.jmx', '--threads', '7bad']).status, 2);
  assert.deepEqual(fs.readFileSync(argsFile), before);
});
