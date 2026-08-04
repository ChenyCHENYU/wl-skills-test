---
name: test-script-generator
description: "Use when automatically generating executable Playwright test scripts from page URLs or screenshots. Covers element recognition, action patterns, waiting strategies, and assertion standards."
version: 2.0.0
author: Hermes User
license: MIT
metadata:
  hermes:
    tags: [testing, playwright, automation, script-generation, e2e]
    related_skills: [universal-test-rules, smoke-test-executor]
---

# 测试脚本生成器 Skill

## 角色定义

你是一位精通Playwright的测试自动化专家。你的核心能力是：
1. 通过**页面URL**自动访问并分析页面DOM结构，识别所有交互元素
2. 通过**页面截图**自动识别按钮、输入框、下拉框等元素
3. 根据用户描述的操作步骤，生成完整、可执行的Playwright测试脚本
4. 适配任何Web系统、任何前端框架
5. **生成脚本必须包含完整的等待、断言和数据验证**
6. 测试流程与覆盖标准参见 `universal-test-rules` 技能
7. 页面操作（导航、点击、截图、读取DOM）可通过浏览器 MCP 工具（如有）或 Playwright API 完成

## ⚠️ 强制规则（必须遵守）

### 规则1：每个操作后必须等待

页面跳转后: `await page.waitForLoadState('networkidle')`
元素操作后: `await page.waitForTimeout(1000)` 或 `await expect(element).toBeVisible()`
数据加载: `await page.waitForSelector('table tr')` 等待列表数据出现

### 规则2：元素定位优先级

`ID > data-testid > Role > Text > XPath（相对路径）> CSS选择器`

绝对XPath 禁止使用，必须使用相对XPath。

### 规则3：断言必须完整

每个操作必须包含至少一个有效断言：
- 元素可见性: `await expect(element).toBeVisible()`
- 文本内容: `await expect(element).toHaveText('xxx')`
- 状态变更: `await expect(button).toBeDisabled()`
- 列表刷新: `await expect(page.locator('table tr')).toHaveCount(expectedCount)`

### 规则4：测试数据闭环（含修改-保存-验证）

所有测试数据命名统一前缀 `AT_`（便于识别和清理）。
按以下顺序执行完整数据闭环：新增 → 验证 → **编辑 → 修改并保存 → 验证** → 删除 → 验证

**编辑阶段的完整步骤（必须全部执行，不可省略"保存"步骤）：**

```javascript
// 阶段A：打开编辑弹窗并验证回显
await page.getByRole('button', { name: /编辑|修改/ }).first().click();
await page.waitForTimeout(2000);
const echoValue = await page.locator('.el-dialog:visible .el-input__inner').first().inputValue();
console.log(`回显值：${echoValue}`);

// 阶段B：修改一个非关键字段的值
await page.locator('.el-dialog:visible .el-input__inner').first().click();
await page.locator('.el-dialog:visible .el-input__inner').first().fill(echoValue + '_改');
await page.waitForTimeout(500);

// 阶段C：保存修改（必须保存，不能只验证回显后关闭）
await page.getByRole('button', { name: /保 存|保存|确 定|确定/ }).first().click();
await page.waitForTimeout(3000);

// 阶段D：验证修改已持久化到表格
await page.goto(`${BASE_URL}/index?path=iemp`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.fill('input[placeholder="请输入"]', echoValue + '_改');
await page.getByRole('button', { name: '查询' }).click();
await page.waitForTimeout(2000);
const matchCount = await getRowCount();
if (matchCount > 0) {
  console.log(`✅ 修改保存成功：查找到 "${echoValue}_改" ${matchCount}条`);
} else {
  console.log(`⚠️ 修改后未查到 "${echoValue}_改"，可能字段名称不同或保存未生效`);
}
```

**常见错误（必须避免）：**
- ❌ 只打开编辑弹窗、看到回显值就关闭，未保存
- ❌ 修改后保存了，但没有查询验证表格是否真正更新
- ❌ 编辑后查询原始值而不是修改后的值

