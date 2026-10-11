/**
 * Collect automatic-fix inputs inside one authorized project without following links.
 * This collector reads filesystem metadata only; it never reads or writes user bytes.
 */
import { lstatSync, realpathSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

export class FixTargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FixTargetError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FixTargetError(code, message);
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(root + sep);
}

function directoryRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) fail("invalid-fix-target", "修复需要有效的项目根目录");
  try {
    const root = realpathSync(resolve(projectRoot));
    if (!lstatSync(root).isDirectory()) fail("invalid-fix-target", "修复项目根必须为目录");
    return root;
  } catch (error) {
    if (error instanceof FixTargetError) throw error;
    fail("invalid-fix-target", `修复项目根无法核验：${error.message}`);
  }
}

function validateBudget(value, name, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail("invalid-fix-target", `修复 ${name} 预算无效`);
}

function selectedTarget(target, lexicalRoot, root) {
  if (typeof target !== "string" || !target.trim()) fail("invalid-fix-target", "修复需要有效的目标路径");
  const absolute = resolve(lexicalRoot, target);
  if (!within(lexicalRoot, absolute)) fail("fix-target-outside-project", "修复目标越出授权项目根");
  let actual;
  try { actual = realpathSync(absolute); }
  catch (error) { fail("invalid-fix-target", `修复目标无法核验：${error.message}`); }
  if (!within(root, actual)) fail("fix-target-outside-project", "修复目标或祖先符号链接越出授权项目根");

  // Even a link to an internal directory is not an implicit request to traverse it.
  let current = lexicalRoot;
  const segments = relative(lexicalRoot, absolute).split(sep).filter(Boolean);
  for (const segment of segments) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) return { absolute, actual, link: current };
  }
  return { absolute, actual, link: null };
}

/**
 * @returns {{projectRoot:string,target:string,files:string[],skippedEntries:Array<{path:string,reason:string}>,visitedEntries:number}}
 * Outside selected roots are rejected. Links discovered under a valid root are
 * reported as skipped; callers must display them and must not claim full coverage.
 */
export function collectFixTargets(target, { projectRoot = process.cwd(), maxEntries = 50000, maxDepth = 64 } = {}) {
  validateBudget(maxEntries, "entries", 50000);
  validateBudget(maxDepth, "depth", 128);
  const root = directoryRoot(projectRoot);
  const lexicalRoot = resolve(projectRoot);
  const selected = selectedTarget(target, lexicalRoot, root);
  const result = { projectRoot: root, target: selected.absolute, files: [], skippedEntries: [], visitedEntries: 0 };
  const skip = (entry, reason) => result.skippedEntries.push({ path: entry, reason });
  if (selected.link) {
    skip(selected.link, "symbolic-link-not-followed");
    return result;
  }

  const visit = (entry, depth) => {
    if (++result.visitedEntries > maxEntries || depth > maxDepth) fail("fix-target-limit", "修复收集范围超过预算，请缩小目标");
    let stat;
    try { stat = lstatSync(entry); }
    catch { skip(entry, "unreadable-entry"); return; }
    if (stat.isSymbolicLink()) {
      try { skip(entry, within(root, realpathSync(entry)) ? "symbolic-link-not-followed" : "symbolic-link-outside-project"); }
      catch { skip(entry, "symbolic-link-unresolved"); }
      return;
    }
    // Recheck actual ancestry before returning any file to a write-capable caller.
    let actual;
    try { actual = realpathSync(entry); }
    catch { skip(entry, "unreadable-entry"); return; }
    if (!within(root, actual)) fail("fix-target-outside-project", "修复收集期间目标越出授权项目根");
    if (stat.isDirectory()) {
      const names = readdirSync(entry).sort();
      for (const name of names) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        visit(join(entry, name), depth + 1);
      }
    } else if (stat.isFile() && [".js", ".ts"].includes(extname(entry))) {
      result.files.push(actual);
    } else if (!stat.isFile()) {
      skip(entry, "unsupported-entry");
    }
  };
  visit(selected.actual, 0);
  return result;
}
