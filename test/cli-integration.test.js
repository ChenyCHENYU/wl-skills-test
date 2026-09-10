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

// Windows 下 spawn 句柄/杀软扫描可能短暂占用目录，rmSync 需重试容错
function rmForce(p) {
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // sleep 200ms
    }
  }
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    cwd: opts.cwd || process.cwd(),
    timeout: 30000,
  });
}

function setupTmp() {
  if (existsSync(TMP)) rmForce(TMP);
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

test("CLI: run-gen 无参数显示用法并以退出码 2 结束（用法错误）", () => {
  const r = runCli(["run-gen"]);
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
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
    rmForce(TMP);
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
    rmForce(TMP);
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
    rmForce(TMP);
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
    rmForce(TMP);
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
    rmForce(TMP);
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
    rmForce(TMP);
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
    rmForce(TMP);
  }
});

test("CLI: init --dry-run 不写文件", () => {
  setupTmp();
  try {
    const r = runCli(["init", "--dry-run"], { cwd: TMP });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("预览"));
  } finally {
    rmForce(TMP);
  }
});

test("CLI: doctor 正常退出", () => {
  setupTmp();
  // doctor 必需项含 .github/standards 与 .github/skills 目录，构造合法环境
  mkdirSync(join(TMP, ".github", "standards"), { recursive: true });
  mkdirSync(join(TMP, ".github", "skills"), { recursive: true });
  try {
    const r = runCli(["doctor"], { cwd: TMP });
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("环境体检"));
    assert.ok(r.stdout.includes("环境就绪"));
  } finally {
    rmForce(TMP);
  }
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
    rmForce(TMP);
    rmForce(join(process.cwd(), "test-reports"));
  }
});

test("CLI: report 自动发现 + 索引 + 历史产出（test-reports/ 目录约定）", () => {
  setupTmp();
  const reportsDir = join(TMP, "test-reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, "api-result.json"),
    JSON.stringify({ summary: { entity: "X", total: 2, passed: 2, failed: 0, errors: 0, skipped: 0, passRate: 100, decision: "通过（可转测）" }, results: [] }),
  );
  writeFileSync(join(reportsDir, "playwright-result.json"), JSON.stringify({ summary: { passed: 8, failed: 0, skipped: 0, total: 8 } }));
  try {
    // 不传任何来源 → 自动发现（cwd=TMP）
    const r = runCli(["report", "--trend"], { cwd: TMP });
    assert.equal(r.status, 0, `stdout: ${r.stdout}`);
    assert.ok(r.stdout.includes("自动发现维度结果"), r.stdout);
    assert.ok(existsSync(join(reportsDir, "测试报告.md")));
    assert.ok(existsSync(join(reportsDir, "index.md")));
    assert.ok(existsSync(join(reportsDir, "history.jsonl")));
    const md = readFileSync(join(reportsDir, "测试报告.md"), "utf-8");
    assert.ok(md.includes("具备上线条件"));
    assert.ok(md.includes("API 接口冒烟"));
    assert.ok(md.includes("UI 自动化"));
    const idx = readFileSync(join(reportsDir, "index.md"), "utf-8");
    assert.ok(idx.includes("api-报告.md") || idx.includes("api-result.json") || idx.includes("测试报告.md"));
    // 二次运行 → 趋势出现两行历史
    runCli(["report", "--trend"], { cwd: TMP });
    const md2 = readFileSync(join(reportsDir, "测试报告.md"), "utf-8");
    assert.ok(md2.includes("运行趋势"), "第二次运行应含趋势");
  } finally {
    rmForce(TMP);
  }
});

test("CLI: audit 默认产出审计维度报告到 test-reports/", () => {
  setupTmp();
  const good = join(TMP, "good.spec.js");
  writeFileSync(
    good,
    `import { test, expect } from "@playwright/test";\ntest.beforeEach(async ({ page }) => {});\ntest.afterEach(async ({ page }) => {});\ntest("should display list", async ({ page }) => {\n  await expect(page.locator("table")).toBeVisible();\n});\n`,
  );
  try {
    const r = runCli(["audit", "--target", TMP], { cwd: TMP });
    assert.equal(r.status, 0, `stdout: ${r.stdout}`);
    const reportsDir = join(TMP, "test-reports");
    assert.ok(existsSync(join(reportsDir, "audit-报告.md")), "应产出审计维度报告");
    assert.ok(existsSync(join(reportsDir, "audit-result.json")));
    const md = readFileSync(join(reportsDir, "audit-报告.md"), "utf-8");
    assert.ok(md.includes("测试代码审计报告"));
    assert.ok(md.includes("T1-T25"));
  } finally {
    rmForce(TMP);
  }
});

test("CLI: run-gen --granularity field 生成细粒度用例", () => {
  setupTmp();
  const contract = join(TMP, "contract.json");
  writeFileSync(contract, JSON.stringify(SAMPLE_CONTRACT));
  const output = join(TMP, "cases.md");
  try {
    const r = runCli(["run-gen", "--contract", contract, "--granularity", "field", "--output", output]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const md = readFileSync(output, "utf-8");
    assert.ok(md.includes("TC-"), "应含基线矩阵");
    assert.ok(md.includes("细粒度用例"), "应含细粒度章节");
    assert.ok(md.includes("FG-"), "应含 FG- 编号用例");
    assert.ok(md.includes("run-api"), "应标注 DAG 执行映射");
    assert.ok(r.stdout.includes("细粒度"), "控制台应提示细粒度统计");
  } finally {
    rmForce(TMP);
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
    rmForce(TMP);
  }
});