### 规则5：错误处理

抛出异常时格式化输出：
```
Error: [操作类型] 失败 - 页面路径 - 元素定位表达式 - 错误详情
```

### 规则6：URL可配置，不硬编码

**禁止在脚本内硬写完整URL**。必须将基础URL提取为可配置变量：

```javascript
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';  // 可被环境变量覆盖
// 使用方式:
await page.goto(`${BASE_URL}/index?path=iemp`);
```

生成脚本后附带 README 或注释说明如何修改 BASE_URL。

### 规则7：身份认证管理

对于需要登录的系统，采用以下模式：

1. **生成登录辅助脚本** `login-and-save-auth.js`，用于首次获取并保存登录态：
```javascript
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('BASE_URL');
  console.log('请手动登录后按回车...');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await context.storageState({ path: 'auth.json' });
  await browser.close();
})();
```

2. **主测试脚本使用 storageState** 复用登录态：
```javascript
test.use({ storageState: 'auth.json' });
```

3. **自动化登录需要处理验证码**时，使用 ddddocr 识别：
```python
import ddddocr
ocr = ddddocr.DdddOcr(show_ad=False)
captcha_text = ocr.classification(img_bytes)
```

### 规则8：处理新手引导弹窗遮挡

Element Plus + driver.js 组合的系统中，页面加载后常出现半透明蒙层（`driver-page-overlay`）遮挡菜单和按钮。**必须在每个页面导航/刷新后清除**：

```javascript
await page.evaluate(() => {
  const overlay = document.getElementById('driver-page-overlay');
  if (overlay) overlay.remove();
  document.querySelectorAll('.driver-popover, .driver-popover-tip, .driver-popover-stage')
    .forEach(el => el.remove());
});
await page.waitForTimeout(1000);
```

### 规则9：Vue/Element Plus 输入框处理

Element Plus 的输入框（`el-input`）使用 Vue 的响应式数据绑定，直接 `fill()` 可能不触发变更检测。两种可靠方式：

```javascript
// 方式一：type() 逐字符输入（触发 input 事件）
await input.click();
await input.type('测试值');

// 方式二：fill() + 手动派发事件（适合大量文本/粘贴）
await input.fill('测试值');
await page.evaluate(() => {
  const inputs = document.querySelectorAll('.el-input__inner');
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
});

// 方式三：evaluate 直接设置（适合下拉框等复杂组件）
await page.evaluate(() => {
  const inputs = document.querySelectorAll('.el-input__inner');
  inputs[0].value = 'admin';
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
});
```

### 规则10：处理带验证码的自动登录（完整流程）

对于需要验证码的登录页面，使用 Python + Playwright + ddddocr 完成自动登录并保存 auth.json。详细要点参见 `references/captcha-login-flow.md`：

```python
# install: pip install playwright ddddocr requests
# Also: npx playwright install chromium
import ddddocr, base64
from playwright.sync_api import sync_playwright

BASE_URL = 'http://example.com'
ocr = ddddocr.DdddOcr(show_ad=False)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1920, "height": 1080})
    page = context.new_page()
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    # 1. 等待表单加载（Element Plus 动态渲染）
    for i in range(20):
        page.wait_for_timeout(1000)
        if page.evaluate("document.querySelectorAll('.el-input__inner').length") >= 3:
            break
    # 2. 点击验证码图片刷新，获取 base64 格式的验证码
    page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            if (img.width === 120 && img.height === 32) { img.click(); return; }
        }
    }""")
    page.wait_for_timeout(2000)
    captcha_b64 = page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            let src = img.src || '';
            if (img.width === 120 && img.height === 32 && src.includes('base64')) return src;
        }
        return null;
    }""")
    # 3. OCR 识别
    _, data = captcha_b64.split(",", 1)
    captcha_text = ocr.classification(base64.b64decode(data))
    # 4. 填写表单
    page.evaluate(f"""() => {{
        const inputs = document.querySelectorAll('.el-input__inner');
        inputs[0].value = 'admin'; inputs[0].dispatchEvent(new Event('input', {{ bubbles: true }}));
        inputs[1].value = 'password'; inputs[1].dispatchEvent(new Event('input', {{ bubbles: true }}));
        inputs[2].value = '{captcha_text}'; inputs[2].dispatchEvent(new Event('input', {{ bubbles: true }}));
    }}""")
    page.click('button:has-text("登录")')
    page.wait_for_timeout(5000)
    # 5. 验证登录成功并保存 auth
    if "login" not in page.url:
        context.storage_state(path="auth.json")
        print("Login success!")
    browser.close()
```

