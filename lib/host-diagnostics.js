import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readRoutes, ROUTES_PATH } from './task-routing.js';
import { PKG, PKG_ROOT } from './cli/context.js';
import jsonc from './shared-jsonc.cjs';
import hostProfiles from './host-profiles.cjs';
import integrationSupport from './project-integration.cjs';
import mcpConfig from './mcp-config.cjs';
import protocol from './task-observability.cjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const statePath = '.wl-skills/state/test/manifest.json';
const gateway = '.agents/skills/wl-skills-test/SKILL.md';
const read = full => { try { return fs.readFileSync(full, 'utf8'); } catch { return null; } };
export function inspectInstallation(root = process.cwd()) {
  root = path.resolve(root);
  const problems = [], checks = [];
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(root, fs.existsSync(path.join(root, statePath)) ? statePath : '.wl-skills-test/manifest.json'), 'utf8'));
    if (state.package !== PKG.name || state.schemaVersion !== 1 || !Array.isArray(state.files) || !state.files.length) throw new Error('manifest schema/package mismatch');
  } catch (error) { state = undefined; problems.push({ kind: 'manifest', path: statePath, reason: error.code === 'ENOENT' ? '本包未安装或归属清单缺失。' : `归属清单不可读：${error.message}` }); }
  const selection = integrationSupport.resolveIntegration({ projectRoot: root, recorded: state });
  const requiredFiles = state?.files?.map(item => item.path) || [...selection.entryFiles, ...hostProfiles.gatewayInstallPaths(PKG.name, selection)];
  for (const relative of requiredFiles) {
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
  if (state?.managedMcp?.records) {
    const mcp = mcpConfig.planMcpConfiguration({ projectRoot: root, packageName: PKG.name,
      hosts: selection.hosts, enabled: selection.mcp === true, previous: state.managedMcp.records });
    for (const file of mcp.files) if (file.action !== 'none') problems.push({ kind: 'mcp-drift', path: file.path, reason: file.reason || (file.before === null ? '本包原生MCP配置缺失。' : '本包原生MCP配置与安装记录不同。') });
  }
  const skills = readRoutes(root).skills.map(s => ({ id: s.id, path: integrationSupport.resolveResourcePath(root, s.path, PKG_ROOT), present: fs.existsSync(integrationSupport.resolveResourcePath(root, s.path, PKG_ROOT)) }));
  const missingSkills = skills.filter(s => !s.present).map(s => s.id);
  return { package: PKG.name, packageVersion: PKG.version, root, installed: Boolean(state), installedVersion: state?.version || null,
    integrity: problems.length ? 'gap' : 'verified', filesChecked: checks.length, skills: { expected: skills.length, present: skills.length - missingSkills.length, missing: missingSkills },
    checks, problems, gateway, routeManifest: ROUTES_PATH, evidenceLevel: 'filesystem-and-installed-baseline', hostContextLoaded: 'unknown', compliance: 'unverified' };
}
export function inspectHostReport(root = process.cwd(), host = 'unspecified') {
  const projectRoot = fs.realpathSync(path.resolve(root));
  const skillPaths = readRoutes().skills.map(skill => integrationSupport.resolveResourcePath(projectRoot, skill.path, PKG_ROOT));
  return protocol.doctorHost({ projectRoot, packageName: PKG.name, packageVersion: PKG.version, host, skillPaths, gatewayPath: gateway });
}

// Keep the legacy details shape as a view of the same static evidence.
export function inspectHost(root = process.cwd(), host = 'unspecified', report = inspectHostReport(root, host)) {
  const profile = report.hostProfile;
  const entry = report.entries[0];
  const native = report.gateways.find(item => item.frontmatter) || report.gateways[0];
  const mcp = report.mcpConfiguration;
  const config = mcp.files?.[0] || report.mcpConfigs.find(item => item.status === 'present')?.path || report.mcpConfigs[0]?.path || null;
  const readiness = profile.status !== 'known' ? profile.status
    : report.entryReadiness === 'ready' && report.instructionReadiness === 'ready' ? 'discoverable-files-present' : 'gap';
  return {
    package: PKG.name, host: profile.hostId || profile.requested, root: report.projectRoot,
    entry: { path: entry?.path || null, present: entry?.status === 'present', bytes: entry?.bytes || 0 },
    gateway: { path: native?.path || null, present: Boolean(native?.frontmatter), status: native?.status || 'unverified' },
    config: { path: config, present: report.mcpConfigs.some(item => item.path === config && item.status === 'present'), contentsInspected: mcp.contentsInspected, status: mcp.status },
    readiness, connection: 'unknown', hostContextLoaded: 'unknown', compliance: 'unverified',
    explanation: profile.status === 'known' ? profile.help.join(' ') : profile.message,
    warnings: [...report.warnings], nextActions: report.nextActions.map(action => action.message),
    hostProfile: profile, evidenceLevel: 'static-host-paths',
  };
}
