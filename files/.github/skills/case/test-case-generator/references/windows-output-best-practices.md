# Windows 输出文件最佳实践

## 背景

在 Windows 环境下生成的 `.md` 文件需要通过以下规范确保被正确识别和渲染。

## 核心规则

### 1. UTF-8 BOM 强制添加

Windows 记事本等应用依赖 BOM（Byte Order Mark）来识别 UTF-8 编码。无 BOM 的 UTF-8 文件会被按本地编码（GBK）解析，中文会显示为乱码。

**正确写入方式（Python）：**
```python
with open(path, 'wb') as f:
    f.write(b'\xef\xbb\xbf')           # BOM
    f.write(content.encode('utf-8'))    # 内容
```

### 2. 文件名和路径

- 隐藏目录在 Windows 文件管理器中默认隐藏。直接向用户提供完整路径（如 `C:\Users\<user>\project\xxx.md`），用户可通过地址栏直接访问
- 文件扩展名使用 `.md`，不是 `.txt` 或其它
- Windows 路径中的反斜杠应转为正斜杠，并用 `<>` 包裹（避免冒号被 Markdown 误解析）

### 3. 文档头部格式

**不要**用 `---` YAML 前导符包裹文档头部信息：
```markdown
---   ← 这被解析器视为 YAML 分隔符
用例文档：xxx
---   ← 内部中文不是合法 YAML，解析器拒绝渲染
```

**正确做法**：直接以 `# 标题` H1 开头，元数据用 `>` 引用块或 `---` 水平线分隔：
```markdown
# CRM管理系统-测试用例

> 基于文档：xxx
> 版本号：V1.0

---

## 正文从这开始
```

### 4. 避免文件追加导致的重复内容

不要用 `append` 模式分多次写入同一文件。追加操作容易导致重复的章节标题（如 `## 二、线索管理` 出现两次），破坏文件结构。

**正确做法**：一次性构建完整字符串，用单次 `write()` 写入：
```python
# 把所有内容拼成一个大字符串
full = part1 + '\n' + part2 + '\n' + part3
# 单次写入
with open(path, 'wb') as f:
    f.write(b'\xef\xbb\xbf' + full.encode('utf-8'))
```

如果文件实在太大（>50KB），使用代码工具分多次调用写入，但每次调用都要在同一个代码块内完成完整的拼接和写入，不要依赖跨调用持久化。

### 5. 表格格式一致性

同一文件内所有 Markdown 表格使用同一格式（列式或行式），避免混用：
- **列式**（紧凑，适合大量用例）：`| 序号 | 用例名称 | 等级 | ... |`  
- **行式**（详细，适合少量用例）：`| 项目 | 内容 |\n|:----|:-----|\n| 序号 | xxx |`

### 6. Web UI 下载说明

当在回复中使用 `[文件名](<C:/path/to/file.md>)` 链接时，用户点击后 Web UI 可能会以非预期的方式提供文件（如文件名丢失扩展名）。**建议用户直接通过文件管理器导航到磁盘上的路径打开文件**，而非通过聊天中的下载链接。

## 验证方式

确认文件正确的方法：
```python
with open(path, 'rb') as f:
    raw = f.read(10)
print(raw[:3] == b'\xef\xbb\xbf')     # BOM present
print(raw[3:4] == b'#')                # Starts with '#'
print(os.path.splitext(path)[1])       # .md
```