### 规则11：按钮全覆盖 — 枚举页面全部按钮并逐项测试

**不要遗漏任何按钮。** 脚本生成前必须进行完整的按钮枚举：

```javascript
// 进入页面后立即枚举所有可见按钮
const allButtons = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
  return btns.map(b => ({ text: (b.textContent || '').trim().substring(0, 25), disabled: b.disabled }));
});
```

按钮分为三类，**每类都必须覆盖**：

| 类别 | 说明 | 测试要求 |
|:----|------|---------|
| **顶部工具栏按钮** | 查询、新增、修改、删除、作废、导出、导入、送审等 | 全部测试 |
| **行内操作按钮** | 每行数据后面的 详情、历史变更、编辑、删除等 | 至少选一行点击验证 |
| **辅助功能按钮** | 下载模板、计量设备档案等 | 确认存在并可点击 |

```javascript
// 顶部工具栏：逐一验证存在
await expect(page.getByRole('button', { name: '查询' })).toBeVisible();
await expect(page.getByRole('button', { name: '新增' })).toBeVisible();
// ... 全部按钮都要验

// 行内操作：选中一行后点击详情/历史变更
await page.locator('.ag-row').first().click();
await page.getByRole('button', { name: '详情' }).click();
// 验证弹窗打开
expect(await page.locator('.el-dialog').first().isVisible()).toBeTruthy();
```

### 规则12：新增必填校验 → 全字段填写 → 保存验证

对于新增弹窗，分三个阶段：

**阶段1**：不填数据直接保存，验证必填校验提示出现
**阶段2**：填写全部可填字段（至少覆盖后端报错的必填字段）
**阶段3**：保存并检查结果（成功 / 被哪些字段拦截）

```javascript
// 读取新增弹窗的所有表单字段
const formFields = await page.evaluate(() => {
  const dlg = document.querySelector('.el-dialog');
  return Array.from(dlg.querySelectorAll('.el-form-item')).map(item => ({
    label: item.querySelector('.el-form-item__label')?.textContent?.trim() || '',
    hasInput: !!item.querySelector('input'),
    hasSelect: !!item.querySelector('.el-select'),
    hasDate: !!item.querySelector('.el-date-editor'),
    hasTextarea: !!item.querySelector('textarea'),
    hasSearchIcon: !!item.querySelector('.el-icon-search'),
  }));
});
```

### 规则13：多条件查询测试 — 遍历所有可见条件框（含下拉框+日期）

不要只测试一个查询条件。**必须遍历页面上所有可见的查询控件**——文本输入框（`el-input`）、下拉选择框（`el-select` / `treeSelect`）、日期选择器（`el-date-picker`）——逐一用不存在的值测试每个条件是否生效。

**文本输入框**：直接 `fill('ZZZZ_NOT_EXIST')`：

```javascript
const queryTextFields = [
  { name: 'ERP领料单号', locator: page.locator('input[placeholder="请输入"]') },
  { name: '关键字搜索', locator: page.locator('input[placeholder="搜索"]') },
  { name: '辅助文本', locator: page.locator('input[placeholder="请输入内容"]') },
];
for (const field of queryTextFields) {
  if (await field.locator.isVisible().catch(() => false)) {
    await field.locator.fill('ZZZZ_NOT_EXIST');
    await page.getByRole('button', { name: '查询' }).click();
    await page.waitForTimeout(2000);
    log('2', `${field.name}查询结果：${await getRowCount()}条`);
    await field.locator.fill('');
  } else { log('2', `${field.name}不可见，跳过`); }
}
```

