# 企业系统 Playwright 脚本常见模式（Element Plus）

> 经验总结自南钢CRM / 设备智维 IEMP 项目测试

## 1. 页面加载 + 新手引导弹窗处理

```javascript
await page.goto(`${BASE_URL}/index?path=iemp`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  ['#driver-page-overlay', '#driver-popover-item'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  document.querySelectorAll('.driver-popover, .driver-popover-tip, .driver-popover-stage, .third-intro')
    .forEach(el => el.remove());
});
```

## 2. 菜单展开 + 子页面导航

```javascript
await page.getByText('备材管理', { exact: true }).first.click();
await page.waitForTimeout(2000);
await page.getByText('备件材料领用申报', { exact: true }).first.click();
await page.waitForTimeout(5000);
```

## 3. Element Plus 下拉框选择

```javascript
const item = dialog.locator('.el-form-item').filter({ hasText: '生产厂' });
await item.locator('.el-select__wrapper, .el-input__wrapper').first().click();
await page.waitForTimeout(800);
await page.locator('.el-select-dropdown:visible').last()
  .locator('.el-select-dropdown__item').first().click();
```

## 4. 日期选择器

```javascript
const dateItem = dialog.locator('.el-form-item').filter({ hasText: '计划领料日期' });
await dateItem.locator('input').click();
await page.waitForTimeout(800);
const today = page.locator('.el-date-table td.today:visible').first();
if (await today.count() > 0) { await today.click(); }
else { await page.locator('.el-date-table td.available:visible').first().click(); }
```

## 5. Ag-Grid 行数获取

```javascript
const count = await page.evaluate(() => document.querySelectorAll('.ag-row').length);
```

## 6. 按钮点击（绕过遮挡）

```javascript
await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    if (b.textContent?.trim() === '查询' && !b.disabled) { b.click(); return; }
  }
});
```

## 7. 删除确认弹窗

```javascript
const msgBox = page.locator('.el-message-box');
if (await msgBox.isVisible().catch(() => false)) {
  await msgBox.getByRole('button', { name: /确 定|确定/ }).first().click();
}
```

## 8. 查询输入框 placeholder 速查

| 值 | 说明 | 可能映射字段 |
|------|------|-------------|
| `搜索` | 全局关键字搜索 | 可能 readOnly |
| `请选择` | 下拉筛选 | 生产厂/审批状态/交易用途 |
| `请输入内容` | 文本过滤 | 工单编号/合同号 |
| `请输入` | 单号过滤 | ERP领料单号 |
| `开始时间/结束时间` | 日期范围 | 计划领料日期 |

## 9. 树形选择器逐层展开（TreeSelect）

Element Plus 树形选择器需要逐层展开非叶子节点，直到遇到叶子节点（`is-leaf` class）：

```javascript
// 最多展开10轮，每轮找第一个未展开的非叶子节点并展开
for (let round = 0; round < 10; round++) {
  const result = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent);
    const dlg = dialogs[dialogs.length - 1];
    if (!dlg) return { done: true };
    // 找到第一个未展开的非叶子节点
    const icons = dlg.querySelectorAll('.el-tree-node__expand-icon:not(.is-leaf)');
    for (const icon of icons) {
      if (icon.offsetParent) { icon.dispatchEvent(new MouseEvent('click', { bubbles: true })); return { done: false }; }
    }
    // 所有非叶子已展开，找第一个叶子节点
    const leaves = dlg.querySelectorAll('.el-tree-node__expand-icon.is-leaf');
    for (const icon of leaves) {
      const text = icon.closest('.el-tree-node')?.querySelector('.el-tree-node__label')?.textContent?.trim();
      if (text) return { done: true, leafText: text };
    }
    return { done: true, leafText: null };
  });
  if (result.done) {
    if (result.leafText) { /* 可点击叶子节点标签选中 */ }
    break;
  }
  await page.waitForTimeout(500);
}
```

**注意**：树形选择器中可能出现"无叶子节点"的情况（所有节点展开后仍无可选子项），此时应记录日志并跳过，避免死循环。

## 10. 行内操作按钮（详情/历史变更）

企业系统表格行尾的"详情""历史变更"等按钮有两种布局：
- **行展开模式**：隐藏于 `el-table__expand-icon` 折叠区，需先点击展开图标
- **固定操作列模式**：直接可见于行尾按钮组，用 `nth(-1)` 倒序定位

```javascript
// 模式1：展开第一行后找按钮
const expandIcon = page.locator('.el-table__expand-icon').first();
if (await expandIcon.isVisible().catch(() => false)) {
  await expandIcon.click();
  await page.waitForTimeout(1000);
}
// 找详情按钮
const detailBtn = page.getByRole('button', { name: '详情' }).first();
if (await detailBtn.isVisible().catch(() => false)) {
  await detailBtn.click();
  await page.waitForTimeout(2000);
}

// 模式2：行尾倒序定位（最后1~2个按钮是操作按钮）
const allRowBtns = page.locator('.el-table__body-wrapper button');
const btnCount = await allRowBtns.count();
if (btnCount >= 7) {
  const voidBtn = allRowBtns.nth(btnCount - 1);
  await voidBtn.click();
}
```

## 11. 查询重置 — page.goto() 优先

用 `field.fill('')` 清除输入框后点"查询"，页面可能仍携带旧条件。可靠重置：

```javascript
// 重新加载页面（比 fill('') + 查询更可靠）
await page.goto(`${BASE_URL}/index?path=iemp`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
// 清除引导弹窗
await page.evaluate(() => {
  document.querySelectorAll('#driver-page-overlay, .driver-popover, .driver-popover-tip, .driver-popover-stage')
    .forEach(el => el.remove());
});
await page.waitForTimeout(1000);
```

## 12. 表单校验失败解析

保存时错误弹窗可能列出必填字段，动态解析而非硬编码：

```javascript
const errorMsg = await page.evaluate(() => {
  const msg = document.querySelector('.el-message .el-message__content');
  if (msg && msg.textContent?.includes('必填')) return msg.textContent?.trim();
  const alert = document.querySelector('.el-alert--error');
  if (alert) return alert.textContent?.trim();
  const errors = document.querySelectorAll('.el-form-item__error');
  if (errors.length > 0) {
    return [...errors].map(e => e.textContent?.trim()).filter(Boolean).join('; ');
  }
  return '';
});
```
