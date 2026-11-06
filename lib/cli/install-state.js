import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PKG } from "./context.js";
import jsonc from "../shared-jsonc.cjs";
import hostProfiles from "../host-profiles.cjs";
import integrationSupport from "../project-integration.cjs";
import mcpConfig from "../mcp-config.cjs";

const { parseJsonc, getJsoncValue, getJsoncNodeText, setJsoncValue } = jsonc;

export const STATE_PATH = ".wl-skills/state/test/manifest.json";
const LEGACY_STATE_PATH = ".wl-skills-test/manifest.json";
const BEGIN = "<!-- wl-skills-test:begin -->";
const END = "<!-- wl-skills-test:end -->";
const SHARED_MARKDOWN = new Set([
  "AGENTS.md", "CLAUDE.md", "copilot-instructions.md", ".github/copilot-instructions.md",
  ".github/skills/_registry.md", ".github/skills/_pipeline.md", ".github/standards/index.md",
]);
const EDITORS = {
  ".cursor": ["rules/wl-skills-test.mdc", "rules/wl-skills-test.legacy.mdc"],
  ".kiro": ["steering/wl-skills-test.md", "steering/wl-skills-test.legacy.md"],
  ".clinerules": ["wl-skills-test.md", "wl-skills-test.legacy.md"],
  ".windsurf": ["rules/wl-skills-test.md", "rules/wl-skills-test.legacy.md"],
  ".trae": ["rules/wl-skills-test.md", "rules/wl-skills-test.legacy.md"],
  ".qoder": ["rules/wl-skills-test.md", "rules/wl-skills-test.legacy.md"],
};
const digest = (value) => createHash("sha256").update(value).digest("hex");

function readState(root) {
  const file = path.join(root, fs.existsSync(path.join(root, STATE_PATH)) ? STATE_PATH : LEGACY_STATE_PATH);
  if (!fs.existsSync(file)) return { schemaVersion: 1, package: PKG.name, files: [] };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.schemaVersion !== 1 || value.package !== PKG.name || !Array.isArray(value.files)) {
    throw new Error("wl-skills-test manifest 不兼容，已停止以保护原文件");
  }
  return value;
}

function safePath(root, rel) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`非法安装路径: ${rel}`);
  return full;
}

function pathStat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return null; throw error; }
}

function currentFile(root, rel, virtualDirs = new Set()) {
  const full = safePath(root, rel);
  let ancestor = path.dirname(full);
  while (ancestor !== path.resolve(root)) {
    const ancestorRel = path.relative(root, ancestor).split(path.sep).join("/");
    const stat = pathStat(ancestor);
    if (!virtualDirs.has(ancestorRel) && stat) {
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`父路径不是普通目录: ${ancestorRel}`);
    }
    ancestor = path.dirname(ancestor);
  }
  if ([...virtualDirs].some((dir) => rel.startsWith(`${dir}/`))) return null;
  const stat = pathStat(full);
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("目标不是普通文件");
  return fs.readFileSync(full, "utf8");
}

function sourceFiles(dir, rel = "", selection) {
  const sources = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap((entry) => {
    const target = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full, target, selection) : [{ path: target, content: fs.readFileSync(full, "utf8") }];
  });
  if (!rel) {
    const canonical = sources.find((item) => item.path === ".agents/skills/wl-skills-test/SKILL.md");
    if (canonical) {
      const existing = new Set(sources.map((item) => item.path));
      for (const target of hostProfiles.gatewayInstallPaths(PKG.name, selection)) {
        if (!existing.has(target)) sources.push({ ...canonical, path: target });
      }
    }
  }
  if (rel || !selection) return sources;
  const entries = new Set(selection.entryFiles.map(item => item.replaceAll("<skill>", "wl-skills-test")));
  if (selection.integration === "expanded") {
    const adapters = { cursor: ".cursor/rules/wl-skills-test.mdc", cline: ".clinerules/wl-skills-test.md", kiro: ".kiro/steering/wl-skills-test.md", trae: ".trae/rules/wl-skills-test.md", qoder: ".qoder/rules/wl-skills-test.md" };
    for (const host of selection.hosts) if (adapters[host]) entries.add(adapters[host]);
  }
  const gateways = new Set(hostProfiles.gatewayInstallPaths(PKG.name, selection));
  const adapterPaths = new Set(["AGENTS.md", "CLAUDE.md", "copilot-instructions.md", ".github/copilot-instructions.md",
    ...Object.entries(EDITORS).map(([container, [file]]) => `${container}/${file}`)]);
  return sources.filter(item => gateways.has(item.path) || entries.has(item.path) ||
    (selection.integration === "expanded" && !adapterPaths.has(item.path) && !item.path.endsWith("/wl-skills-test/SKILL.md") && item.path !== ".mcp.json"));
}

