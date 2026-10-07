import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstallPlan, createCleanPlan, applyInstallPlan } from '../lib/cli/install-state.js';
import jsonc from '../lib/shared-jsonc.cjs';
const filesDir = fileURLToPath(new URL('../files', import.meta.url));
const begin = '<!-- wl-skills-test:begin -->';
function tmp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-install-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function write(root, rel, content) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); }
function read(root, rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function install(root, options = {}) { const plan = createInstallPlan(root, { filesDir, ...options }); assert.deepEqual(plan.conflicts, []); applyInstallPlan(plan); return plan; }

test('install / clean preserve user Markdown, editor directories, and foreign JSONC server bytes', (t) => {
  const root = tmp(t);
  const agents = '# 项目规则\r\n\r\n<!-- wl-skills-design:begin -->\r\nDESIGN\r\n<!-- wl-skills-design:end -->\r\n';
  const mcp = '{\r\n  // USER COMMENT\r\n  "mcpServers": {\r\n    "foreign": { "command": "custom", "args": ["--x"], },\r\n  },\r\n  "userConfig": true,\r\n}\r\n';
  write(root, 'AGENTS.md', agents); write(root, '.mcp.json', mcp);
  write(root, '.cursor/rules/user.mdc', 'USER CURSOR');
  write(root, '.github/skills/user/SKILL.md', 'USER SKILL');
  install(root);
  assert.ok(read(root, 'AGENTS.md').startsWith(agents));
  assert.ok(read(root, '.mcp.json').includes('"foreign": { "command": "custom", "args": ["--x"], }'));
  assert.equal(jsonc.parseJsonc(read(root, '.mcp.json')).userConfig, true);
  assert.ok(fs.existsSync(path.join(root, '.cursor/rules/wl-skills-test.mdc')));
  applyInstallPlan(createCleanPlan(root));
  assert.equal(read(root, 'AGENTS.md'), agents);
  assert.equal(read(root, '.cursor/rules/user.mdc'), 'USER CURSOR');
  assert.equal(read(root, '.github/skills/user/SKILL.md'), 'USER SKILL');
  assert.ok(!jsonc.parseJsonc(read(root, '.mcp.json')).mcpServers['wl-skills-test']);
  assert.ok(read(root, '.mcp.json').includes('// USER COMMENT'));
});

test('same-content preexisting payload is never claimed or removed', (t) => {
  const root = tmp(t); const rel = '.github/skills/plan/test-plan-generator/SKILL.md';
  const content = fs.readFileSync(path.join(filesDir, rel), 'utf8'); write(root, rel, content);
  install(root);
  const state = JSON.parse(read(root, '.wl-skills-test/manifest.json'));
  assert.ok(!state.files.some((file) => file.path === rel));
  applyInstallPlan(createCleanPlan(root)); assert.equal(read(root, rel), content);
});

test('unknown private path or same MCP key blocks every write, even with force', (t) => {
  const root = tmp(t); write(root, '.mcp.json', '{"mcpServers":{"wl-skills-test":{"command":"user"}}}');
  write(root, '.github/skills/plan/test-plan-generator/SKILL.md', 'USER');
  const before = read(root, '.mcp.json');
  const plan = createInstallPlan(root, { filesDir, force: true });
  assert.ok(plan.conflicts.some((file) => file.path === '.mcp.json'));
  assert.throws(() => applyInstallPlan(plan), /冲突/);
  assert.equal(read(root, '.mcp.json'), before);
  assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')));
});

test('malformed JSON and directory-shaped targets fail preflight before writes', (t) => {
  const root = tmp(t); write(root, '.mcp.json', '{ broken'); fs.mkdirSync(path.join(root, 'AGENTS.md'));
  const plan = createInstallPlan(root, { filesDir });
  assert.ok(plan.conflicts.some((file) => file.path === '.mcp.json'));
  assert.ok(plan.conflicts.some((file) => file.path === 'AGENTS.md'));
  assert.throws(() => applyInstallPlan(plan), /冲突/);
  assert.ok(!fs.existsSync(path.join(root, '.github')));
});

test('update uses the actual previous baseline; user changes stay conflicted without Set.some crash', (t) => {
  const root = tmp(t); const payload = tmp(t);
  write(payload, 'AGENTS.md', '# Test __WL_SKILLS_TEST_VERSION__\nOld rule\n');
  write(payload, 'owned.txt', 'old payload');
  const p1 = createInstallPlan(root, { filesDir: payload, version: '0.1.0' }); applyInstallPlan(p1);
  write(payload, 'AGENTS.md', '# Test __WL_SKILLS_TEST_VERSION__\nNew rule\n'); write(payload, 'owned.txt', 'new payload');
  const p2 = createInstallPlan(root, { filesDir: payload, version: '0.2.0' }); assert.deepEqual(p2.conflicts, []); applyInstallPlan(p2);
  assert.ok(read(root, 'AGENTS.md').includes('New rule')); assert.equal(read(root, 'owned.txt'), 'new payload');
  write(root, 'AGENTS.md', read(root, 'AGENTS.md').replace('New rule', 'USER RULE'));
  const p3 = createInstallPlan(root, { filesDir: payload }); assert.ok(p3.conflicts.some((item) => item.path === 'AGENTS.md'));
  applyInstallPlan(createCleanPlan(root)); assert.ok(read(root, 'AGENTS.md').includes('USER RULE'));
});

test('force changes only own recorded Markdown block; clean preserves changed unit', (t) => {
  const root = tmp(t); install(root);
  write(root, 'AGENTS.md', 'USER PREFIX\n' + read(root, 'AGENTS.md').replace('# wl-skills-test 任务入口', '# LOCAL CHANGE') + '\n<!-- wl-skills-bd:begin -->\nBD\n<!-- wl-skills-bd:end -->');
  const clean = createCleanPlan(root); assert.ok(clean.conflicts.some((item) => item.path === 'AGENTS.md'));
  const plan = createInstallPlan(root, { filesDir, force: true }); assert.deepEqual(plan.conflicts, []); applyInstallPlan(plan);
  assert.ok(read(root, 'AGENTS.md').startsWith('USER PREFIX\n'));
  assert.ok(read(root, 'AGENTS.md').includes('<!-- wl-skills-bd:begin -->\nBD'));
});

test('legacy file editor rules migrate without losing customized original rules', (t) => {
  const root = tmp(t); const old = '@agile-team/wl-skills-test\n\nUSER LEGACY RULE\n';
  write(root, '.cursor', old); install(root);
  assert.equal(read(root, '.cursor/rules/wl-skills-test.legacy.mdc'), old);
  assert.ok(read(root, '.cursor/rules/wl-skills-test.mdc').includes('alwaysApply: true'));
  applyInstallPlan(createCleanPlan(root)); assert.equal(read(root, '.cursor/rules/wl-skills-test.legacy.mdc'), old);
});

test('foreign file editor rules are retained and reported, never converted automatically', (t) => {
  const root = tmp(t); write(root, '.kiro', 'USER ONLY');
  const plan = createInstallPlan(root, { filesDir, force: true }); assert.ok(plan.conflicts.length);
  assert.throws(() => applyInstallPlan(plan)); assert.equal(read(root, '.kiro'), 'USER ONLY');
  assert.ok(!fs.existsSync(path.join(root, '.github')));
});

test('write failure restores foreign contents and the original legacy editor file', (t) => {
  const root = tmp(t); const old = '@agile-team/wl-skills-test\nOLD EDITOR\n';
  write(root, '.cursor', old); write(root, 'AGENTS.md', 'USER ORIGINAL');
  const plan = createInstallPlan(root, { filesDir }); assert.deepEqual(plan.conflicts, []);
  let writes = 0;
  assert.throws(() => applyInstallPlan(plan, { writeFile(file, content, encoding) {
    if (++writes === 8) throw new Error('injected write failure'); fs.writeFileSync(file, content, encoding);
  } }), /已回滚/);
  assert.equal(read(root, '.cursor'), old); assert.equal(read(root, 'AGENTS.md'), 'USER ORIGINAL');
  assert.ok(!fs.existsSync(path.join(root, '.wl-skills-test/manifest.json')));
});

test('namespaced route evaluations and shared indices survive other package contributions', (t) => {
  const root = tmp(t); write(root, '.github/skills/_route-evals.json', '{"cases":["DESIGN"]}');
  write(root, '.github/skills/_registry.md', '<!-- wl-skills-design:begin -->\nDESIGN\n<!-- wl-skills-design:end -->\n');
  install(root);
  assert.ok(fs.existsSync(path.join(root, '.github/skills/_route-evals.test.json')));
  assert.ok(read(root, '.github/skills/_registry.md').includes(begin));
  applyInstallPlan(createCleanPlan(root));
  assert.equal(read(root, '.github/skills/_route-evals.json'), '{"cases":["DESIGN"]}');
  assert.ok(read(root, '.github/skills/_registry.md').includes('DESIGN'));
});

test('comments added inside owned MCP entry preserve that entry and its ownership metadata', (t) => {
  const root = tmp(t); install(root);
  const edited = read(root, '.mcp.json').replace('"command":', '/* USER NODE COMMENT */"command":');
  write(root, '.mcp.json', edited);
  const update = createInstallPlan(root, { filesDir });
  assert.ok(update.conflicts.some((item) => item.path === '.mcp.json'));
  const clean = createCleanPlan(root); assert.ok(clean.conflicts.some((item) => item.path === '.mcp.json'));
  applyInstallPlan(clean); assert.equal(read(root, '.mcp.json'), edited);
  assert.ok(JSON.parse(read(root, '.wl-skills-test/manifest.json')).files.some((item) => item.path === '.mcp.json'));
});

test('legacy semantic-only MCP ownership never adopts and deletes node comments', (t) => {
  const root = tmp(t); install(root);
  const manifest = JSON.parse(read(root, '.wl-skills-test/manifest.json'));
  delete manifest.files.find((item) => item.path === '.mcp.json').installedTextHash;
  write(root, '.wl-skills-test/manifest.json', JSON.stringify(manifest));
  const edited = read(root, '.mcp.json').replace('"command":', '/* LEGACY USER COMMENT */"command":');
  write(root, '.mcp.json', edited);
  assert.ok(createInstallPlan(root, { filesDir }).conflicts.some((item) => item.path === '.mcp.json'));
  applyInstallPlan(createCleanPlan(root)); assert.equal(read(root, '.mcp.json'), edited);
});
