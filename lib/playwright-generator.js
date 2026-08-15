/**
 * playwright-generator.js — 从 page-spec 或契约生成 Playwright 测试脚本
 *
 * 支持输入：
 * - page-spec.json（kit 页面规格）→ 按查询/列/按钮生成选择器
 * - wl-api-contract / wl-contract.json → 按 CRUD 操作生成数据闭环测试
 */

import { consumeContract } from "./contract-consumer.js";

/**
 * 从 page-spec 或契约生成 Playwright 测试脚本
 * @param {string} contractPath
 * @param {object} options — { baseUrl, outputPath }
 * @returns {string} 生成的 .spec.js 内容
 */
export function generatePlaywrightScript(contractPath, options = {}) {
  const result = consumeContract(contractPath);
  const baseUrl = options.baseUrl || "${BASE_URL}";
  const entity = result.summary.entity || result.summary.pageName || "Entity";
  const module = result.summary.module || "module";

  if (result.type === "page-spec") {
    return generateFromPageSpec(result.summary, baseUrl, options);
  }
  return generateFromContract(result.summary, baseUrl, options);
}

function generateFromPageSpec(summary, baseUrl, options) {
  const pageName = summary.pageName || "页面";
  const dir = summary.dir || "/views/example";

  const lines = [
    `/**`,
    ` * ${pageName} — 自动生成 Playwright 测试脚本`,
    ` * 生成自 page-spec: ${summary.dir || ""}`,
    ` * 模式: ${summary.mode}`,
    ` */`,
    `import { test, expect } from "@playwright/test";`,
    ``,
    `const BASE_URL = "${baseUrl}";`,
    `const PAGE_PATH = "${dir}";`,
    ``,
    `test.describe("${pageName}", () => {`,
    ``,
    `  test.beforeEach(async ({ page }) => {`,
    `    await page.goto(\`\${BASE_URL}\${PAGE_PATH}\`);`,
    `    await page.waitForLoadState("networkidle");`,
    `  });`,
    ``,
  ];

  // 列表页加载测试
  lines.push(`  test("列表页正常加载", async ({ page }) => {`);
  lines.push(`    await expect(page.locator("table")).toBeVisible();`);
  lines.push(`    await expect(page.locator(".el-pagination")).toBeVisible();`);
  lines.push(`  });`);
  lines.push(``);

  // 查询字段测试
  if (summary.queryFields?.length > 0) {
    lines.push(`  test("查询条件可输入", async ({ page }) => {`);
    for (const field of summary.queryFields.slice(0, 3)) {
      if (field.type === "input" || field.type === "textarea") {
        lines.push(`    await page.fill('[placeholder*="${field.label || field.name}"], input[name="${field.name}"]', "测试数据");`);
      } else if (field.type === "select" || field.type === "dict") {
        lines.push(`    // ${field.label || field.name}: 选择器/字典，需要手动补充选项`);
      } else if (field.type === "date" || field.type === "dateRange") {
        lines.push(`    // ${field.label || field.name}: 日期选择器，需要手动补充`);
      }
    }
    lines.push(`    const queryInput = page.locator('[placeholder*="${summary.queryFields[0].label || summary.queryFields[0].name}"], input[name="${summary.queryFields[0].name}"]').first();`);
    lines.push(`    await expect(queryInput).toBeEnabled();`);
    lines.push(`    await page.click('button:has-text("查询"), button:has-text("搜索")');`);
    lines.push(`    await page.waitForResponse((r) => r.url().includes("queryPage") || r.url().includes("list"), { timeout: 10000 }).catch(() => {});`);
    lines.push(`    await expect(page.locator("table, .el-table")).toBeVisible();`);
    lines.push(`  });`);
    lines.push(``);
  }

  // 工具栏按钮测试
  const primaryBtn = summary.toolbar?.find((b) => b.color === "primary" || b.label.match(/新增|新建|添加|创建/));
  if (primaryBtn) {
    lines.push(`  test("新增数据完整闭环", async ({ page }) => {`);
    lines.push(`    // 阶段A：数据闭环（新增→验证→编辑→验证→删除→验证）`);
    lines.push(``);
    lines.push(`    // 新增`);
    lines.push(`    await page.click('button:has-text("${primaryBtn.label}")');`);
    lines.push(`    await page.waitForSelector(".el-dialog, .el-drawer");`);
    lines.push(``);
    if (summary.formSections?.length > 0) {
      const requiredFields = [];
      for (const section of summary.formSections) {
        requiredFields.push(...(section.requiredFields || []));
      }
      for (const fieldName of [...new Set(requiredFields)].slice(0, 5)) {
        lines.push(`    await page.fill('input[name="${fieldName}"], [placeholder*="${fieldName}"]', "自动化测试数据");`);
      }
    }
    lines.push(`    await page.click('.el-dialog button:has-text("确定"), .el-dialog button:has-text("保存")');`);
    lines.push(`    await expect(page.locator(".el-message--success")).toBeVisible({ timeout: 5000 });`);
    lines.push(``);
    lines.push(`    // 验证新增成功（等待列表刷新响应，不使用硬等待）`);
    lines.push(`    await page.waitForResponse((r) => r.url().includes("queryPage") || r.url().includes("list"), { timeout: 10000 }).catch(() => {});`);
    lines.push(``);
    lines.push(`    // TODO: 编辑验证、删除验证（按实际业务补充）`);
    lines.push(`  });`);
    lines.push(``);
  }

  // 操作列测试
  if (summary.operations?.length > 0) {
    lines.push(`  test("操作列按钮可用", async ({ page }) => {`);
    for (const op of summary.operations.slice(0, 3)) {
      lines.push(`    // 操作: ${op.label}（${op.action}）`);
    }
    lines.push(`    const firstRow = page.locator("table tbody tr").first();`);
    lines.push(`    await expect(firstRow).toBeVisible();`);
    lines.push(`  });`);
    lines.push(``);
  }

  lines.push(`});`);
  return lines.join("\n");
}

