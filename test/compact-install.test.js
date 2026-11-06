import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstallPlan, createCleanPlan, applyInstallPlan } from '../lib/cli/install-state.js';
import { PKG_ROOT } from '../lib/cli/context.js';
import { inspectInstallation } from '../lib/host-diagnostics.js';
import { planTask, taskStatus } from '../lib/cli/commands/tasks.js';
import { observeSync } from '../lib/observed-execution.js';

const filesDir = path.join(PKG_ROOT, 'files');
const stateRel = '.wl-skills/state/test/manifest.json';
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-compact-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function put(root, rel, body) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); }
function install(root, options = {}) {
  const plan = createInstallPlan(root, { filesDir, ...options });
  assert.deepEqual(plan.conflicts, []); applyInstallPlan(plan); return plan;
}

test('compact default installs one discoverable gateway and resolves all canonical resources inside the package', t => {
  const root = fixture(t); install(root);
  assert.deepEqual(fs.readdirSync(root).sort(), ['.agents', '.wl-skills', 'AGENTS.md']);
  assert.equal(fs.readFileSync(path.join(root, '.wl-skills/state/.gitignore'), 'utf8'), '*/runs/\n*/cache/\n*/backups/\n');
  assert.deepEqual(inspectInstallation(root).problems, []);
  const state = JSON.parse(fs.readFileSync(path.join(root, stateRel)));
  assert.deepEqual(state.hosts, ['codex']);
  assert.equal(state.files.length, 2);
  assert.ok(state.files.filter(item => item.kind === 'file').every(item => !Object.hasOwn(item, 'content')));
  put(root, 'tests/order.spec.js', 'export const order = 1;');
  const planned = planTask({ root, task: '通用测试规则', runId: 'compact-task', context: { files: ['tests/order.spec.js'] } });
  assert.equal(planned.decision.status, 'matched');
  assert.ok(planned.decision.requiredFiles.every(file => file.startsWith(path.join(PKG_ROOT, 'files') + path.sep)));
  observeSync('audit', { root, runId: 'compact-task' }, [path.join(root, 'tests/order.spec.js')], () => ({ pass: true, executedChecks: [{ id: 'T1', status: 'passed', evidencePaths: ['tests/order.spec.js'] }] }));
  const status = taskStatus({ root, runId: 'compact-task' });
  assert.equal(status.executionStatus, 'completed');
  assert.equal(status.planStale, false);
  assert.ok(status.tools[0].inputSnapshot.targets.every(file => !file.includes('/files/.github/')));
  assert.ok(status.tools[0].ruleSnapshot.targets.some(file => file.startsWith(PKG_ROOT)));
});

test('selected hosts use common discovery without adopting unrelated editor directories', t => {
  const root = fixture(t); put(root, '.cursor/rules/user.mdc', 'USER');
  put(root, 'package.json', JSON.stringify({ private: true, wlSkills: { schemaVersion: 1, integration: 'compact', hosts: ['codex', 'zcode', 'kilo'] } }));
  install(root);
  assert.ok(!fs.existsSync(path.join(root, '.kilo')));
  assert.ok(!fs.existsSync(path.join(root, '.zcode')));
  assert.equal(fs.readFileSync(path.join(root, '.cursor/rules/user.mdc'), 'utf8'), 'USER');
  install(root, { hosts: 'claude,cline', editor: 'all' });
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/wl-skills-test/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(root, '.cline')));
  assert.ok(!fs.existsSync(path.join(root, '.agents')));
});

test('compact migration reads legacy ownership, removes unchanged copies and preserves modified rules and foreign content', t => {
  const root = fixture(t); install(root, { integration: 'expanded', hosts: 'all' });
  const legacyRel = '.wl-skills-test/manifest.json';
  put(root, legacyRel, fs.readFileSync(path.join(root, stateRel)));
  fs.unlinkSync(path.join(root, stateRel));
  const modified = '.github/standards/02-case-design.md';
  fs.appendFileSync(path.join(root, modified), '\nLOCAL OVERRIDE\n');
  put(root, '.cursor/rules/user.mdc', 'FOREIGN');
  const migration = install(root, { integration: 'compact', hosts: 'codex' });
  assert.ok(migration.preserved.some(item => item.path === modified));
  assert.ok(!fs.existsSync(path.join(root, '.github/skills/plan/test-plan-generator/SKILL.md')));
  assert.ok(fs.readFileSync(path.join(root, modified), 'utf8').includes('LOCAL OVERRIDE'));
  assert.equal(fs.readFileSync(path.join(root, '.cursor/rules/user.mdc'), 'utf8'), 'FOREIGN');
  assert.ok(!fs.existsSync(path.join(root, legacyRel)));
  applyInstallPlan(createCleanPlan(root));
  assert.ok(fs.existsSync(path.join(root, modified)));
});

test('compact install failure rolls back configuration, gateway and manifest together', t => {
  const root = fixture(t); const original = '{"name":"project","private":true}\n'; put(root, 'package.json', original);
  const plan = createInstallPlan(root, { filesDir }); let count = 0;
  assert.throws(() => applyInstallPlan(plan, { writeFile(file, body, encoding) {
    if (++count === 3) throw new Error('injected'); fs.writeFileSync(file, body, encoding);
  } }), /已回滚/);
  assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), original);
  assert.ok(!fs.existsSync(path.join(root, stateRel)));
  assert.ok(!fs.existsSync(path.join(root, '.agents')));
});

test('shared state ignore preserves user entries through install and clean and rolls back with failed installation', t => {
  const root = fixture(t); const relative = '.wl-skills/state/.gitignore';
  const original = '# Project entries\r\nlocal-secret\r\n'; put(root, relative, original);
  const plan = createInstallPlan(root, { filesDir });
  assert.throws(() => applyInstallPlan(plan, { writeFile(file, body, encoding) {
    if (file.includes('manifest.json.wl-test-')) throw new Error('manifest write failure');
    fs.writeFileSync(file, body, encoding);
  } }), /已回滚/);
  assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), original);
  install(root); const installed = fs.readFileSync(path.join(root, relative), 'utf8');
  assert.ok(installed.startsWith(original));
  for (const pattern of ['*/runs/', '*/cache/', '*/backups/']) assert.equal(installed.split(/\r?\n/).filter(line => line === pattern).length, 1);
  install(root); assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), installed);
  applyInstallPlan(createCleanPlan(root));
  assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), installed);
});

test('dangling state ignore symlink fails preflight without creating its external target', t => {
  const root = fixture(t), outside = fixture(t), missing = path.join(outside, 'future-ignore');
  fs.mkdirSync(path.join(root, '.wl-skills/state'), { recursive: true });
  fs.symlinkSync(missing, path.join(root, '.wl-skills/state/.gitignore'));
  const plan = createInstallPlan(root, { filesDir });
  assert.ok(plan.conflicts.some(item => item.path === '.wl-skills/state/.gitignore'));
  assert.throws(() => applyInstallPlan(plan), /冲突/);
  assert.ok(!fs.existsSync(missing));
  assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
});
