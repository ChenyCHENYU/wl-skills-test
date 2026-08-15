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
      "package.json",
      "fixtures/pages.js",
      "fixtures/suites.js",
      "support/environment.js",
      "support/network-monitor.js",
      "support/run-ledger.js",
      "support/api-probe.js",
      "support/cleanup.js",
      "tests/auth-setup.spec.js",
      "tests/round1-readonly.spec.js",
      "tests/ui-contract.spec.js",
      "tests/round2-write.spec.js",
      "tests/quarantine.spec.js",
      "tests/cleanup.spec.js",
      "README.md",
    ]) {
      assert.ok(existsSync(join(outDir, f)), `应生成 ${f}`);
    }
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: e2e-check 对生成脚手架通过，注入 test.only 后拦截", async () => {
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const outDir = join(TMP, "e2e");
  try {
    runCli(["run-gen", "--contract", contract, "--type", "e2e", "--output", outDir]);
    // 干净脚手架 → 通过（退出码 0）
    const ok = runCli(["e2e-check", "--target", outDir]);
    assert.equal(ok.status, 0, `stdout: ${ok.stdout}`);

    // 注入 test.only → 拦截（退出码 1）
    const spec = join(outDir, "tests", "round1-readonly.spec.js");
    writeFileSync(spec, readFileSync(spec, "utf-8") + '\ntest.only("验证only假闭环", async () => {});\n', "utf-8");
    const bad = runCli(["e2e-check", "--target", outDir]);
    assert.notEqual(bad.status, 0);
    assert.ok((bad.stdout + bad.stderr).includes("test.only"));
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

test("CLI: gate 聚合卡门（通过场景零退出）", () => {
  setupTmp();
  writeFileSync(join(TMP, "smoke.json"), JSON.stringify({ summary: { passRate: 100 } }));
  try {
    const r = runCli(["gate", "--smoke-result", join(TMP, "smoke.json")]);
    assert.equal(r.status, 0, `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes("质量门通过"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("CLI: report --webhook 推送结论到指定地址", async () => {
  setupTmp();
  const api = join(TMP, "api.json");
  writeFileSync(
    api,
    JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过（可转测）" }, results: [] }),
  );
  const output = join(TMP, "报告.md");
  let received = null;
  const { createServer } = await import("node:http");
  const { spawn } = await import("node:child_process");
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const hook = `http://127.0.0.1:${server.address().port}/hook`;
  try {
    // 异步 spawn（spawnSync 会阻塞父进程事件循环，mock server 无法响应）
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [BIN, "report", "--api", api, "--output", output, "--webhook", hook]);
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ status: code, stdout: out }));
    });
    assert.equal(r.status, 0, `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes("webhook 已推送"), r.stdout);
    assert.ok(received, "mock webhook 应收到 POST");
    assert.ok(JSON.stringify(received).includes("上线条件"));
  } finally {
    server.close();
    rmSync(TMP, { recursive: true, force: true });
  }
});
