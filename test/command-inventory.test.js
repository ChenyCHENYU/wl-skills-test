import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMANDS, COMMAND_CATALOG } from '../lib/cli/catalog.js';
import { TOOL_DESCRIPTORS } from '../mcp/registry.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageRoot, 'bin/wl-skills-test.js');
function cli(args, cwd = packageRoot) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', timeout: 20_000 });
}
function described() {
  const result = cli(['protocol', 'describe', '--json']);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('Protocol MCP schemas and conditional side effects match the real registration source', () => {
  const inventory = described().inventory.mcpTools;
  assert.deepEqual(inventory.map((t) => t.name), TOOL_DESCRIPTORS.map((t) => t.name));
  for (const tool of TOOL_DESCRIPTORS) {
    const row = inventory.find((t) => t.name === tool.name);
    assert.deepEqual(row.inputSchema, tool.inputSchema); assert.deepEqual(row.annotations, tool.annotations);
    assert.equal(typeof row.sideEffects, 'string'); assert.ok(row.sideEffects.length);
  }
  assert.equal(inventory.find((t) => t.name === 'wls_test_audit').annotations.readOnlyHint, false);
  assert.match(inventory.find((t) => t.name === 'wls_test_task').sideEffects, /写本包计划/);
  assert.equal(inventory.find((t) => t.name === 'wls_test_standards').annotations.readOnlyHint, true);
});

test('公开命令目录与真实 CLI help 全量同源，不漏列命令或扩张自动执行权限', () => {
  const result = cli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  const commandSection = result.stdout.split('命令:')[1].split('选项:')[0];
  const actual = [...commandSection.matchAll(/^  ([a-z][a-z0-9-]*)\s+(.+)$/gm)].map((match) => ({ name: match[1], summary: match[2].trim() }));
  const description = described();
  assert.deepEqual(description.inventory.commands.map(({ name, summary }) => ({ name, summary })), actual);
  assert.deepEqual(actual.map(({ name }) => name), Object.keys(COMMANDS));
  assert.ok(actual.length > 13, '旧硬编码目录漏掉实际命令');
  assert.equal(new Set(actual.map(({ name }) => name)).size, actual.length);
  for (const command of description.inventory.commands) {
    assert.equal(typeof command.args, 'string');
    assert.equal(typeof command.sideEffects, 'string');
    assert.ok(command.sideEffects.length > 0);
    assert.equal(typeof command.readOnly, 'boolean');
    assert.equal(command.execution, 'programmatic');
  }
  assert.deepEqual(description.inventory.executors.map(({ id }) => id), JSON.parse(fs.readFileSync(path.join(packageRoot, 'lib/executors.json'), 'utf8')).map(({ id }) => id));
});

test('真实用法拒绝旧目录虚构参数，生成类型和目标参数与公开目录一致', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-command-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = fs.readdirSync(root);
  const api = cli(['run-api', '--suite', 'missing.json'], root);
  assert.equal(api.status, 2);
  assert.match(api.stdout, /run-api --contract/);
  assert.deepEqual(fs.readdirSync(root), before, '用法错误不请求环境或生成文件');
  const generation = cli(['run-gen'], root);
  assert.equal(generation.status, 2);
  assert.match(generation.stdout, /cases\|playwright\|jmeter\|e2e/);
  const commands = new Map(described().inventory.commands.map((command) => [command.name, command]));
  assert.match(commands.get('run-api').args, /--contract/);
  assert.doesNotMatch(commands.get('run-api').args, /--suite/);
  assert.match(commands.get('fix').args, /--target/);
  assert.doesNotMatch(commands.get('fix').args, /--contract/);
  assert.doesNotMatch(commands.get('audit').args, /--changed/);
  assert.match(commands.get('run-gen').args, /cases\|playwright\|jmeter\|e2e/);
});

test('审计原命令确实写报告，目录不再声明 audit/gate 无副作用', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-command-effects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@agile-team/wl-skills-test': '*' } }));
  fs.writeFileSync(path.join(root, 'sample.js'), '// no executable test cases\nexport const value = 1;\n');
  const sourceBefore = fs.readFileSync(path.join(root, 'sample.js'));
  const result = cli(['audit', '--target', 'sample.js', '--reports-dir', 'reports'], root);
  assert.equal(result.status, 1, result.stderr);
  assert.ok(fs.existsSync(path.join(root, 'reports/audit-result.json')));
  assert.ok(fs.existsSync(path.join(root, 'reports/audit-报告.md')));
  assert.ok(fs.existsSync(path.join(root, 'reports/history.jsonl')));
  assert.deepEqual(fs.readFileSync(path.join(root, 'sample.js')), sourceBefore);
  const commands = new Map(described().inventory.commands.map((command) => [command.name, command]));
  assert.equal(commands.get('audit').readOnly, false);
  assert.match(commands.get('audit').sideEffects, /报告.*历史/);
  assert.equal(commands.get('gate').readOnly, false);
  assert.match(commands.get('gate').sideEffects, /执行回执.*报告历史/);
  assert.match(commands.get('run-api').sideEffects, /真实 HTTP.*写操作/);
});

test('SIT 命令区分只读判定和生成，不把 UAT 签字或生成当执行成功', () => {
  const sit = described().inventory.commands.find(({ name }) => name === 'sit');
  assert.ok(sit);
  assert.match(sit.args, /templates.*generate.*verify/);
  assert.match(sit.sideEffects, /无run-id的verify只读/);
  assert.match(sit.sideEffects, /verify指定run-id时写本包关联回执/);
  assert.match(sit.sideEffects, /新目录原子写入/);
  assert.match(sit.sideEffects, /不执行测试或伪造签字/);
  assert.deepEqual(sit, { name: 'sit', ...COMMAND_CATALOG.sit, execution: 'programmatic' });
});
