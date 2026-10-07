/**
 * cli/commands/protocol.js — 公开集成协议接线（薄层）
 *
 * 协议实现来自快照 lib/integration-protocol.cjs（单源 conformance/support，勿改）；
 * 本文件只提供 test 包的能力目录、操作映射，并复用 tasks.js 的原执行器。
 * 注意：本包是 ESM，tasks.js 也是 ESM，必须使用静态 import（不得经 createRequire require），
 * 否则在未启用 require(esm) 的 Node 上会破坏整个旧 CLI 入口。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { planTask, taskStatus, hostDiagnostic } from './tasks.js';
import { readRoutes } from '../../task-routing.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json');
const capabilitiesDocument = require('../../../lib/capabilities.json');
const { createProtocol } = require('../../integration-protocol.cjs');

const BIN = 'wl-skills-test';
const OPERATIONS = [
  { id: 'route', summary: '只读任务判定：测试域技能、约束、歧义与缺口（不记录）', readOnly: true, required: ['task'], optional: ['targets', 'skill', 'domain', 'projectRoot'], sideEffects: '无写入', mapping: `${BIN} route --task "<task>" [--domain <domain>]` },
  { id: 'explain', summary: '解释本次任务判定（只读，不记录）', readOnly: true, required: ['task'], optional: ['targets', 'domain', 'projectRoot'], sideEffects: '无写入', mapping: `${BIN} explain --task "<task>"` },
  { id: 'task', summary: '判定并持久化任务计划（仅规划，不执行）', readOnly: false, required: ['task'], optional: ['runId', 'targets', 'skill', 'domain', 'projectRoot'], sideEffects: '写入 .wl-skills-test/runs/ 下本包任务记录', mapping: `${BIN} task --task "<task>" [--run-id <id>] [--domain <domain>]` },
  { id: 'status', summary: '读取本包执行回执、验证状态与缺口建议', readOnly: true, required: [], optional: ['runId', 'projectRoot'], sideEffects: '无写入', mapping: `${BIN} status [--run-id <id>]` },
  { id: 'doctor-host', summary: '宿主入口静态诊断（不声称已加载或已连接）', readOnly: true, required: [], optional: ['host', 'projectRoot'], sideEffects: '无写入', mapping: `${BIN} doctor-host [--host <host>]` },
];

function buildInventory() {
  let skills = [];
  let mcpTools = [];
  try {
    skills = readRoutes().skills.map((skill) => ({ id: skill.id || skill.name, description: skill.description || skill.summary || '', triggers: skill.triggers || skill.phrases || [], entry: skill.path, execution: 'instructional' }));
  } catch { skills = []; }
  try {
    const registry = require('../../../mcp/registry.js');
    mcpTools = (registry.TOOL_DESCRIPTORS || []).map((tool) => ({ name: tool.name, summary: tool.description, write: (tool.annotations && tool.annotations.readOnlyHint === true) ? 'readonly' : 'guarded' }));
  } catch { mcpTools = []; }
  const commands = [
    { name: 'init/update', summary: '安装/增量更新（11 规范 + 13 Skill + 模板 + 编辑器配置）', execution: 'programmatic' },
    { name: 'audit/fix', summary: '测试代码审计（T1-T25）与反模式修复（F1-F6）', execution: 'programmatic' },
    { name: 'gen-contract/run-gen', summary: '契约生成与用例/脚本生成', execution: 'programmatic' },
    { name: 'run-api/run-playwright/run-jmeter', summary: '执行接口/E2E/性能测试', execution: 'programmatic' },
    { name: 'gate/report/ci', summary: '质量门聚合、报告与 CI 模板', execution: 'programmatic' },
    { name: 'task/route/explain/status/doctor-host', summary: '任务判定与回执（本协议五操作的原入口）', execution: 'programmatic' },
    { name: 'protocol', summary: '本公开集成协议', execution: 'programmatic' },
  ];
  return { skills, commands, mcpTools };
}

export const protocol = createProtocol({
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
  inventory: buildInventory(),
});

export function runOperation(operation, input) {
  const root = input.projectRoot || process.cwd();
  const normalized = {
    task: input.task,
    root,
    skill: input.skill,
    runId: input.runId,
    context: { files: Array.isArray(input.targets) ? input.targets : [], domain: input.domain },
  };
  if (operation === 'status') return taskStatus({ root, runId: input.runId });
  if (operation === 'doctor-host') return hostDiagnostic({ root, host: input.host });
  return planTask(normalized, operation === 'task');
}

function envelopeError(code, message, field) {
  return { protocolVersion: 1, package: pkg.name, packageVersion: pkg.version, operation: null, requestId: null, ok: false, error: { code, message, ...(field ? { field } : {}) }, diagnostics: [] };
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
      console.log(JSON.stringify(envelopeError('missing-input', '缺少必要输入：--input-file <request.json>', 'input-file'), null, 2));
      process.exitCode = 2;
      return 2;
    }
    let input;
    try {
      input = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
    } catch (error) {
      const message = error.code === 'ENOENT' ? `请求文件不存在：${file}` : `请求文件无法解析：${error.message}`;
      console.log(JSON.stringify(envelopeError('invalid-input', message, 'input-file'), null, 2));
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
