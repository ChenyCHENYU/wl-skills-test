import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandInventory } from '../lib/cli/catalog.js';
const cli = fileURLToPath(new URL('../bin/wl-skills-test.js', import.meta.url));
function tree(root) {
  const rows = [];
  function visit(relative) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { rows.push([relative, 'symlink', fs.readlinkSync(file)]); return; }
    if (stat.isDirectory()) {
      rows.push([relative, 'directory']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    } else rows.push([relative, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  }
  visit('.');
  return JSON.stringify(rows);
}
for (const installed of [false, true]) test(`every command's --help/-h is zero-write before dispatch (${installed ? 'installed' : 'uninstalled'})`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-help-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(root, 'user-content.txt'), 'Must remain byte-for-byte unchanged.\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
  if (installed) {
    const initialized = run(['init']);
    assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  }
  const before = tree(root);
  const commands = [...commandInventory().map(entry => [entry.name]), ['sit', 'generate'], ['protocol', 'request'], ['--mcp']];
  for (const args of commands) for (const flag of ['--help', '-h', '--help=true']) {
    const result = run([...args, flag, '--force', '--confirm']);
    assert.equal(result.status, 0, `${args.join(' ')} ${flag}: ${result.stderr || result.stdout}`);
    assert.match(result.stdout, /用法:/u);
    assert.equal(tree(root), before, `${args.join(' ')} ${flag} must not call its handler or alter files`);
  }
  for (const command of ['init', 'update', 'clean']) for (const flag of ['--version', '-v']) {
    const result = run([command, flag]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /@agile-team\/wl-skills-test v\d+\.\d+\.\d+/u);
    assert.equal(tree(root), before);
  }
});