function ownBlock(content) {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < start || content.indexOf(BEGIN, start + BEGIN.length) >= 0 || content.indexOf(END, end + END.length) >= 0) {
    throw new Error("本包托管区块标记缺失或重复");
  }
  return content.slice(start, end + END.length);
}

function blockFor(content) {
  return ownBlock(content) || `${BEGIN}\n${content.replace(/^\uFEFF/, "").trimEnd()}\n${END}`;
}

function addOperation(plan, rel, before, after, kind = "write") {
  if (before !== after) plan.operations.push({ path: rel, kind: after === null ? "remove" : kind, before, after });
}

function planMarkdown(plan, source, before, previous, force) {
  const nextBlock = blockFor(source.content);
  const currentBlock = before === null ? null : ownBlock(before);
  if (currentBlock && !previous) {
    if (currentBlock !== nextBlock) throw new Error("已有未登记的本包区块，保留原内容");
    return null;
  }
  if (previous && currentBlock !== previous.content && !force) throw new Error("本包区块有本地改动");
  let after;
  let addition;
  if (currentBlock) {
    after = before.replace(currentBlock, nextBlock);
    addition = previous.addition?.replace(previous.content, nextBlock) || nextBlock;
  } else {
    const separator = before === null || before === "" ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    addition = `${separator}${nextBlock}\n`;
    after = (before || "") + addition;
  }
  addOperation(plan, source.path, before, after);
  return { path: source.path, kind: "markdown", content: nextBlock, hash: digest(nextBlock), addition,
    created: previous?.created ?? before === null };
}

function mcpUnitModified(text, entry) {
  const current = getJsoncValue(text, ["mcpServers", entry.key]);
  const node = getJsoncNodeText(text, ["mcpServers", entry.key]);
  if (current === undefined || JSON.stringify(current) !== entry.content) return true;
  if (entry.installedTextHash) return digest(node) !== entry.installedTextHash;
  // Legacy state knew only semantic JSON. Comments/trailing commas cannot be
  // established as package-owned, so preserve them rather than adopt and erase.
  try { JSON.parse(node); return false; } catch { return true; }
}

function managedMcpPlan(root, previousState, selection = {}, remove = false) {
  const entries = previousState.files.filter(entry => entry.kind === "mcp").map(entry => ({ path: entry.path,
    container: entry.container || "mcpServers", serverKey: entry.key || "wl-skills-test", valueHash: entry.hash,
    textHash: entry.installedTextHash, algorithm: "sha256", valueSerialization: "json", createdFile: entry.created === true }));
  const imported = mcpConfig.importLegacyMcpRecords({ projectRoot: root, packageName: PKG.name, entries });
  const previous = { ...imported, ...(previousState.managedMcp?.records || {}) };
  return { ...mcpConfig.planMcpConfiguration({ projectRoot: root, packageName: PKG.name,
    hosts: selection.hosts || [], enabled: selection.mcp === true, previous, remove }), transferred: new Set(Object.keys(imported)) };
}

