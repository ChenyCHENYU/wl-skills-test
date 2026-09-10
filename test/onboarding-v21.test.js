/**
 * v0.21.0 接入故事回归 — OpenAPI→契约转换 / gen-contract CLI / setup 探测 / onboarding Skill
 * 注：网络路径（URL 源/probeSwagger）在测试进程内验证（Windows 对子进程出网有杀软延迟，非功能问题）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, "..", "bin", "wl-skills-test.js");
const TMP = join(process.cwd(), ".tmp-v21");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}
function runCli(args, cwd = TMP) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf-8", cwd, timeout: 30000 });
}

const OPENAPI = {
  openapi: "3.0.1",
  paths: {
    "/order/queryPage": {
      post: {
        tags: ["订单管理"],
        summary: "分页查询订单",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/OrderQueryRequest" } } } },
        responses: { "200": { description: "OK" } },
      },
    },
    "/order/save": {
      post: {
        tags: ["订单管理"],
        summary: "新增订单",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/OrderSaveRequest" } } } },
        responses: { "200": { description: "OK" } },
      },
    },
    "/order/getById/{id}": { get: { tags: ["订单管理"], summary: "按主键查询", responses: { "200": { description: "OK" } } } },
    "/order/updateById": { put: { tags: ["订单管理"], summary: "更新订单", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/OrderSaveRequest" } } } }, responses: { "200": { description: "OK" } } } },
    "/order/deleteById/{id}": { delete: { tags: ["订单管理"], summary: "删除订单", responses: { "200": { description: "OK" } } } },
    "/order/export": { get: { tags: ["订单管理"], summary: "导出（不应映射为 CRUD）", responses: { "200": { description: "OK" } } } },
  },
  components: {
    schemas: {
      OrderQueryRequest: { type: "object", properties: { current: { type: "integer" }, size: { type: "integer" } } },
      OrderSaveRequest: {
        type: "object",
        required: ["orderNo", "orderName", "amount"],
        properties: {
          orderNo: { type: "string", maxLength: 32, description: "订单号" },
          orderName: { type: "string", maxLength: 20, description: "订单名" },
          amount: { type: "number", minimum: 0, maximum: 100000 },
          status: { type: "string", enum: ["S1", "S2"], description: "状态" },
        },
      },
    },
  },
};

test("v21: importOpenApi 转换 springdoc 规范 → 通过校验的契约（字段约束全保留）", async () => {
  setupTmp();
  const file = join(TMP, "openapi.json");
  writeFileSync(file, JSON.stringify(OPENAPI));
  try {
    const { importOpenApi } = await import(pathToFileURL(join(__dirname, "..", "lib", "swagger-import.js")).href);
    const { validateContractFile } = await import(pathToFileURL(join(__dirname, "..", "lib", "contract-validate.js")).href);
    const { contract, warnings, unmatched } = await importOpenApi(file);

    assert.equal(contract.resource.module, "order");
    assert.equal(contract.resource.entity, "订单管理");
    assert.equal(Object.keys(contract.operations).length, 5, "五操作齐");
    assert.equal(contract.operations.create.externalPath, "/order/save");
    assert.equal(contract.operations.detail.externalPath, "/order/getById/{id}");

    const fields = contract.models.createRequest;
    const orderNo = fields.find((f) => f.name === "orderNo");
    assert.equal(orderNo.required, true);
    assert.equal(orderNo.constraints.maxLength, 32, "maxLength 应保留（超长负例的来源）");
    const amount = fields.find((f) => f.name === "amount");
    assert.equal(amount.type, "number");
    assert.equal(amount.constraints.min, 0);
    const status = fields.find((f) => f.name === "status");
    assert.deepEqual(status.enumValues, ["S1", "S2"], "枚举应保留（dict/非法枚举负例的来源）");

    assert.ok(unmatched.some((u) => u.includes("/order/export")), "export 不该被误映射");
    assert.ok(warnings.some((w) => w.includes("successCode")), "应提示业务成功码需人工核对");

    writeFileSync(join(TMP, "c.json"), JSON.stringify(contract));
    assert.equal(validateContractFile(join(TMP, "c.json")).valid, true);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v21: importOpenApi 支持 URL 源（进程内验证网络路径）", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/v3/api-docs") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(OPENAPI));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { importOpenApi } = await import(pathToFileURL(join(__dirname, "..", "lib", "swagger-import.js")).href);
    const { contract } = await importOpenApi(`http://127.0.0.1:${server.address().port}/v3/api-docs`);
    assert.equal(contract._source.type, "openapi-url");
    assert.equal(Object.keys(contract.operations).length, 5);
  } finally {
    server.close();
  }
});

test("v21: gen-contract CLI — 文件源写契约 + 核对提示 + 不覆盖保护", () => {
  setupTmp();
  const file = join(TMP, "openapi.json");
  writeFileSync(file, JSON.stringify(OPENAPI));
  try {
    const r = runCli(["gen-contract", "--swagger", file]);
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.ok(existsSync(join(TMP, "wl-contract.json")));
    assert.ok(r.stdout.includes("需人工核对"));
    assert.ok(r.stdout.includes("validate-contract"));

    const again = runCli(["gen-contract", "--swagger", file]);
    assert.equal(again.status, 1);
    assert.ok(again.stderr.includes("--force"));

    const forced = runCli(["gen-contract", "--swagger", file, "--force", "--module", "order"]);
    assert.equal(forced.status, 0, forced.stderr);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v21: probeSwagger 探测 springdoc 端点（进程内验证网络路径）", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/v3/api-docs") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(OPENAPI));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const { probeSwagger } = await import(pathToFileURL(join(__dirname, "..", "lib", "cli", "commands", "setup.js")).href);
    const hit = await probeSwagger(`http://127.0.0.1:${server.address().port}`);
    assert.equal(hit.ok, true);
    assert.ok(hit.url.endsWith("/v3/api-docs"));
    const miss = await probeSwagger("http://127.0.0.1:1");
    assert.equal(miss.ok, false);
  } finally {
    server.close();
  }
});

test("v21: setup 对 Java + api.md 项目：形态识别/文档源/配置骨架/AI 接入指令", () => {
  setupTmp();
  writeFileSync(join(TMP, "pom.xml"), "<project/>");
  writeFileSync(join(TMP, "api.md"), "# 订单接口\n## POST /order/save\n");
  mkdirSync(join(TMP, ".github", "standards"), { recursive: true });
  try {
    const r = runCli(["setup"]);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes("Java（Maven"), r.stdout);
    assert.ok(r.stdout.includes("接口文档"), "应识别 api.md 来源");
    assert.ok(r.stdout.includes("已安装"));
    assert.ok(existsSync(join(TMP, "wl-test.config.json")));
    const cfg = JSON.parse(readFileSync(join(TMP, "wl-test.config.json"), "utf-8"));
    assert.equal(cfg.auth.usernameEnv, "WL_USER");
    assert.equal(cfg.profiles.sit.token, "$WL_TOKEN");
    assert.ok(r.stdout.includes("onboarding/test-onboarding"), "AI 接入指令应引用 Skill");
    assert.ok(r.stdout.includes("validate-contract"));
    assert.ok(r.stdout.includes("run-api"));

    // 二次运行不覆盖配置
    const cfgPath = join(TMP, "wl-test.config.json");
    writeFileSync(cfgPath, JSON.stringify({ profiles: { default: { baseUrl: "http://custom" } } }));
    const r2 = runCli(["setup"]);
    assert.equal(r2.status, 0);
    assert.ok(r2.stdout.includes("不覆盖"));
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v21: setup 对无 Swagger/api.md 的项目给出诚实结论与引导", () => {
  setupTmp();
  try {
    const r = runCli(["setup"]);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes("未发现"));
    assert.ok(r.stdout.includes("与后端确认接口定义来源"), "应引导确认来源而非编造");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v21: 第 13 个 Skill test-onboarding 安装内容含 SOP 与工具绑定", () => {
  const skillPath = join(__dirname, "..", "files", ".github", "skills", "onboarding", "test-onboarding", "SKILL.md");
  assert.ok(existsSync(skillPath), "Skill 文件应存在");
  const content = readFileSync(skillPath, "utf-8");
  assert.ok(content.startsWith("---") && content.includes("name: test-onboarding"), "frontmatter 应合法");
  assert.ok(content.includes("gen-contract"), "SOP 应绑定 gen-contract 工具");
  assert.ok(content.includes("validate-contract"));
  assert.ok(content.includes("run-api"));
  assert.ok(content.includes("不得把明文密码"), "安全边界应写死");
});

test("v21: init 会把 onboarding Skill 装进目标项目", () => {
  setupTmp();
  try {
    const r = runCli(["init"], TMP);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(TMP, ".github", "skills", "onboarding", "test-onboarding", "SKILL.md")), "init 后 Skill 应就位");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
