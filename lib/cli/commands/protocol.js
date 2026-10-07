/**
 * cli/commands/protocol.js — 公开集成协议接线（薄层）
 *
 * 协议实现来自快照 lib/integration-protocol.cjs（单源 conformance/support，勿改）；
 * 本文件只提供 test 包的能力目录、操作映射，并复用 tasks.js 的原执行器。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = require('../../../package.json');
const capabilitiesDocument = require('../../../lib/capabilities.json');
const { createProtocol } = require('../../integration-protocol.cjs');
const { planTask, taskStatus, hostDiagnostic } = require('./tasks.js');

const BIN = 'wl-skills-test';
const OPERATIONS = [
  { id: 'route', summary: '只读任务判定：测试域技能、约束、歧义与缺口（不记录）', readOnly: true, required: ['task'], optional: ['targets', 'skill', 'projectRoot'], mapping: `${BIN} route --task "<task>"` },
  { id: 'explain', summary: '解释本次任务判定（只读，不记录）', readOnly: true, required: ['task'], optional: ['targets', 'projectRoot'], mapping: `${BIN} explain --task "<task>"` },
  { id: 'task', summary: '判定并持久化任务计划（仅规划，不执行）', readOnly: false, required: ['task'], optional: ['runId', 'targets', 'skill', 'projectRoot'], mapping: `${BIN} task --task "<task>" [--run-id <id>]` },
  { id: 'status', summary: '读取本包执行回执、验证状态与缺口建议', readOnly: true, required: [], optional: ['runId', 'projectRoot'], mapping: `${BIN} status [--run-id <id>]` },
  { id: 'doctor-host', summary: '宿主入口静态诊断（不声称已加载或已连接）', readOnly: true, required: [], optional: ['host', 'projectRoot'], mapping: `${BIN} doctor-host [--host <host>]` },
];

export const protocol = createProtocol({
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
});

export function runOperation(operation, input) {
  const root = input.projectRoot || process.cwd();
  const normalized = { task: input.task, root, skill: input.skill, runId: input.runId, context: { files: Array.isArray(input.targets) ? input.targets : [] } };
  if (operation === 'status') return taskStatus({ root, runId: input.runId });
  if (operation === 'doctor-host') return hostDiagnostic({ root, host: input.host });
  return planTask(normalized, operation === 'task');
}

export function cmdProtocol(parsed) {
  const sub = (parsed.positional || [])[0];
  const opts = parsed.opts || {};
  if (sub === 'describe') {
    console.log(JSON.stringify(protocol.describe(), null, 2));
    return 0;
  }
  if (sub === 'request') {
    const file = opts['input-file'];
    if (!file) {
      console.error('protocol request 需要 --input-file <request.json>');
      process.exitCode = 2;
      return 2;
    }
    let input;
    try {
      input = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    } catch (error) {
      console.log(JSON.stringify({ protocolVersion: 1, package: pkg.name, packageVersion: pkg.version, operation: null, requestId: null, ok: false, error: { code: 'invalid-input', message: `请求文件无法解析：${error.message}` }, diagnostics: [] }, null, 2));
      process.exitCode = 2;
      return 2;
    }
    const envelope = protocol.request(input, runOperation);
    console.log(JSON.stringify(envelope, null, 2));
    process.exitCode = envelope.ok ? 0 : 2;
    return process.exitCode;
  }
  console.error('用法：');
  console.error(`  ${BIN} protocol describe --json`);
  console.error(`  ${BIN} protocol request --input-file <request.json> --json`);
  process.exitCode = 2;
  return 2;
}
