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
import { TOOL_DESCRIPTORS as TEST_TOOL_DESCRIPTORS } from '../../../mcp/registry.js';

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
  const loadErrors = [];
  let skills = [];
  try {
    skills = readRoutes().skills.map((skill) => ({ id: skill.id || skill.name, description: skill.description || skill.summary || '', triggers: skill.triggers || skill.phrases || [], entry: skill.path, execution: 'instructional' }));
  } catch (error) {
    loadErrors.push(`skills 加载失败：${error.message}`);
  }
  let mcpTools = [];
  try {
    mcpTools = TEST_TOOL_DESCRIPTORS.map((tool) => ({ name: tool.name, summary: tool.description, write: (tool.annotations && tool.annotations.readOnlyHint === true) ? 'readonly' : 'guarded' }));
  } catch (error) {
    loadErrors.push(`mcpTools 加载失败：${error.message}`);
  }
  const commands = [
    { name: 'init', args: '', summary: '安装（11 规范 + 13 Skill + 模板 + 编辑器配置）', execution: 'programmatic', sideEffects: '写入受管文件' },
    { name: 'update', args: '', summary: '增量更新', execution: 'programmatic', sideEffects: '仅更新未修改受管文件' },
    { name: 'audit', args: '[--changed]', summary: '测试代码审计（T1-T25）', execution: 'programmatic', sideEffects: '无（报告输出）' },
    { name: 'fix', args: '--contract <file> [--dry-run]', summary: '反模式修复（F1-F6）', execution: 'programmatic', sideEffects: '写源文件（dry-run 预览）' },
    { name: 'run-gen', args: '--contract <file> [--type api|playwright|jmeter]', summary: '执行脚本生成', execution: 'programmatic', sideEffects: '写脚本文件' },
    { name: 'run-api', args: '--suite <path>', summary: '执行接口测试并记录回执', execution: 'programmatic', sideEffects: '写 .wl-skills-test/runs/' },
    { name: 'gate', args: '', summary: '质量门聚合', execution: 'programmatic', sideEffects: '无' },
    { name: 'task', args: '--task <任务> [--run-id <id>] [--domain <domain>]', summary: '判定并持久化任务计划', execution: 'programmatic', sideEffects: '写 .wl-skills-test/runs/' },
    { name: 'route', args: '--task <任务> [--domain <domain>]', summary: '只读判定', execution: 'programmatic', sideEffects: '无' },
    { name: 'explain', args: '--task <任务>', summary: '只读判定解释', execution: 'programmatic', sideEffects: '无' },
    { name: 'status', args: '[--run-id <id>]', summary: '读取本包回执', execution: 'programmatic', sideEffects: '无' },
    { name: 'doctor-host', args: '[--host <name>]', summary: '宿主入口静态诊断', execution: 'programmatic', sideEffects: '无' },
    { name: 'protocol', args: 'describe | request --input-file <file>', summary: '本公开集成协议', execution: 'programmatic', sideEffects: '见操作声明' },
  ];
  return { skills, commands, mcpTools, loadErrors };
}

export const protocol = createProtocol({
  packageName: pkg.name,
  packageVersion: pkg.version,
  capabilities: capabilitiesDocument.capabilities || [],
  constraints: { node: (pkg.engines && pkg.engines.node) || null, boundaryVersion: capabilitiesDocument.boundaryVersion || null },
  operations: OPERATIONS,
  inventory: buildInventory(),
});

export function runOperation(operation, input, diagnostics) {
  const root = input.projectRoot || process.cwd();
  const normalized = {
    task: input.task,
    root,
    skill: input.skill,
    runId: input.runId,
    context: {
      files: [...(Array.isArray(input.targets) ? input.targets : []), ...((input.context && input.context.signals) || [])],
      domain: input.domain,
    },
  };
  if (input.context && diagnostics) diagnostics.push("context.signals 已并入判定上下文（domainRelevant 由 domain 字段表达）");
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
