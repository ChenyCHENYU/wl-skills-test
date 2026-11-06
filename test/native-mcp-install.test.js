import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInstallPlan, createCleanPlan, applyInstallPlan, STATE_PATH } from "../lib/cli/install-state.js";
import { PKG, PKG_ROOT } from "../lib/cli/context.js";
import { inspectInstallation } from "../lib/host-diagnostics.js";
import jsonc from "../lib/shared-jsonc.cjs";

const OWNER = "wl-skills-test", filesDir = path.join(PKG_ROOT, "files");
const hash = content => createHash("sha256").update(content).digest("hex");
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-native-mcp-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, content) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  put("package.json", JSON.stringify({ private: true, devDependencies: { [PKG.name]: PKG.version } }));
  fs.mkdirSync(path.join(root, "node_modules/@agile-team"), { recursive: true });
  fs.symlinkSync(PKG_ROOT, path.join(root, "node_modules/@agile-team/wl-skills-test"), process.platform === "win32" ? "junction" : "dir");
  const plan = options => createInstallPlan(root, { filesDir, ...options });
  const install = options => { const next = plan(options); assert.deepEqual(next.conflicts, []); applyInstallPlan(next); return next; };
  return { root, put, plan, install, read: rel => fs.readFileSync(path.join(root, rel), "utf8"), state: () => JSON.parse(fs.readFileSync(path.join(root, STATE_PATH), "utf8")) };
}

test("selected native MCP hosts use one source scan and separate ownership", t => {
  const f = fixture(t), original = fs.readdirSync; let scans = 0;
  fs.readdirSync = (dir, ...args) => { if (path.resolve(dir) === filesDir) scans++; return original(dir, ...args); };
  let plan;
  try { plan = f.plan({ hosts: "codex,cursor,claude", mcp: true }); } finally { fs.readdirSync = original; }
  assert.equal(scans, 1); assert.deepEqual(plan.conflicts, []);
  assert.equal(fs.existsSync(path.join(f.root, ".codex/config.toml")), false);
  applyInstallPlan(plan);
  assert.deepEqual(Object.keys(f.state().managedMcp.records).sort(), [".codex/config.toml", ".cursor/mcp.json", ".mcp.json"]);
  assert.ok(!f.state().files.some(entry => entry.kind === "mcp"));
  assert.equal(jsonc.getJsoncValue(f.read(".cursor/mcp.json"), ["mcpServers", OWNER, "env", "WL_PROJECT_ROOT"]), f.root);
  assert.ok(f.read(".codex/config.toml").includes("mcp/index.js"));
  assert.equal(inspectInstallation(f.root).integrity, "verified");
});

test("CLI init --mcp is installation, not the legacy stdio launcher; disable is explicit", t => {
  const f = fixture(t), bin = path.join(PKG_ROOT, "bin/wl-skills-test.js");
  const preview = spawnSync(process.execPath, [bin, "init", "--hosts", "codex", "--mcp", "--dry-run"], { cwd: f.root, encoding: "utf8", timeout: 10000 });
  assert.equal(preview.status, 0, preview.stderr); assert.match(preview.stdout, /预览/);
  assert.equal(fs.existsSync(path.join(f.root, STATE_PATH)), false);
  const installed = spawnSync(process.execPath, [bin, "init", "--hosts", "codex", "--mcp"], { cwd: f.root, encoding: "utf8", timeout: 10000 });
  assert.equal(installed.status, 0, installed.stderr); assert.ok(f.state().managedMcp.records[".codex/config.toml"]);
  const disabled = spawnSync(process.execPath, [bin, "update", "--no-mcp"], { cwd: f.root, encoding: "utf8", timeout: 10000 });
  assert.equal(disabled.status, 0, disabled.stderr); assert.deepEqual(f.state().managedMcp.records, {});
  const conflict = spawnSync(process.execPath, [bin, "update", "--mcp", "--no-mcp"], { cwd: f.root, encoding: "utf8", timeout: 10000 });
  assert.notEqual(conflict.status, 0); assert.match(conflict.stderr, /不可同时/);
});

