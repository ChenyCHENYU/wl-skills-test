import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { PKG } from "./context.js";
import jsonc from "../shared-jsonc.cjs";

const { parseJsonc, getJsoncValue, getJsoncNodeText, setJsoncValue } = jsonc;

const STATE_PATH = ".wl-skills-test/manifest.json";
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
  const file = path.join(root, STATE_PATH);
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

function currentFile(root, rel, virtualDirs = new Set()) {
  const full = safePath(root, rel);
  let ancestor = path.dirname(full);
  while (ancestor !== path.resolve(root)) {
    const ancestorRel = path.relative(root, ancestor).split(path.sep).join("/");
    if (!virtualDirs.has(ancestorRel) && fs.existsSync(ancestor)) {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`父路径不是普通目录: ${ancestorRel}`);
    }
    ancestor = path.dirname(ancestor);
  }
  if ([...virtualDirs].some((dir) => rel.startsWith(`${dir}/`))) return null;
  if (!fs.existsSync(full)) return null;
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("目标不是普通文件");
  return fs.readFileSync(full, "utf8");
}

function sourceFiles(dir, rel = "") {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap((entry) => {
    const target = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full, target) : [{ path: target, content: fs.readFileSync(full, "utf8") }];
  });
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

function planMcp(plan, source, before, previous, force) {
  const input = before ?? "{}\n";
  const value = parseJsonc(input, source.path);
  if (!value || Array.isArray(value) || typeof value !== "object" || (value.mcpServers !== undefined && (!value.mcpServers || Array.isArray(value.mcpServers) || typeof value.mcpServers !== "object"))) {
    throw new Error("MCP 配置结构不合法，保留原文件");
  }
  const key = "wl-skills-test";
  const next = parseJsonc(source.content).mcpServers[key];
  const current = getJsoncValue(input, ["mcpServers", key]);
  const currentText = current === undefined ? null : JSON.stringify(current);
  if (current !== undefined && !previous) {
    if (currentText !== JSON.stringify(next)) throw new Error("已有未登记的同名 MCP server");
    return null;
  }
  if (previous && mcpUnitModified(input, previous) && !force) throw new Error("本包 MCP server 内容或注释有本地改动");
  const after = setJsoncValue(input, ["mcpServers", key], next);
  addOperation(plan, source.path, before, after);
  return { path: source.path, kind: "mcp", key, content: JSON.stringify(next), hash: digest(JSON.stringify(next)),
    installedTextHash: digest(getJsoncNodeText(after, ["mcpServers", key])), created: previous?.created ?? before === null };
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

export function createInstallPlan(root, { filesDir, version = PKG.version, force = false } = {}) {
  root = path.resolve(root);
  const previousState = readState(root);
  const previous = new Map(previousState.files.map((entry) => [entry.path, entry]));
  const plan = { kind: "install", root, operations: [], conflicts: [], previousState, stateBefore: currentFile(root, STATE_PATH), nextState: { schemaVersion: 1, package: PKG.name, version, files: [] } };
  const virtualDirs = new Set();
  for (const [container, [, legacy]] of Object.entries(EDITORS)) {
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
  for (const raw of sourceFiles(filesDir)) {
    const source = { ...raw, content: raw.content.replaceAll("__WL_SKILLS_TEST_VERSION__", version) };
    wanted.add(source.path);
    const old = previous.get(source.path);
    try {
      const before = currentFile(root, source.path, virtualDirs);
      let entry;
      if (SHARED_MARKDOWN.has(source.path)) entry = planMarkdown(plan, source, before, old, force);
      else if (source.path === ".mcp.json") entry = planMcp(plan, source, before, old, force);
      else {
        if (before !== null && !old) {
          if (before !== source.content) throw new Error("已有未登记文件，保留原内容");
          continue;
        }
        if (old && before !== null && digest(before) !== old.hash && !force) throw new Error("受管文件有本地改动");
        addOperation(plan, source.path, before, source.content);
        entry = { path: source.path, kind: "file", created: old?.created ?? before === null,
          hash: digest(source.content), content: source.content };
      }
      if (entry) plan.nextState.files.push(entry);
    } catch (error) {
      plan.conflicts.push({ path: source.path, reason: error.message });
      if (old) plan.nextState.files.push(old);
    }
  }
  for (const old of previous.values()) if (!wanted.has(old.path)) planCleanUnit(plan, old);
  return plan;
}

function planCleanUnit(plan, entry) {
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
    plan.conflicts.push({ path: entry.path, reason: error.message });
    plan.nextState.files.push(entry);
  }
}

export function createCleanPlan(root) {
  root = path.resolve(root);
  const previousState = readState(root);
  const plan = { kind: "clean", root, operations: [], conflicts: [], previousState, stateBefore: currentFile(root, STATE_PATH), nextState: { ...previousState, files: [] } };
  for (const entry of previousState.files) planCleanUnit(plan, entry);
  return plan;
}

export function applyInstallPlan(plan, { writeFile = fs.writeFileSync } = {}) {
  if (plan.kind === "install" && plan.conflicts.length) throw new Error("安装计划存在冲突，未写入任何文件");
  const { root } = plan;
  const snapshots = [];
  const directories = [];
  const mkdir = (dir) => {
    if (fs.existsSync(dir)) return;
    mkdir(path.dirname(dir));
    fs.mkdirSync(dir); directories.push(dir);
  };
  const stateBefore = plan.stateBefore;
  if (currentFile(root, STATE_PATH) !== stateBefore) throw new Error("计划生成后 manifest 发生变化");
  mkdir(path.join(root, ".wl-skills-test"));
  const lock = path.join(root, ".wl-skills-test/install.lock");
  const fd = fs.openSync(lock, "wx");
  fs.closeSync(fd);
  const id = randomUUID();
  const backupRoot = path.join(root, ".wl-skills-test/backups", id);
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
      } else if (operation.after === null) fs.rmSync(safePath(root, operation.path));
      else write(operation.path, operation.after);
    }
    if (currentFile(root, STATE_PATH) !== stateBefore) throw new Error("计划生成后 manifest 发生变化");
    snapshot(STATE_PATH);
    write(STATE_PATH, JSON.stringify(plan.nextState, null, 2) + "\n");
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
    for (const dir of directories.reverse()) if (fs.existsSync(dir) && fs.lstatSync(dir).isDirectory() && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  }
}
