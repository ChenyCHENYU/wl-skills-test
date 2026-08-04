# Playwright on Windows — Setup & Execution Reference

## Quick Install

```bash
# 1. Create script directory
mkdir scripts && cd scripts

# 2. Initialize npm and install Playwright
npm init -y
npm install @playwright/test

# 3. Install Chromium browser
npx playwright install chromium

# 4. (Optional) Python OCR for captcha
pip install ddddocr playwright
```

## Script Template (with logs + auth)

```javascript
const { test, expect } = require('@playwright/test');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

test.use({ storageState: 'auth.json' });

function log(step, action, result, note = '') {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${ts}] [模块名] [${step}] [${action}] ${result}${note ? '；' + note : ''}`);
}

async function selectFirstDropdownOption(page, inputLocator) {
    await inputLocator.click();
    await page.waitForTimeout(300);
    const option = page.locator('.el-select-dropdown:visible .el-select-dropdown__list li').first();
    await option.click({ force: true, timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
}

test('完整闭环测试', async ({ page }) => {
    test.setTimeout(240000);
    
    // ---- Step 1: Navigate ----
    await page.goto(`${BASE_URL}/index?path=iemp`);
    // ... click menus ...
    await expect(page.getByRole('button', { name: '查询' })).toBeVisible();
    
    // ---- Step 2: Query ----
    // ---- Step 3: Reset ----
    // ---- Step 4: Add (validation + valid data) ----
    // ---- Step 5: Edit (verify echo + save) ----
    // ---- Step 6: Delete (confirm + verify gone) ----
});
```

## Login + Save Auth

### Manual (first time)
```javascript
// login-and-save-auth.js
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://host:port/login');
    console.log('Login manually, then press Enter...');
    await new Promise(resolve => process.stdin.once('data', resolve));
    await context.storageState({ path: 'auth.json' });
    await browser.close();
})();
```

### Auto (with captcha OCR)
```python
import ddddocr, base64
from playwright.sync_api import sync_playwright

ocr = ddddocr.DdddOcr(show_ad=False)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()
    page.goto('http://host:port/login')
    # Wait for form
    for _ in range(20):
        page.wait_for_timeout(1000)
        if page.evaluate("document.querySelectorAll('.el-input__inner').length") >= 3:
            break
    # Click captcha to get base64
    page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            if (img.width === 120 && img.height === 32) { img.click(); return; }
        }
    }""")
    page.wait_for_timeout(2000)
    # OCR
    b64 = page.evaluate("""() => {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
            if (img.width===120 && img.height===32 && img.src.includes('base64'))
                return img.src;
        }
    }""")
    _, data = b64.split(',', 1)
    captcha = ocr.classification(base64.b64decode(data))
    # Login
    page.fill('input[placeholder="用户名"]', 'admin')
    page.fill('input[placeholder="密码"]', 'password')
    page.fill('input[placeholder="请输入验证码"]', captcha)
    page.click('button:has-text("登录")')
    page.wait_for_timeout(5000)
    if 'login' not in page.url:
        context.storage_state(path='auth.json')
        print('Login OK')
    browser.close()
```

## Running Tests

```bash
# Normal
npx playwright test your-test.spec.js --reporter=list

# With Python subprocess (when terminal is broken)
```
```python
import subprocess
result = subprocess.run(
    ['npx.cmd', 'playwright', 'test', '点检周期新增.spec.js', '--reporter=list'],
    capture_output=True, text=True, timeout=300,
    cwd=r'C:\path\to\scripts'
)
print(result.stdout)
```

## Windows-Specific Pitfalls

1. **Screenshot timeout (fullPage:true)** — headless Chromium on Windows often hangs waiting for fonts. Set `{ fullPage: false }` or comment out screenshots during debug.
2. **Chinese filename in CLI** — `npx playwright test 中文名.spec.js` works, but file tools may fail on Chinese paths. Use Python `open()` as fallback.
3. **driver.js overlay blocks clicks** — Page reload re-shows the guide popup. Always run the overlay removal snippet after `page.reload()` or `page.goto()`.
4. **Vue input reactivity** — `fill()` changes the visual value but may not trigger Vue's model update. Use `type()` instead, or `fill()` + `dispatchEvent(new Event('input', {bubbles: true}))`.

## Test Output Example

```
========== 测试报告 ==========
测试时间: 2026-06-30 06:07:24
总用例数: 9 | 通过: 9 | 失败: 0 | 通过率: 100.0%
-------------------------------------------
  1. 进入页面: 通过
  2. 查询功能: 通过
  3. 重置功能: 通过
  ...
===========================================
```