function appendMcpPlan(plan, mcp) {
  plan.mcpFiles = mcp.files.map(file => ({ path: file.path, before: file.before, after: file.content }));
  for (const file of mcp.files) {
    const before = currentFile(plan.root, file.path);
    if (before !== file.before) throw new Error(`MCP 规划期间文件发生变化: ${file.path}`);
    if (file.action === "write" || file.action === "remove") addOperation(plan, file.path, before, file.content);
    if (file.action === "preserve") (plan.preserved ||= []).push({ path: file.path, reason: file.reason });
  }
  plan.conflicts.push(...mcp.conflicts);
  plan.nextState.managedMcp = { layoutVersion: mcp.layoutVersion, records: mcp.records };
  plan.mcpDiagnostics = mcp.diagnostics;
}

export function createInstallPlan(root, { filesDir, version = PKG.version, force = false, hosts, editor, integration, mcp } = {}) {
  root = path.resolve(root);
  const previousState = readState(root);
  const selection = integrationSupport.resolveIntegration({ projectRoot: root, hosts, editor, integration, mcp, recorded: previousState });
  const previous = new Map(previousState.files.map((entry) => [entry.path, entry]));
  const plan = { kind: "install", root, operations: [], conflicts: [], previousState, stateBefore: currentFile(root, STATE_PATH), nextState: { schemaVersion: 1, package: PKG.name, version, integration: selection.integration, hosts: selection.hosts, files: [] }, selection, legacyStateBefore: currentFile(root, LEGACY_STATE_PATH) };
  const mcpPlan = managedMcpPlan(root, previousState, selection);
  const sources = sourceFiles(filesDir, "", selection);
  const virtualDirs = new Set();
  for (const [container, [, legacy]] of Object.entries(EDITORS)) {
    if (!sources.some(item => item.path.startsWith(`${container}/`))) continue;
    const full = path.join(root, container);
    if (!fs.existsSync(full) || fs.lstatSync(full).isDirectory()) continue;
    try {
      const content = currentFile(root, container);
      const firstLine = content.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
      if (!["@agile-team/wl-skills-test", "# Kiro — wl-skills-test"].includes(firstLine)) {
        throw new Error("已有外来普通文件，无法自动转为规则目录");
      }
      const legacyPath = `${container}/${legacy}`;
      plan.operations.push({ path: container, kind: "migrate", before: content, after: null, legacyPath, legacyContent: content });
      virtualDirs.add(container);
    } catch (error) { plan.conflicts.push({ path: container, reason: error.message }); }
  }
  const wanted = new Set();
  for (const raw of sources) {
    const source = { ...raw, content: raw.content.replaceAll("__WL_SKILLS_TEST_VERSION__", version) };
    wanted.add(source.path);
    const old = previous.get(source.path);
    try {
      const before = currentFile(root, source.path, virtualDirs);
      let entry;
      if (SHARED_MARKDOWN.has(source.path)) entry = planMarkdown(plan, source, before, old, force);
      else {
        if (before !== null && !old) {
          if (before !== source.content) throw new Error("已有未登记文件，保留原内容");
          continue;
        }
        if (old && before !== null && digest(before) !== old.hash && !force) throw new Error("受管文件有本地改动");
        addOperation(plan, source.path, before, source.content);
        entry = { path: source.path, kind: "file", created: old?.created ?? before === null,
          hash: digest(source.content) };
      }
      if (entry) plan.nextState.files.push(entry);
    } catch (error) {
      plan.conflicts.push({ path: source.path, reason: error.message });
      if (old) plan.nextState.files.push(old);
    }
  }
  for (const old of previous.values()) if (!wanted.has(old.path) && !mcpPlan.transferred.has(old.path)) planCleanUnit(plan, old, true);
  appendMcpPlan(plan, mcpPlan);
  const configuration = integrationSupport.readProjectConfig(root);
  const configPath = path.relative(root, configuration.configPath).split(path.sep).join("/");
  try {
    const before = currentFile(root, configPath);
    const config = before === null ? {} : JSON.parse(before);
    const profile = configuration.value;
    const nextProfile = { ...profile, schemaVersion: 1, integration: selection.integration, hosts: selection.hosts, ...(mcp !== undefined ? { mcp: selection.mcp } : {}) };
    const after = JSON.stringify(configPath === "package.json" ? { ...config, wlSkills: nextProfile } : nextProfile, null, 2) + "\n";
    if (JSON.stringify(profile) !== JSON.stringify(nextProfile)) addOperation(plan, configPath, before, after, "config");
  } catch (error) { plan.conflicts.push({ path: configPath, reason: error.message }); }
  const ignorePath = ".wl-skills/state/.gitignore";
  try {
    const before = currentFile(root, ignorePath);
    const previous = before || "";
    const missing = ["*/runs/", "*/cache/", "*/backups/"].filter(entry => !previous.split(/\r?\n/).includes(entry));
    const after = previous + (missing.length && previous && !previous.endsWith("\n") ? "\n" : "") + (missing.length ? missing.join("\n") + "\n" : "");
    addOperation(plan, ignorePath, before, after, "state-ignore");
  } catch (error) { plan.conflicts.push({ path: ignorePath, reason: error.message }); }
  if (plan.legacyStateBefore !== null) addOperation(plan, LEGACY_STATE_PATH, plan.legacyStateBefore, null);
  return plan;
}

