/** Native MCP launchers must bind relative tool paths to the configured project. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../mcp/index.js", import.meta.url));
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-mcp-root-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("MCP env project root governs tools launched from a foreign cwd", async t => {
  const root = fixture(t), cwd = fixture(t);
  fs.writeFileSync(path.join(root, "sample.spec.js"), "import { test } from '@playwright/test';\ntest('should submit', async ({ page }) => { await page.click('button'); });\n");
  const child = spawn(process.execPath, [entry], { cwd, env: { ...process.env, WL_PROJECT_ROOT: root }, stdio: ["pipe", "pipe", "pipe"] });
  let sequence = 0, stderr = "";
  const pending = new Map(), lines = createInterface({ input: child.stdout });
  child.stderr.on("data", chunk => { stderr += chunk; });
  lines.on("line", line => { const msg = JSON.parse(line); pending.get(msg.id)?.resolve(msg); });
  child.on("exit", () => { for (const waiter of pending.values()) waiter.reject(new Error(stderr || "MCP exited")); });
  t.after(() => { child.kill(); lines.close(); });
  const call = (name, args) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${stderr}`)); }, 5000);
    pending.set(id, { resolve: msg => { clearTimeout(timer); pending.delete(id); resolve(msg); }, reject: error => { clearTimeout(timer); pending.delete(id); reject(error); } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
  const environment = await call("wls_test_env_check", {});
  assert.equal(environment.result.structuredContent.checks.root, root);
  const audited = await call("wls_test_audit", { target: "sample.spec.js", runId: "native-env-root" });
  const result = audited.result.structuredContent;
  assert.equal(result.runId, "native-env-root"); assert.equal(result.execution.validationStatus, "failed");
  assert.equal(fs.existsSync(path.resolve(root, result.execution.recordPath)), true);
  assert.deepEqual(fs.readdirSync(cwd), [], "launcher cwd must not receive project evidence or files");
});

test("invalid env project roots fail startup without falling back or writing", t => {
  const cwd = fixture(t), selected = fixture(t), file = path.join(selected, "not-a-directory"); fs.writeFileSync(file, "user bytes");
  for (const invalid of ["", "relative/project", path.join(selected, "missing"), file]) {
    const child = spawnSync(process.execPath, [entry], { cwd, env: { ...process.env, WL_PROJECT_ROOT: invalid }, input: "", encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 1, child.stderr); assert.match(child.stderr, /WL_PROJECT_ROOT/); assert.equal(child.stdout, "");
    assert.deepEqual(fs.readdirSync(cwd), []);
  }
  assert.equal(fs.readFileSync(file, "utf8"), "user bytes");
});