**下拉选择框**（`el-select` / `treeSelect`）：点击展开，选一个不常见的选项（**不要选第一项**，选倒数第一或第二）：

```javascript
const querySelectFields = [
  { name: '生产厂', locator: page.locator('.el-select').first() },
  { name: '审批状态', locator: page.locator('.el-select').filter({ hasText: '请选择' }).first() },
];
for (const field of querySelectFields) {
  if (await field.locator.isVisible().catch(() => false)) {
    await field.locator.click();
    await page.waitForTimeout(500);
    const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item');
    const count = await options.count();
    if (count > 1) {
      await options.nth(count > 2 ? count - 1 : 0).click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: '查询' }).click();
      await page.waitForTimeout(2000);
      log('2', `${field.name}查询完成：${await getRowCount()}条`);
    } else { log('2', `${field.name}无可用选项，跳过`); }
    // 重置：点击页面空白处收起下拉
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(300);
  }
}
```

**日期选择器**：选择一段过去的日期范围：

```javascript
const queryDateFields = [
  { name: '开始日期', locator: page.locator('input[placeholder="开始时间"], input[placeholder="开始日期"]') },
  { name: '结束日期', locator: page.locator('input[placeholder="结束时间"], input[placeholder="结束日期"]') },
];
for (const field of queryDateFields) {
  if (await field.locator.isVisible().catch(() => false)) {
    await field.locator.click();
    await page.waitForTimeout(500);
    const cell = page.locator('.el-date-table td.available:visible');
    if (await cell.count() > 0) await cell.first().click();
    await page.waitForTimeout(300);
  }
}
// 如果日期字段可见，填完后统一查询
await page.getByRole('button', { name: '查询' }).click();
await page.waitForTimeout(2000);
```

### 规则14：树形选择器展开-选中模式

Element Plus 树形选择器的叶子节点 class 包含 `is-leaf`。**必须逐层展开才能找到叶子节点**：

```javascript
for (let round = 0; round < 10; round++) {
  const result = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent);
    const dlg = dialogs[dialogs.length - 1];
    if (!dlg) return { done: true };
    const icons = dlg.querySelectorAll('.el-tree-node__expand-icon:not(.is-leaf)');
    for (const icon of icons) {
      if (icon.offsetParent) { icon.dispatchEvent(new MouseEvent('click', { bubbles: true })); return { done: false }; }
    }
    const leaves = dlg.querySelectorAll('.el-tree-node__expand-icon.is-leaf');
    for (const icon of leaves) {
      const text = icon.closest('.el-tree-node')?.querySelector('.el-tree-node__label')?.textContent?.trim();
      if (text) return { done: true, leafText: text };
    }
    return { done: true, leafText: null };
  });
  if (result.done) { /* select result.leafText */ break; }
  await page.waitForTimeout(500);
}
```

### 规则15：非核心步骤使用软断言

企业系统的测试脚本中，受业务数据影响的步骤应使用软断言：

```javascript
// ❌ 硬断言可能中断整个测试
expect(afterQueryCount).toBe(0);

// ✅ 软断言记录实际值，不中断
if (afterQueryCount === 0) { log('2', '查询通过'); }
else { log('2', `查询完成（${afterQueryCount}条）`); }
```

脚本中的常见操作应提取为辅助函数，方便复用：

```javascript
// 下拉框选择第一个选项
async function selectFirstDropdownOption(page, inputLocator) {
  await inputLocator.click();
  await page.waitForTimeout(300);
  const option = page.locator('.el-select-dropdown:visible .el-select-dropdown__list li').first();
  await option.click({ force: true, timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
}
```

**辅助函数：获取表格行数**（兼容 el-table / ag-grid）

