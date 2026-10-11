import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFixTargets, FixTargetError } from "../lib/fix-targets.js";

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "wl-fix-targets-"));
  const project = join(base, "project");
  const outside = join(base, "project-sibling");
  mkdirSync(join(project, "tests", "nested"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const originals = new Map();
  const file = (name, text = "test('needs fix', async () => {});\r\n") => {
    const bytes = Buffer.from(text);
    writeFileSync(name, bytes);
    originals.set(name, bytes);
    return name;
  };
  file(join(project, "tests", "normal.spec.js"));
  file(join(project, "tests", "nested", "normal.spec.ts"));
  file(join(outside, "outside.spec.js"));
  t.after(() => {
    for (const [name, bytes] of originals) assert.deepEqual(readFileSync(name), bytes, `${name} user bytes must stay unchanged`);
    rmSync(base, { recursive: true, force: true });
  });
  return { base, project, outside, file };
}

function outsideError(error) {
  assert.ok(error instanceof FixTargetError);
  assert.equal(error.code, "fix-target-outside-project");
  return true;
}

test("normal target collection stays in the selected subtree and never changes user bytes", t => {
  const { project, file } = fixture(t);
  file(join(project, "unselected.spec.js"));
  file(join(project, "tests", "README.md"), "unrelated documentation\n");
  mkdirSync(join(project, "tests", "node_modules"));
  mkdirSync(join(project, "tests", ".cache"));
  file(join(project, "tests", "node_modules", "ignored.js"));
  file(join(project, "tests", ".cache", "ignored.ts"));
  const result = collectFixTargets("tests", { projectRoot: project });
  assert.deepEqual(result.files, [join(realpathSync(project), "tests", "nested", "normal.spec.ts"), join(realpathSync(project), "tests", "normal.spec.js")]);
  assert.deepEqual(result.skippedEntries, []);
  assert.equal(result.projectRoot, realpathSync(project));
  assert.equal(result.target, join(project, "tests"));
  assert.deepEqual(collectFixTargets("tests/normal.spec.js", { projectRoot: project }).files, [join(realpathSync(project), "tests", "normal.spec.js")]);
});

test("selected external roots and parent-link escapes are refused instead of followed", t => {
  const { project, outside } = fixture(t);
  symlinkSync(outside, join(project, "external-root"), "dir");
  symlinkSync(join(outside, "outside.spec.js"), join(project, "external.spec.js"), "file");
  assert.throws(() => collectFixTargets(outside, { projectRoot: project }), outsideError);
  assert.throws(() => collectFixTargets("../project-sibling", { projectRoot: project }), outsideError);
  assert.throws(() => collectFixTargets("external-root", { projectRoot: project }), outsideError);
  assert.throws(() => collectFixTargets("external-root/outside.spec.js", { projectRoot: project }), outsideError);
  assert.throws(() => collectFixTargets("external.spec.js", { projectRoot: project }), outsideError);
});

test("external directory and leaf links are explicitly skipped under a valid target", t => {
  const { project, outside } = fixture(t);
  symlinkSync(outside, join(project, "tests", "outside-directory"), "dir");
  symlinkSync(join(outside, "outside.spec.js"), join(project, "tests", "outside-leaf.js"), "file");
  symlinkSync(join(outside, "missing.js"), join(project, "tests", "dangling.js"), "file");
  const result = collectFixTargets("tests", { projectRoot: project });
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.skippedEntries, [
    { path: join(realpathSync(project), "tests", "dangling.js"), reason: "symbolic-link-unresolved" },
    { path: join(realpathSync(project), "tests", "outside-directory"), reason: "symbolic-link-outside-project" },
    { path: join(realpathSync(project), "tests", "outside-leaf.js"), reason: "symbolic-link-outside-project" },
  ]);
});

test("internal directory, file and loop links are not recursively followed or counted twice", t => {
  const { project } = fixture(t);
  symlinkSync(join(project, "tests", "nested"), join(project, "tests", "internal-directory"), "dir");
  symlinkSync(join(project, "tests", "normal.spec.js"), join(project, "tests", "internal-leaf.js"), "file");
  symlinkSync(join(project, "tests"), join(project, "tests", "nested", "loop"), "dir");
  const result = collectFixTargets("tests", { projectRoot: project });
  assert.equal(result.files.length, 2);
  assert.equal(result.skippedEntries.length, 3);
  assert.ok(result.skippedEntries.every(entry => entry.reason === "symbolic-link-not-followed"));
  const linkedTarget = collectFixTargets("tests/internal-directory", { projectRoot: project });
  assert.deepEqual(linkedTarget.files, []);
  assert.deepEqual(linkedTarget.skippedEntries, [{ path: join(project, "tests", "internal-directory"), reason: "symbolic-link-not-followed" }]);
  const linkedAncestor = collectFixTargets("tests/internal-directory/normal.spec.ts", { projectRoot: project });
  assert.deepEqual(linkedAncestor.files, []);
  assert.equal(linkedAncestor.skippedEntries[0].reason, "symbolic-link-not-followed");
});

test("range budgets refuse partial collection and empty supported scope stays empty", t => {
  const { project, file } = fixture(t);
  mkdirSync(join(project, "documentation"));
  file(join(project, "documentation", "README.md"), "No automatic fix target\n");
  const empty = collectFixTargets("documentation", { projectRoot: project });
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.skippedEntries, []);
  assert.throws(() => collectFixTargets("tests", { projectRoot: project, maxEntries: 1 }), { code: "fix-target-limit" });
  assert.throws(() => collectFixTargets("tests", { projectRoot: project, maxDepth: 1 }), { code: "fix-target-limit" });
  for (const maxEntries of [0, -1, 1.5, 50001]) assert.throws(() => collectFixTargets("tests", { projectRoot: project, maxEntries }), { code: "invalid-fix-target" });
  assert.throws(() => collectFixTargets("tests", { projectRoot: "" }), { code: "invalid-fix-target" });
  assert.throws(() => collectFixTargets("tests", { projectRoot: join(project, "tests", "normal.spec.js") }), { code: "invalid-fix-target" });
});
