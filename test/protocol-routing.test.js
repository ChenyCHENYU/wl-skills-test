/**
 * protocol-routing.test.js — 路由准确性逐技能语料（预期经人工复核冻结）
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { protocol, runOperation } = require('../lib/cli/commands/protocol.js');
const cases = require('./protocol-routing-cases.json');
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'wl-skills-test.js');

const state = { installedRoot: null };

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'wl-test-routing-'));
}

function routeAt(projectRoot, task) {
  return protocol.request({ operation: 'route', projectRoot, task }, runOperation);
}

before(() => {
  state.installedRoot = tempRoot();
  const run = spawnSync(process.execPath, [BIN, 'init'], { cwd: state.installedRoot, encoding: 'utf8', timeout: 120000 });
  assert.equal(run.status, 0, run.stderr);
});

for (const item of cases) {
  const expectedBare = item.skill ? 'gap' : item.status;
  const expectedInstalled = item.installedStatus || (item.skill ? 'matched' : item.status);

  test(`未安装：「${item.task}」→ ${expectedBare}${item.skill ? ` + ${item.skill}` : ''}`, () => {
    const envelope = routeAt(tempRoot(), item.task);
    assert.equal(envelope.ok, true);
    const decision = envelope.result.decision || envelope.result;
    assert.equal(decision.status, expectedBare);
    if (item.skill) assert.ok(decision.selectedSkills.includes(item.skill), `应选中 ${item.skill}，实际 ${decision.selectedSkills}`);
    else assert.equal((decision.selectedSkills || []).length, 0);
  });

  test(`已安装：「${item.task}」→ ${expectedInstalled}${item.skill ? ` + ${item.skill}` : ''}`, () => {
    const envelope = routeAt(state.installedRoot, item.task);
    assert.equal(envelope.ok, true);
    const decision = envelope.result.decision || envelope.result;
    assert.equal(decision.status, expectedInstalled);
    if (item.skill) assert.ok(decision.selectedSkills.includes(item.skill));
  });
}