function planCleanUnit(plan, entry, migration = false) {
  try {
    const before = currentFile(plan.root, entry.path);
    if (before === null) return;
    if (entry.kind === "markdown") {
      const block = ownBlock(before);
      if (block !== entry.content) throw new Error("本包区块有本地改动，保留");
      const after = entry.addition && before.includes(entry.addition) ? before.replace(entry.addition, "") : before.replace(block, "");
      addOperation(plan, entry.path, before, entry.created && !after.trim() ? null : after);
    } else if (entry.kind === "mcp") {
      const value = parseJsonc(before, entry.path);
      const current = getJsoncValue(before, ["mcpServers", entry.key]);
      if (current === undefined) return;
      if (mcpUnitModified(before, entry)) throw new Error("本包 MCP server 内容或注释有本地改动，保留");
      const after = setJsoncValue(before, ["mcpServers", entry.key], undefined);
      // Keep the container and its comments even if our server was the last one.
      addOperation(plan, entry.path, before, after);
    } else {
      if (!entry.created) return;
      if (digest(before) !== entry.hash) throw new Error("受管文件有本地改动，保留");
      addOperation(plan, entry.path, before, null);
    }
  } catch (error) {
    (migration ? (plan.preserved ||= []) : plan.conflicts).push({ path: entry.path, reason: error.message });
    plan.nextState.files.push(entry);
  }
}

export function createCleanPlan(root) {
  root = path.resolve(root);
  const previousState = readState(root);
  const plan = { kind: "clean", root, operations: [], conflicts: [], previousState, stateBefore: currentFile(root, STATE_PATH), nextState: { ...previousState, files: [] } };
  const mcpPlan = managedMcpPlan(root, previousState, previousState, true);
  for (const entry of previousState.files) if (!mcpPlan.transferred.has(entry.path)) planCleanUnit(plan, entry);
  appendMcpPlan(plan, mcpPlan);
  const legacyBefore = currentFile(root, LEGACY_STATE_PATH);
  if (legacyBefore !== null) addOperation(plan, LEGACY_STATE_PATH, legacyBefore, null);
  return plan;
}

