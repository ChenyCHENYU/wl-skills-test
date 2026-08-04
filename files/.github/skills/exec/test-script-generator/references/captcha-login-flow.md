# Captcha + Login 自动登录参考

> 场景：Element Plus 系统的密码登录 + 图片验证码（120x32 jpeg）
> 适用于：南钢CRM / 设备智维 IEMP 等企业系统

## 依赖安装

```bash
pip install playwright ddddocr requests
python -m playwright install chromium
```

## 验证码识别要点

- 验证码图片是 120x32 JPEG，通过 `img` 标签显示
- 首次加载时 src 可能是 HTTP URL（返回 HTML），**需要点击一次**刷新后变为 `data:image/jpeg;base64,...`
- 每次页面/浏览器重新打开后验证码刷新，必须在**同一个 session** 内完成识别+提交

## 关键代码片段

### 查找验证码元素

```python
page.evaluate("""() => {
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
        if (img.width === 120 && img.height === 32) { img.click(); return; }
    }
}""")
```

### OCR 识别

```python
import ddddocr
ocr = ddddocr.DdddOcr(show_ad=False)
captcha_text = ocr.classification(img_bytes)
```

### 检测页面渲染

登录页的输入框是动态渲染的（Vue/ElementPlus），不能用固定 wait：
```python
for i in range(20):
    page.wait_for_timeout(1000)
    if page.evaluate("document.querySelectorAll('.el-input__inner').length") >= 3:
        break
```

## 登录后验证

成功后 URL 不会包含 `login` 关键字：
```python
if "login" not in page.url:
    # 登录成功
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| captcha_src 为 login 页面 URL | 未点击刷新验证码 | 先 click 验证码图片再获取 src |
| OCR 识别为单个字母 | 验证码图片跨 session 读取 | 确保获取和识别在同一个浏览器 session 内 |
| input 输入后表单不响应 | Vue 未检测到值变更 | 手动 dispatchEvent('input') |

## 完整脚本参考

参见 `templates/login-and-save-auth.js` 模板。
