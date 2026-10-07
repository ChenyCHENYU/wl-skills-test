import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readRoutes, ROUTES_PATH } from './task-routing.js';
import { PKG, PKG_ROOT } from './cli/context.js';
import jsonc from './shared-jsonc.cjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const statePath = '.wl-skills-test/manifest.json';
const gateway = '.agents/skills/wl-skills-test/SKILL.md';
const read = full => { try { return fs.readFileSync(full, 'utf8'); } catch { return null; } };
function inventory(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const relative = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? inventory(path.join(dir, e.name), relative) : [relative];
  });
}
export function inspectInstallation(root = process.cwd()) {
  root = path.resolve(root);
  const problems = [], checks = [];
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(root, statePath), 'utf8'));
    if (state.package !== PKG.name || state.schemaVersion !== 1 || !Array.isArray(state.files) || !state.files.length) throw new Error('manifest schema/package mismatch');
  } catch (error) { state = undefined; problems.push({ kind: 'manifest', path: statePath, reason: error.code === 'ENOENT' ? '本包未安装或归属清单缺失。' : `归属清单不可读：${error.message}` }); }
  for (const relative of inventory(path.join(PKG_ROOT, 'files'))) {
    const full = path.join(root, relative), stat = (() => { try { return fs.lstatSync(full); } catch { return null; } })();
    const present = stat?.isFile() && !stat.isSymbolicLink();
    checks.push({ path: relative, present: Boolean(present) });
    if (!present) problems.push({ kind: 'missing-file', path: relative, reason: '当前包必要安装文件缺失或不是普通文件。' });
  }
  for (const entry of state?.files || []) {
    if (typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes('..')) {
      problems.push({ kind: 'invalid-state-path', path: '(manifest)', reason: '归属清单包含非法路径。' }); continue;
    }
    const body = read(path.join(root, entry.path));
    if (body === null) continue;
    let same;
    try {
      if (entry.kind === 'markdown') {
        const block = body.match(/<!-- wl-skills-test:begin -->[\s\S]*?<!-- wl-skills-test:end -->/)?.[0];
        same = block === entry.content;
      } else if (entry.kind === 'mcp') {
        const node = jsonc.getJsoncNodeText(body, ['mcpServers', entry.key]);
        same = node !== undefined && (entry.installedTextHash ? digest(node) === entry.installedTextHash : JSON.stringify(jsonc.getJsoncValue(body, ['mcpServers', entry.key])) === entry.content);
      } else same = digest(body) === entry.hash;
    } catch { same = false; }
    if (!same) problems.push({ kind: 'locally-modified', path: entry.path, reason: '本包单元与上次安装基线不同，保留本地内容；检查其语义后再更新。' });
  }
  const skills = readRoutes().skills.map(s => ({ id: s.id, path: s.path, present: fs.existsSync(path.join(root, s.path)) }));
  const missingSkills = skills.filter(s => !s.present).map(s => s.id);
  return { package: PKG.name, packageVersion: PKG.version, root, installed: Boolean(state), installedVersion: state?.version || null,
    integrity: problems.length ? 'gap' : 'verified', filesChecked: checks.length, skills: { expected: skills.length, present: skills.length - missingSkills.length, missing: missingSkills },
    checks, problems, gateway, routeManifest: ROUTES_PATH, evidenceLevel: 'filesystem-and-installed-baseline', hostContextLoaded: 'unknown', compliance: 'unverified' };
}
export function inspectHost(root = process.cwd(), host = 'codex') {
  root = path.resolve(root);
  const definitions = {
    codex: { entry: 'AGENTS.md', gateway, config: '.codex/config.toml', explanation: 'Codex 原生技能位于 .agents/skills；AGENTS 发现取决于启动目录、祖先链、override 和大小设置。项目 .mcp.json 本身不证明 Codex 已连接。' },
    claude: { entry: 'CLAUDE.md', config: '.mcp.json', explanation: 'CLAUDE 入口及项目 MCP 是否加载还取决于宿主版本、工作目录、信任和设置；用 /context 或 InstructionsLoaded 观测。' },
    copilot: { entry: '.github/copilot-instructions.md', config: '.mcp.json', explanation: 'Copilot 入口是否应用需看宿主 References；MCP 支持取决于宿主版本、工作区信任与启用状态。' },
    cursor: { entry: '.cursor/rules/wl-skills-test.mdc', config: '.cursor/mcp.json', explanation: '测试规则按 description 相关性选择；文件存在不表示每次任务都已附加。' },
    kiro: { entry: '.kiro/steering/wl-skills-test.md', config: '.kiro/settings/mcp.json', explanation: '检查 steering 与 MCP 连接面板；文件存在不证明当前会话已加载。' },
  };
  const spec = definitions[host];
  if (!spec) throw new Error(`Unsupported host: ${host}. Use ${Object.keys(definitions).join(', ')}.`);
  const entryText = read(path.join(root, spec.entry));
  const bytes = entryText === null ? 0 : Buffer.byteLength(entryText);
  const warnings = [];
  if (entryText === null) warnings.push(`缺少宿主入口 ${spec.entry}`);
  if (host === 'codex' && bytes > 32768) warnings.push('AGENTS 大于 Codex 默认32 KiB项目指令合并上限；核对宿主实际上限和祖先文件，不能据此断言当前已截断。');
  if (host === 'cursor' && entryText && /alwaysApply:\s*false/.test(entryText)) warnings.push('规则为按相关性加载，不是每任务强制读取。');
  const gatewayPresent = spec.gateway ? fs.existsSync(path.join(root, spec.gateway)) : null;
  if (spec.gateway && !gatewayPresent) warnings.push(`缺少本包原生 gateway ${spec.gateway}`);
  const configPresent = fs.existsSync(path.join(root, spec.config));
  if (!configPresent) warnings.push(`未发现项目级 ${spec.config}；宿主可能使用其他作用域配置，此处未读取用户配置。`);
  return { package: PKG.name, host, root, entry: { path: spec.entry, present: entryText !== null, bytes }, gateway: { path: spec.gateway || null, present: gatewayPresent },
    config: { path: spec.config, present: configPresent, contentsInspected: false }, readiness: entryText && (!spec.gateway || gatewayPresent) ? 'discoverable-files-present' : 'gap',
    connection: 'unknown', hostContextLoaded: 'unknown', compliance: 'unverified', explanation: spec.explanation, warnings, evidenceLevel: 'static-host-paths' };
}