export function applyInstallPlan(plan, { writeFile = fs.writeFileSync } = {}) {
  if (plan.kind === "install" && plan.conflicts.length) throw new Error("安装计划存在冲突，未写入任何文件");
  const { root } = plan;
  for (const file of plan.mcpFiles || []) if (currentFile(root, file.path) !== file.before) throw new Error(`计划生成后 MCP 配置发生变化: ${file.path}`);
  const snapshots = [];
  const directories = [];
  const mkdir = (dir) => {
    if (fs.existsSync(dir)) return;
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir); directories.push(dir);
  };
  const stateBefore = plan.stateBefore;
  if (currentFile(root, STATE_PATH) !== stateBefore) throw new Error("计划生成后 manifest 发生变化");
  mkdir(path.dirname(path.join(root, STATE_PATH)));
  const lock = path.join(root, ".wl-skills/state/test/install.lock");
  const fd = fs.openSync(lock, "wx");
  fs.closeSync(fd);
  const id = randomUUID();
  const backupRoot = path.join(root, ".wl-skills/state/test/backups", id);
  const snapshot = (rel) => {
    const full = safePath(root, rel);
    const before = fs.existsSync(full) ? fs.readFileSync(full) : null;
    snapshots.push({ full, before });
    if (before !== null) { mkdir(path.dirname(path.join(backupRoot, rel))); fs.writeFileSync(path.join(backupRoot, rel), before); }
  };
  const write = (rel, text) => {
    const full = safePath(root, rel);
    mkdir(path.dirname(full));
    const temp = `${full}.wl-test-${id}.tmp`;
    try { writeFile(temp, text, "utf8"); fs.renameSync(temp, full); }
    finally { if (fs.existsSync(temp)) fs.rmSync(temp); }
  };
  try {
    for (const operation of plan.operations) {
      const current = currentFile(root, operation.path);
      if (current !== operation.before) throw new Error(`计划生成后文件发生变化: ${operation.path}`);
      snapshot(operation.path);
      if (operation.kind === "migrate") {
        fs.rmSync(safePath(root, operation.path));
        mkdir(safePath(root, operation.path));
        snapshot(operation.legacyPath);
        write(operation.legacyPath, operation.legacyContent);
      } else if (operation.kind === "state-ignore") {
        integrationSupport.ensureStateIgnore(root);
        if (currentFile(root, operation.path) !== operation.after) throw new Error("状态忽略文件与预检不一致");
      } else if (operation.after === null) fs.rmSync(safePath(root, operation.path));
      else write(operation.path, operation.after);
    }
    for (const file of plan.mcpFiles || []) {
      const changed = plan.operations.some(operation => operation.path === file.path);
      if (currentFile(root, file.path) !== (changed ? file.after : file.before)) throw new Error(`计划执行期间 MCP 配置发生变化: ${file.path}`);
    }
    if (currentFile(root, STATE_PATH) !== stateBefore) throw new Error("计划生成后 manifest 发生变化");
    snapshot(STATE_PATH);
    const state = { ...plan.nextState, files: plan.nextState.files.map(entry => {
      if (entry.kind !== "file") return entry;
      const { content: _legacyContent, ...metadata } = entry;
      return metadata;
    }) };
    write(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  } catch (error) {
    for (const item of snapshots.reverse()) {
      if (item.before === null) { if (fs.existsSync(item.full)) fs.rmSync(item.full, { recursive: true }); }
      else {
        if (fs.existsSync(item.full) && fs.lstatSync(item.full).isDirectory()) fs.rmSync(item.full, { recursive: true });
        fs.mkdirSync(path.dirname(item.full), { recursive: true }); fs.writeFileSync(item.full, item.before);
      }
    }
    throw new Error(`安装事务失败，已回滚: ${error.message}`);
  } finally {
    fs.rmSync(lock, { force: true });
    for (const op of plan.operations.filter(item => item.after === null)) {
      let dir = path.dirname(safePath(root, op.path));
      while (dir !== root && fs.existsSync(dir) && fs.lstatSync(dir).isDirectory() && !fs.readdirSync(dir).length) { fs.rmdirSync(dir); dir = path.dirname(dir); }
    }
    for (const dir of directories.reverse()) if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory() && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  }
}