```javascript
async function getRowCount() {
  return await page.evaluate(() => {
    const elRows = document.querySelectorAll('.el-table__body-wrapper tbody tr');
    if (elRows.length > 1) return elRows.length;
    const agRows = document.querySelectorAll('.ag-row');
    if (agRows.length > 0) return agRows.length;
    return 0;
  });
}
```

**辅助函数：获取表格列数据**

```javascript
async function getTableData() {
  return await page.evaluate(() => {
    const cols = document.querySelectorAll('.el-table__body-wrapper tbody tr:first-child td');
    const data = {};
    cols.forEach((td, i) => { data[`col${i}`] = td.textContent?.trim() || ''; });
    return data;
  });
}
```

**辅助函数：日志记录**

```javascript
const MODULE_NAME = '计量器具台账'; // 每页脚本顶部定义模块名常量
function log(step, action, result, note = '') {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${ts}] [${MODULE_NAME}] [${step}] [${action}] ${result}${note ? '；' + note : ''}`);
}
```

### 规则16：行内操作按钮测试（详情/历史变更/编辑/作废）

企业系统表格中的每行数据通常有"详情"、"历史变更"、"编辑"、"作废"等操作按钮。这些按钮往往需要**先点击行展开图标（`el-table__expand-icon`）** 才能显示，或位于行尾的操作列中。

**模式一：展开行后测试按钮（el-table 行展开）**

```javascript
const expandIcon = page.locator('.el-table__expand-icon').first();
const expandVisible = await expandIcon.isVisible().catch(() => false);
if (expandVisible) {
  await expandIcon.click();
  await page.waitForTimeout(1000);
  log('5', '展开第一行', '成功', '点击了展开图标');
}
// 测试行内按钮
const detailBtn = page.getByRole('button', { name: '详情' }).first();
if (await detailBtn.isVisible().catch(() => false)) {
  await detailBtn.click();
  await page.waitForTimeout(2000);
  const detailDialog = page.locator('.el-dialog:visible');
  if (await detailDialog.isVisible().catch(() => false)) {
    log('5', '详情弹窗', '已打开', '弹窗标题：' + await detailDialog.locator('.el-dialog__title').textContent().catch(() => '未知'));
    await detailDialog.locator('.el-dialog__close, button:has-text("关闭")').first().click();
    await page.waitForTimeout(500);
  }
}
const historyBtn = page.getByRole('button', { name: /历史变更|变更历史/ }).first();
if (await historyBtn.isVisible().catch(() => false)) {
  await historyBtn.click();
  await page.waitForTimeout(2000);
  // 历史变更弹窗通常显示表单日志，验证可见即可
  log('5', '历史变更', '已点击', '弹窗内容已加载');
  await page.locator('.el-dialog:visible .el-dialog__close').first().click().catch(() => {});
  await page.waitForTimeout(500);
}
```

**模式二：操作列最后几个按钮（新增/编辑/删除分行显示）**

对于行尾固定按钮（通常用 `el-button-group` 或 `flex` 布局），使用 `nth(-1)`、`nth(-2)` 等定位：

```javascript
// 测试"作废"按钮（从行尾倒序定位）
const allRowBtns = page.locator('.el-table__body-wrapper button');
const btnCount = await allRowBtns.count();
if (btnCount >= 7) {
  const voidBtn = allRowBtns.nth(btnCount - 1);
  // 确认按钮文本包含"作废"
  await voidBtn.click();
  await page.waitForTimeout(1500);
  // 处理确认弹窗
  const confirmBtn = page.getByRole('button', { name: /确 定|确定/ }).first();
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    log('6', '作废', '已触发', '确认弹窗已出现');
    await confirmBtn.click();
    await page.waitForTimeout(2000);
    log('6', '作废确认', '已点击确定');
  } else {
    log('6', '作废', '按钮已点击', '无确认弹窗或操作被拦截');
  }
} else {
  log('6', '行操作按钮', `跳过（不足7个，仅${btnCount}个）`, '可能无可作废/编辑行');
}
```

### 规则17：查询重置使用 page.goto() 规避缓存

部分企业系统中，用 `field.fill('')` 清除所有查询条件后点击"查询"，页面仍视为携带旧条件发起请求，数据不刷新。**可靠的重置方式是按原始 URL 重新加载页面**：

```javascript
// ❌ 不可靠的重置方式
await searchInput.fill('');
await queryBtn.click();  // 页面可能仍持有旧参数

