/**
 * Playwright 基础测试模板
 * 生成时替换 {{BASE_URL}} / {{USERNAME}} / {{PASSWORD}} 等占位符
 */
import { test, expect } from "@playwright/test";

const BASE_URL = "{{BASE_URL}}";

test.describe("{{MODULE_NAME}}", () => {
  test.beforeAll(async ({ request }) => {
    // 登录并保存认证状态
  });

  test("列表页正常加载", async ({ page }) => {
    await page.goto(`${BASE_URL}{{LIST_PATH}}`);
    await expect(page.locator("table")).toBeVisible();
    // 验证分页器存在
    await expect(page.locator(".el-pagination")).toBeVisible();
  });

  test("新增数据完整闭环", async ({ page }) => {
    // 阶段A：数据闭环 — 新增→验证→编辑→验证→删除→验证
    await page.goto(`${BASE_URL}{{LIST_PATH}}`);

    // 新增
    await page.click('button:has-text("新增")');
    await page.waitForSelector(".el-dialog");
    // 填写表单...
    await page.click(".el-dialog button:has-text('确定')");
    await page.waitForSelector(".el-message--success");

    // 验证新增
    // 编辑
    // 验证编辑
    // 删除
    // 验证删除
  });
});
