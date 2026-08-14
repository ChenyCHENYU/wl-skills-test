/**
 * CLI 集成测试 — 通过 bin 入口真实执行子命令，拦截"lib 层全绿但 CLI 崩溃"的回归
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-cli-test");

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    cwd: opts.cwd || process.cwd(),
    timeout: 30000,
  });
}

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

const SAMPLE_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  protocolVersion: "1.0",
  resource: { contractId: "cli-001", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
    detail: { method: "GET", externalPath: "/order/getById/{id}", permission: "order_get_by_id" },
  },
  models: {
    createRequest: [{ name: "orderNo", description: "订单号", required: true, type: "string" }],
  },
  transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
};

test("CLI: --help 正常输出", () => {
  const r = runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes("用法"));
  assert.ok(r.stdout.includes("run-gen"));
});

test("CLI: --version 输出包版本", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  assert.ok(/\d+\.\d+\.\d+/.test(r.stdout));
});

test("CLI: run-gen 无参数显示用法（不崩溃）", () => {
  const r = runCli(["run-gen"]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("用法"), "应输出用法说明");
});

test("CLI: run-gen --contract 缺文件时报错且非零退出", () => {
  const r = runCli(["run-gen", "--contract", "./no-such-file.json"]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("不存在"));
});

test("CLI: run-gen --type cases 生成用例 Markdown", () => {
  setupTmp();
  const contract = join(TMP, "contract.json");
  const output = join(TMP, "cases.md");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const r = runCli(["run-gen", "--contract", contract, "--output", output]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(output));
    const md = readFileSync(output, "utf-8");
    assert.ok(md.includes("TC-001"));
    assert.ok(md.includes("| 序号 |"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: run-gen --type jmeter 生成 jmx", () => {
  setupTmp();
  const contract = join(TMP, "contract.json");
  const output = join(TMP, "perf.jmx");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  try {
    const r = runCli(["run-gen", "--contract", contract, "--type", "jmeter", "--output", output]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(existsSync(output));
    assert.ok(readFileSync(output, "utf-8").includes("<jmeterTestPlan"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: run-gen --type e2e 生成脚手架", () => {
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const outDir = join(TMP, "e2e");
  try {
    const r = runCli(["run-gen", "--contract", contract, "--type", "e2e", "--output", outDir]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    for (const f of [
      "playwright.config.js",
      "support/environment.js",
      "support/network-monitor.js",
      "support/run-ledger.js",
      "support/api-probe.js",
      "support/cleanup.js",
      "tests/round1-readonly.spec.js",
      "tests/round2-write.spec.js",
      "tests/cleanup.spec.js",
      "README.md",
    ]) {
      assert.ok(existsSync(join(outDir, f)), `应生成 ${f}`);
    }
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: audit 审计不通过时非零退出（CI 卡门）", () => {
  setupTmp();
  const bad = join(TMP, "bad.spec.js");
  writeFileSync(
    bad,
    `import { test } from "@playwright/test";\ntest("随便测", async ({ page }) => {\n  await page.goto("https://prod.example.com/x");\n});\n`,
  );
  try {
    const r = runCli(["audit", "--target", TMP]);
    assert.notEqual(r.status, 0, "存在 error 级违规时应非零退出");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: audit 审计通过时零退出", () => {
  setupTmp();
  const good = join(TMP, "good.spec.js");
  writeFileSync(
    good,
    `import { test, expect } from "@playwright/test";\ntest.beforeEach(async ({ page }) => {});\ntest.afterEach(async ({ page }) => {});\ntest("should display list", async ({ page }) => {\n  await expect(page.locator("table")).toBeVisible();\n});\n`,
  );
  try {
    const r = runCli(["audit", "--target", TMP]);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: fix --dry-run 不写文件", () => {
  setupTmp();
  const bad = join(TMP, "bad.spec.js");
  const original = `import { test } from "@playwright/test";\ntest("随便测", async ({ page }) => {\n  await page.waitForTimeout(3000);\n});\n`;
  writeFileSync(bad, original);
  try {
    const r = runCli(["fix", "--target", bad, "--dry-run"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(readFileSync(bad, "utf-8"), original, "dry-run 不应修改文件");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: init --dry-run 不写文件", () => {
  setupTmp();
  try {
    const r = runCli(["init", "--dry-run"], { cwd: TMP });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("预览"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: doctor 正常退出", () => {
  const r = runCli(["doctor"]);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.stdout.includes("环境体检"));
});

test("CLI: 未知命令非零退出", () => {
  const r = runCli(["no-such-command"]);
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("未知命令") || r.stdout.includes("未知命令"));
});
