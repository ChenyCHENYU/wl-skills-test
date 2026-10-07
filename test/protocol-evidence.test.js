/**
 * protocol-evidence.test.js — 证据闭环严格断言（不得兜底通过）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { protocol, runOperation } = require('../lib/cli/commands/protocol.js');

function tempRoot() {
  return mkdtempSync(path.join(tmpdir(), 'wl-test-evidence-'));
}

test('status 严格回查同一 runId：字段精确、不兜底', () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: 'task', projectRoot: root, task: '生成测试方案', runId: 'evidence-run-a' }, runOperation);
  assert.equal(planned.ok, true);
  assert.equal(planned.result.runId, 'evidence-run-a');
  assert.equal(planned.result.executionStatus, 'not-executed');
  const status = protocol.request({ operation: 'status', projectRoot: root, runId: 'evidence-run-a' }, runOperation);
  assert.equal(status.result.runId, 'evidence-run-a');
  assert.equal(status.result.executionStatus, 'not-executed');
});

test('混用 runId 不得串记录', () => {
  const root = tempRoot();
  protocol.request({ operation: 'task', projectRoot: root, task: '任务A生成测试方案', runId: 'evidence-run-a' }, runOperation);
  protocol.request({ operation: 'task', projectRoot: root, task: '任务B生成测试方案', runId: 'evidence-run-b' }, runOperation);
  const statusB = protocol.request({ operation: 'status', projectRoot: root, runId: 'evidence-run-b' }, runOperation);
  assert.equal(statusB.result.runId, 'evidence-run-b');
  assert.equal(JSON.stringify(statusB.result).includes('任务A'), false);
});

test('不存在的 runId 不得伪造成功记录', () => {
  const root = tempRoot();
  const status = protocol.request({ operation: 'status', projectRoot: root, runId: 'no-such-run' }, runOperation);
  const serialized = JSON.stringify(status.result);
  assert.equal(serialized.includes('"validationStatus":"passed"'), false);
  assert.equal(serialized.includes('"executionStatus":"completed"'), false);
});

test('空检查集不得判定为通过', () => {
  const root = tempRoot();
  const planned = protocol.request({ operation: 'task', projectRoot: root, task: '生成测试方案', runId: 'empty-run' }, runOperation);
  assert.notEqual(planned.result.validationStatus, 'passed');
  assert.equal(planned.result.executionStatus, 'not-executed');
});