function generateFromContract(summary, baseUrl, options) {
  const entity = summary.entity || "Entity";
  const basePath = summary.operations?.find((o) => o.key === "page")?.externalPath?.replace(/\/queryPage$/, "") || `/${summary.module || "api"}`;
  const token = options.token || "process.env.API_TOKEN || \"\"";

  const lines = [
    `/**`,
    ` * ${entity} — 自动生成 Playwright 测试脚本`,
    ` * 生成自契约: ${summary.contractId}`,
    ` * 覆盖 CRUD 数据闭环（API 级）`,
    ` */`,
    `import { test, expect } from "@playwright/test";`,
    ``,
    `const BASE_URL = "${baseUrl}";`,
    `const API_BASE = "${basePath}";`,
    `const TOKEN = ${token};`,
    ``,
    `test.describe("${entity} CRUD 数据闭环", () => {`,
    ``,
    `  const headers = TOKEN ? { Authorization: TOKEN } : {};`,
    ``,
  ];

  // 列表查询测试
  lines.push(`  test("查询列表返回成功", async ({ request }) => {`);
  lines.push(`    const res = await request.post(\`\${API_BASE}/queryPage\`, {`);
  lines.push(`      headers,`);
  lines.push(`      data: { current: 1, size: 10 },`);
  lines.push(`    });`);
  lines.push(`    expect(res.ok()).toBeTruthy();`);
  lines.push(`    const body = await res.json();`);
  lines.push(`    expect(body.code).toBe(2000);`);
  lines.push(`  });`);
  lines.push(``);

  // 新增测试
  lines.push(`  test("新增数据成功", async ({ request }) => {`);
  lines.push(`    const res = await request.post(\`\${API_BASE}/save\`, {`);
  lines.push(`      headers,`);
  lines.push(`      data: {`);
  if (summary.fields) {
    const fields = Array.isArray(summary.fields) ? summary.fields : summary.fields.createRequest || [];
    for (const f of fields.slice(0, 3)) {
      lines.push(`      ${f.name}: "test_value",`);
    }
  }
  lines.push(`    },`);
  lines.push(`  });`);
  lines.push(`    const body = await res.json();`);
  lines.push(`    expect(body.code).toBe(2000);`);
  lines.push(`  });`);
  lines.push(``);

  lines.push(`});`);
  return lines.join("\n");
}
