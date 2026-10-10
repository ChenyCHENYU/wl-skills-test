/**
 * protocol-cli.test.js — 公开集成协议统一信封与接线测试
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { protocol, runOperation } = require('../lib/cli/commands/protocol.js');
const pkg = require('../package.json');
const BIN = path.join(here, '..', 'bin', 'wl-skills-test.js');

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'wl-test-protocol-'));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "@agile-team/wl-skills-test": "*" } }));
  return root;
}

test('describe 返回协议版本、能力目录与五个统一操作', () => {
  const described = protocol.describe();
  assert.equal(described.protocolVersion, 1);
  assert.equal(described.package, pkg.name);
  assert.ok(Array.isArray(described.capabilities) && described.capabilities.length > 0);
  assert.deepEqual(described.operations.map((operation) => operation.id), ['route', 'explain', 'task', 'status', 'doctor-host']);
  assert.ok(described.errorCodes.includes('internal-error'));
});

test('route 只读判定返回六类状态之一且不落 run 记录', () => {
  const envelope = protocol.request({ operation: 'route', projectRoot: tempRoot(), task: '为订单模块生成接口测试用例' }, runOperation);
  assert.equal(envelope.ok, true);
  assert.ok(['matched', 'baseline', 'ambiguous', 'gap', 'not-applicable', 'needs-context'].includes(envelope.result.status));
  assert.equal(envelope.result.runId, undefined);
});

test('task 持久化返回 runId 且 status 可回查', () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: 'task', projectRoot: root, task: '生成冒烟测试方案' }, runOperation);
  assert.equal(planned.ok, true);
  assert.ok(planned.result.runId);
  const status = protocol.request({ operation: 'status', projectRoot: root, runId: planned.result.runId }, runOperation);
  assert.equal(status.ok, true);
  assert.equal(status.result.runId, planned.result.runId);
  assert.equal(status.result.executionStatus, 'not-executed');
});

test('doctor-host 按指定 host 诊断', () => {
  const envelope = protocol.request({ operation: 'doctor-host', projectRoot: tempRoot(), host: 'claude' }, runOperation);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.result.host, 'claude');
});

test('协议错误码：missing-input / unknown-operation / invalid-input / unsupported-protocol', () => {
  assert.equal(protocol.request({ operation: 'route' }, runOperation).error.code, 'missing-input');
  assert.equal(protocol.request({ operation: 'run' }, runOperation).error.code, 'unknown-operation');
  assert.equal(protocol.request('route', runOperation).error.code, 'invalid-input');
  assert.equal(protocol.request({ protocolVersion: 7, operation: 'route', task: 'x' }, runOperation).error.code, 'unsupported-protocol');
});

test('边界输入校验：非法类型在触达执行器前判 invalid-input（独立复验缺陷回归）', () => {
  const invalidPayloads = [
    { operation: 'task', task: true },
    { operation: 'task', task: { text: 'bad' } },
    { operation: 'task', task: '检查目标', targets: [null, 42, {}] },
    { operation: 'route', task: '检查目标', projectRoot: 42 },
    { operation: 'task', task: '检查目标', runId: {} },
  ];
  for (const payload of invalidPayloads) {
    const envelope = protocol.request(payload, () => { throw new Error('不应触达执行器'); });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'invalid-input');
    assert.ok(envelope.error.field);
  }
});

test('domain 上下文透传保持与原入口判定一致（输入对齐回归）', () => {
  const root = tempRoot();
  const envelope = protocol.request({ operation: 'route', projectRoot: root, task: '检查', domain: 'documentation' }, runOperation);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.result.status, 'not-applicable');
});

test('CLI 缺 --input-file 时 stdout 输出 missing-input JSON 信封', () => {
  const run = spawnSync(process.execPath, [BIN, 'protocol', 'request'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'missing-input');
  assert.equal(envelope.error.field, 'input-file');
});

test('旧 CLI 入口在未启用 require(esm) 的 Node 上保持可用（模块加载回归）', () => {
  const run = spawnSync(process.execPath, ['--no-experimental-require-module', BIN, '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('CLI protocol describe / request 全链路', () => {
  const describe = spawnSync(process.execPath, [BIN, 'protocol', 'describe'], { encoding: 'utf8' });
  assert.equal(describe.status, 0);
  assert.equal(JSON.parse(describe.stdout).package, '@agile-team/wl-skills-test');
  const root = tempRoot();
  const file = path.join(root, 'req.json');
  const { writeFileSync } = require('node:fs');
  writeFileSync(file, JSON.stringify({ operation: 'route', projectRoot: root, task: '分析性能测试瓶颈' }));
  const request = spawnSync(process.execPath, [BIN, 'protocol', 'request', '--input-file', file], { encoding: 'utf8' });
  assert.equal(request.status, 0);
  assert.equal(JSON.parse(request.stdout).ok, true);
});


test('context null 判 invalid-input 且零写入（CLI 回归）', () => {
  const root = tempRoot();
  const file = path.join(root, 'req.json');
  const { writeFileSync, readdirSync } = require('node:fs');
  writeFileSync(file, JSON.stringify({ operation: 'task', projectRoot: root, task: '生成测试方案', runId: 'ctx-null', context: null }));
  const run = spawnSync(process.execPath, [BIN, 'protocol', 'request', '--input-file', file], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'invalid-input');
  assert.equal(envelope.error.field, 'context');
  assert.equal(readdirSync(root).filter((name) => name.startsWith('.')).length, 0, '不得写入任何任务记录');
});

test('targets 空数组与 Schema 一致（运行时接受空范围）', () => {
  const root = tempRoot();
  const envelope = protocol.request({ operation: 'route', projectRoot: root, task: '生成测试方案', targets: [] }, runOperation);
  assert.equal(envelope.ok, true);
  const described = protocol.describe();
  assert.equal(described.schemas.request.properties.targets.minItems, undefined, 'Schema 不得要求非空 targets');
});