test("switch and clean preserve foreign configuration, comments and pre-existing TOML", t => {
  const f = fixture(t), toml = '# user TOML\nmodel = "user-model"\n[mcp_servers.foreign]\ncommand = "custom"\n';
  f.put(".codex/config.toml", toml);
  f.put(".cursor/mcp.json", '{\r\n// user comment\r\n"mcpServers":{"foreign":{"command":"custom"}},"settings":{"user":true}\r\n}\r\n');
  f.install({ hosts: "codex,cursor", mcp: true }); f.install({ hosts: "codex", mcp: true });
  assert.equal(jsonc.getJsoncValue(f.read(".cursor/mcp.json"), ["mcpServers", OWNER]), undefined);
  assert.ok(f.read(".cursor/mcp.json").includes("// user comment"));
  applyInstallPlan(createCleanPlan(f.root));
  assert.equal(f.read(".codex/config.toml"), toml);
  assert.equal(jsonc.getJsoncValue(f.read(".cursor/mcp.json"), ["mcpServers", "foreign", "command"]), "custom");
});

test("legacy JSON serialization ownership transfers once; disabling removes only the verified node", t => {
  const f = fixture(t), server = { command: "npx", args: ["@agile-team/wl-skills-test", "--mcp"] };
  const body = JSON.stringify({ mcpServers: { foreign: { command: "user" }, [OWNER]: server } }, null, 2) + "\n";
  f.put(".mcp.json", body);
  f.put(STATE_PATH, JSON.stringify({ schemaVersion: 1, package: PKG.name, version: PKG.version, hosts: ["claude"], integration: "compact", files: [
    { path: ".mcp.json", kind: "mcp", key: OWNER, content: JSON.stringify(server), hash: hash(JSON.stringify(server)), installedTextHash: hash(jsonc.getJsoncNodeText(body, ["mcpServers", OWNER])), created: false },
  ] }));
  f.install({ hosts: "claude", mcp: true });
  assert.ok(!f.state().files.some(entry => entry.kind === "mcp")); assert.ok(f.state().managedMcp.records[".mcp.json"]);
  f.install({ hosts: "claude", mcp: false });
  assert.equal(jsonc.getJsoncValue(f.read(".mcp.json"), ["mcpServers", OWNER]), undefined);
  assert.equal(jsonc.getJsoncValue(f.read(".mcp.json"), ["mcpServers", "foreign", "command"]), "user");
});

test("native node modifications, including comments, retain old evidence through update and clean", t => {
  const f = fixture(t); f.install({ hosts: "cursor", mcp: true });
  const prior = f.state().managedMcp.records[".cursor/mcp.json"];
  const modified = f.read(".cursor/mcp.json").replace('"command":', '/* user node comment */"command":'); f.put(".cursor/mcp.json", modified);
  const update = f.plan({ hosts: "cursor", mcp: true, force: true }); assert.ok(update.conflicts.length);
  assert.throws(() => applyInstallPlan(update), /冲突/); assert.equal(f.read(".cursor/mcp.json"), modified);
  assert.equal(inspectInstallation(f.root).integrity, "gap");
  applyInstallPlan(createCleanPlan(f.root));
  assert.equal(f.read(".cursor/mcp.json"), modified); assert.deepEqual(f.state().managedMcp.records[".cursor/mcp.json"], prior);
});

test("unchanged native nodes are rechecked before applying unrelated installation operations", t => {
  const f = fixture(t); f.install({ hosts: "cursor", mcp: true });
  const stateBefore = f.read(STATE_PATH), plan = f.plan({ hosts: "cursor", mcp: true });
  const modified = f.read(".cursor/mcp.json").replace('"command":', '/* concurrent user edit */"command":'); f.put(".cursor/mcp.json", modified);
  assert.throws(() => applyInstallPlan(plan), /MCP 配置发生变化/);
  assert.equal(f.read(STATE_PATH), stateBefore); assert.equal(f.read(".cursor/mcp.json"), modified);
});

test("manifest failure rolls back native config and preserves pre-existing user bytes", t => {
  const f = fixture(t), before = '{"mcpServers":{"foreign":{"command":"user"}}}\n'; f.put(".cursor/mcp.json", before);
  const plan = f.plan({ hosts: "cursor", mcp: true });
  assert.throws(() => applyInstallPlan(plan, { writeFile(file, ...args) { if (file.startsWith(path.join(f.root, STATE_PATH))) throw new Error("manifest injected failure"); return fs.writeFileSync(file, ...args); } }), /已回滚/);
  assert.equal(f.read(".cursor/mcp.json"), before); assert.equal(fs.existsSync(path.join(f.root, STATE_PATH)), false);
});