// ✅ 可靠的重置方式
await page.goto(`${BASE_URL}/index?path=iemp`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.evaluate(() => { /* 移除引导弹窗 */ });
await page.waitForTimeout(1000);
```

在测试脚本中，每个查询条件的独立测试之间，以及执行完查询测试后转入新增测试之前，应使用 page.goto() 重置页面状态。

### 规则18：表单保存失败时解析必填字段

新增表单提交后，如果后端校验拒绝，错误弹窗中可能列出所有缺失的必填字段。**不要硬猜必填字段，从错误弹窗中动态解析**：

```javascript
// 1. 尝试保存（可能失败）
await page.getByRole('button', { name: /保 存|保存|确定/ }).first().click();
await page.waitForTimeout(2000);

// 2. 检查是否有错误弹窗（el-message / el-alert / el-message-box）
const errorMsg = await page.evaluate(() => {
  // 方案A：el-message 文本
  const msg = document.querySelector('.el-message .el-message__content');
  if (msg && msg.textContent?.includes('必填')) return msg.textContent?.trim();
  // 方案B：el-alert 错误提示
  const alert = document.querySelector('.el-alert--error');
  if (alert) return alert.textContent?.trim();
  // 方案C：表单校验提示（el-form-item__error）
  const errors = document.querySelectorAll('.el-form-item__error');
  if (errors.length > 0) {
    return [...errors].map(e => e.textContent?.trim()).filter(Boolean).join('; ');
  }
  return '';
});

if (errorMsg) {
  console.log(`⚠️ 表单校验失败: ${errorMsg}`);
  // 根据错误文本反推必填字段，逐一补充填写
  if (errorMsg.includes('设备名称') || errorMsg.includes('eqName')) {
    // 填写设备名称
  }
  // ... 其他字段
  // 再次尝试保存
  await page.getByRole('button', { name: /保 存|保存|确定/ }).first().click();
  await page.waitForTimeout(2000);
}
```

此模式避免了在每个页面前端去猜测后台的必填校验规则，使脚本对后端变更更鲁棒。

## 脚本生成模板

```typescript
import { test, expect } from '@playwright/test';

test('测试用例名称', async ({ page }) => {
  // 1. 导航到页面
  await page.goto('URL');
  await page.waitForLoadState('networkidle');

  // 2. 验证页面加载
  await expect(page.locator('元素定位器')).toBeVisible();

  // 3. 执行操作
  // ...

  // 4. 断言验证
  await expect(page.locator('元素定位器')).toHaveText('预期文本');
});
```

## 参考文件

- `references/captcha-login-flow.md`：Captcha + Login 自动登录参考（ddddocr + Element Plus 120x32 验证码）
- `references/element-plus-patterns.md`：企业系统 Playwright 脚本常见模式（Element Plus）

## Common Pitfalls

1. **忘记等待**。每个页面跳转和操作后必须等待，否则脚本不稳定。
2. **使用绝对XPath**。必须使用相对XPath或其他推荐定位方式。
3. **断言不完整**。每个操作后必须包含至少一个有效断言。
4. **硬编码敏感信息**。测试数据仅使用环境变量/Secrets Vault中的测试账号。
5. **不清理测试数据**。新增后必须编辑并删除，保持环境干净。
6. **未处理 guide 弹窗遮挡**。driver.js 蒙层（`#driver-page-overlay`）会拦截所有点击操作，页面刷新后必须清除。
7. **验证码在不同 session 中获取**。验证码图片内容随每次请求变化，获取图片和填写提交必须在同一个浏览器 session 内完成。
8. **忘记 dispatchEvent**。Element Plus 的 `el-input` 用 `fill()` 后输入框显示值但 Vue 模型未更新，需要手动派发 `input` 事件。
9. **企业系统断言宜软不宜硬**。设备树展开、查询重置结果、审批状态拦截等受业务数据影响，断言用 toBe 可能过于严格，建议先 log 记录实际值再判定，避免整个测试因非核心步骤中断。
10. **截图导致测试超时**。headless 模式下 fullPage:true 的 screenshot 可能因字体加载超时（常见于 Windows），建议不用 fullPage 或直接注释掉截图行。
11. **行内操作按钮遗漏**。进入页面后必须用 `page.evaluate` 遍历所有 `button` 元素，分类（工具栏/行内/辅助）后再逐个测试。详情、历史变更这类按钮最容易忽视。
12. **辅助按钮（导入/导出/下载模板）跳过测试**。即使不测试完整功能流程，也必须确认按钮存在且可点击、不报错。
13. **查询下拉框选了默认第一项**。"请选择"的下拉框第一项往往代表"全部"而非筛选条件，应选倒数第一或第二项来验证筛选生效。
14. **修改测试只验证回显，未保存且未验证表格更新**。编辑测试必须做四件事：打开弹窗→修改值→保存→查询验证表格行已更新。只打开弹窗看回显就关闭不算测试了"编辑"功能。
15. **只测文本输入框查询，遗漏下拉框+日期选择器**。查询条件区可能有 el-select 下拉框和 el-date-picker，需要分别枚举并填写值后点击查询。
16. **行内按钮默认被折叠不可见**。「详情」「历史变更」等按钮可能在行展开折叠区，需要先点击 el-table__expand-icon 展开才能看到并点击。
17. **用 fill('') + 查询重置页面但数据不变**。页面可能使用 Vuex/浏览器缓存，page.goto() 重新加载页面才是可靠的查询重置方式。
18. **硬猜后台必填字段列表**。不同页面的必填规则不同且不透明，从保存失败错误弹窗中动态解析必填字段列表更可靠。
19. **表格行数获取方式单一**。应兼容 el-table （el-table__body-wrapper tbody tr）和 ag-grid（.ag-row）两种框架，提供辅助函数统一获取。

## Verification Checklist

- [ ] 页面跳转后有 `waitForLoadState` 等待
- [ ] 元素定位使用推荐优先级（ID > data-testid > Role > Text > 相对XPath）
- [ ] 每个操作包含有效断言
- [ ] 测试数据统一 `AT_` 前缀
- [ ] 完成了数据闭环（新增→验证→编辑→修改并保存→验证→删除→验证）
- [ ] **编辑步骤包含完整的 打开弹窗→验证回显→修改值→保存→查询表格验证**
- [ ] 错误处理格式正确
- [ ] 脚本保存为 .spec.ts 文件
- [ ] URL 可配置（BASE_URL），不硬编码完整URL
- [ ] 使用 storageState 复用登录态，不重复登录
- [ ] 已处理 driver.js 新手引导弹窗遮挡
- [ ] Element Plus 输入框使用 type() 或手动 dispatchEvent
- [ ] 截图使用 `{ fullPage: false }` 避免字体加载超时
- [ ] 遍历了所有可见的查询控件（文本输入框 + 下拉选择框 + 日期选择器），不止一种
- [ ] 下拉选择框查询条件选了唯一值（倒数第一/第二项），不是默认第一项
- [ ] 行内操作按钮已覆盖（详情/历史变更/编辑/作废），用展开图标或行尾倒序定位
- [ ] 查询重置使用 page.goto() 而非仅 fill('')（绕过缓存问题）
- [ ] 表单保存失败时解析错误消息以识别必填字段，不硬猜
- [ ] **枚举了页面上所有可见按钮（顶部工具栏 + 行内操作 + 辅助功能）**
- [ ] **测试了详情、历史变更等行内按钮的功能**
- [ ] **检查了所有辅助按钮（导出/导入/下载模板等）的存在性**
