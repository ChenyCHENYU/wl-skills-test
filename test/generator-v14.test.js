/**
 * v0.14.0 生成器回归 — 稳定 ID / 基线去重 / UI 适配层 / 批量字段合并 / 路由归一
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateFineGrainedCases } from "../lib/case-fine-gen.js";
import { generateE2eScaffold } from "../lib/e2e-generator.js";
import { consumeContract } from "../lib/contract-consumer.js";
import { generateTestCaseMatrix } from "../lib/contract-consumer.js";

const TMP = join(process.cwd(), ".tmp-gen-v14");

function setupTmp() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

const KIT_CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  resource: { contractId: "v14", module: "order", entity: "Order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage" },
    create: { method: "POST", externalPath: "/order/save" },
  },
  models: {
    createRequest: [
      { name: "orderNo", description: "订单号", required: true, type: "string", constraints: { maxLength: 32 } },
      { name: "amount", description: "金额", required: true, type: "number" },
    ],
  },
  transport: { successCode: 2000 },
};

// ── FG 内容哈希稳定 ID ──
test("v14: FG 用例 ID 内容哈希——重复生成稳定，契约增删字段不漂移", () => {
  const summary = (extraFields) => {
    const c = JSON.parse(JSON.stringify(KIT_CONTRACT));
    c.models.createRequest = [...c.models.createRequest, ...extraFields];
    writeFileSync(join(TMP, "c.json"), JSON.stringify(c));
    return consumeContract(join(TMP, "c.json")).summary;
  };
  setupTmp();
  try {
    const a = generateFineGrainedCases(summary([]));
    const b = generateFineGrainedCases(summary([]));
    assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id), "同一契约两次生成 ID 必须一致");

    // 头部插入一个新字段：既有字段的用例 ID 不变（位置编号会全体漂移）
    const shifted = generateFineGrainedCases(summary([{ name: "newField", description: "新字段", required: true, type: "string" }]));
    const byTitle = (cases) => new Map(cases.map((c) => [c.title, c.id]));
    const mapA = byTitle(a);
    let stable = 0;
    for (const c of shifted) {
      if (mapA.has(c.title) && mapA.get(c.title) === c.id) stable++;
    }
    assert.ok(stable >= a.length - 1, `插入字段后既有用例 ID 应保持稳定（${stable}/${a.length}）`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 基线矩阵与细粒度必填去重 ──
test("v14: 基线必填校验覆盖的字段不再重复生成 field-required 细粒度用例", () => {
  setupTmp();
  writeFileSync(join(TMP, "c.json"), JSON.stringify(KIT_CONTRACT));
  try {
    const result = consumeContract(join(TMP, "c.json"));
    const baseline = generateTestCaseMatrix(result.summary);
    // 基线已含「orderNo 必填校验」「amount 必填校验」
    assert.ok(baseline.some((c) => String(c.name).includes("orderNo 必填校验")));
    assert.ok(baseline.some((c) => String(c.name).includes("amount 必填校验")));
    const fine = generateFineGrainedCases(result.summary);
    // 模拟 generation.js 的合并去重逻辑（基线名格式「实体 - 字段 必填校验」）
    const requiredCovered = new Set(
      baseline.map((c) => String(c.name).match(/(\S+)\s+必填校验/)?.[1]).filter(Boolean),
    );
    const merged = fine.filter((c) => !(c.dimension === "field-required" && requiredCovered.has(c.field)));
    assert.equal(merged.filter((c) => c.dimension === "field-required").length, 0, "被基线覆盖的 field-required 应全部剔除");
    assert.ok(merged.some((c) => c.dimension === "field-type"), "未被基线覆盖的维度保留");
    assert.ok(merged.some((c) => c.dimension === "field-length"), "未被基线覆盖的维度保留");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── UI 适配层校验与自定义注入 ──
test("v14: 未知 UI 适配直接报错（不再静默回退 element-plus）", () => {
  setupTmp();
  writeFileSync(join(TMP, "spec.json"), JSON.stringify({ page: "订单", mode: "LIST", dir: "/views/order" }));
  try {
    assert.throws(() => generateE2eScaffold(join(TMP, "spec.json"), { outputDir: join(TMP, "e2e"), ui: "antd" }), /未知 UI 适配/);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v14: options.selectors 注入自定义适配层并消除 .el-* 泄漏", () => {
  setupTmp();
  writeFileSync(
    join(TMP, "spec.json"),
    JSON.stringify({
      page: "订单",
      mode: "LIST",
      dir: "/views/order",
      columns: [{ name: "orderNo", label: "订单号" }],
      query: [{ name: "orderNo", label: "订单号" }],
      formSections: [{ name: "basic", fields: [{ name: "orderNo", required: true, label: "订单号" }] }],
    }),
  );
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(join(TMP, "spec.json"), {
      outputDir: outDir,
      ui: "naive-ui",
      selectors: {
        gridWait: ".n-data-table",
        row: ".n-data-table-tr",
        queryForm: ".n-form-item, form",
        toolbarButton: ".n-button, button",
        messageBoxConfirm: ".n-dialog .n-button--primary",
      },
    });
    const selectors = readFileSync(join(outDir, "support", "selectors.js"), "utf-8");
    assert.ok(selectors.includes('ADAPTERS["naive-ui"]'), "自定义适配层应注入 ADAPTERS");
    assert.ok(selectors.includes(".n-data-table"));
    // 生成的 spec 查询表单定位经适配层键（保留缺省 fallback，但主路径走 sel.queryForm）
    const detail = readFileSync(join(outDir, "tests", "round1-detail.spec.js"), "utf-8");
    assert.ok(detail.includes("sel.queryForm"), "fillQueryInput 应使用适配层键");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 批量模式表单字段合并（first-wins 修复）──
test("v14: 批量目录第二个 spec 的表单字段不再被首个 spec 屏蔽", () => {
  setupTmp();
  // spec1 无 formSections；spec2 有——旧实现 first-wins 导致 round2 退化为 API 级
  writeFileSync(join(TMP, "a.page-spec.json"), JSON.stringify({ page: "页面A", mode: "LIST", dir: "/views/a" }));
  writeFileSync(
    join(TMP, "b.page-spec.json"),
    JSON.stringify({
      page: "页面B",
      mode: "LIST",
      dir: "/views/b",
      formSections: [{ name: "basic", fields: [{ name: "heatNo", required: true, label: "炉号" }] }],
    }),
  );
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(TMP, { outputDir: outDir });
    const round2 = readFileSync(join(outDir, "tests", "round2-write.spec.js"), "utf-8");
    assert.ok(round2.includes("UI 级数据闭环"), "应生成 UI 级 round2（含表单字段）");
    assert.ok(round2.includes("placeholder"), "应含表单填充行");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

// ── 路由与警告 ──
test("v14: Windows 反斜杠 dir 推导归一为 / 路由", () => {
  setupTmp();
  writeFileSync(join(TMP, "spec.json"), JSON.stringify({ page: "订单", mode: "LIST", dir: "src\\views\\order" }));
  const outDir = join(TMP, "e2e");
  try {
    generateE2eScaffold(join(TMP, "spec.json"), { outputDir: outDir });
    const pages = readFileSync(join(outDir, "fixtures", "pages.js"), "utf-8");
    assert.ok(pages.includes("/order"), `路由应归一为 /order: ${pages.slice(0, 400)}`);
    assert.ok(!pages.includes("\\\\"), "路由不得包含反斜杠");
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});

test("v14: 目录含无效 page-spec 时生成警告而非静默丢弃", () => {
  setupTmp();
  writeFileSync(join(TMP, "good.page-spec.json"), JSON.stringify({ page: "好页面", mode: "LIST", dir: "/views/good" }));
  writeFileSync(join(TMP, "broken.page-spec.json"), "{ 这不是 json");
  const outDir = join(TMP, "e2e");
  try {
    const result = generateE2eScaffold(TMP, { outputDir: outDir });
    assert.equal(result.pages.length, 1);
    assert.ok(result.warnings.some((w) => w.includes("broken.page-spec.json")), `应警告无效 spec: ${result.warnings.join("|")}`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
});
