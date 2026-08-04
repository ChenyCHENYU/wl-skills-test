# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 SemVer。

---

## [0.1.0] — 2026-08-04（工程骨架 + 知识资产迁移）

### Added

- 工程骨架搭建：`@agile-team/wl-skills-test` v0.1.0，遵循 wl-skills-* 四包统一架构模式。
- CLI 入口 `wl-skills-test`（init / doctor / validate / run-gen），与 kit/bd 同构。
- 11 条测试规范（standards 01-11），对齐在线 QC 测试流程规范文档。
- 12 个 AI Skill 迁移自 testing-skills-0723，分 5 组（plan / case / exec / quality / perf）。
- 模板文件补齐：JMeter 基础 jmx、Playwright 基础脚本、用例 Excel 结构、质量报告模板。
- MCP 注册表骨架（wls_test_* 前缀，7 个工具规划）。
- 架构设计文档与分析文档，记录设计决策与四包协作关系。

### Changed

- 从 testing-skills-0723 迁移时修复悬空引用（browser-mcp-rules / hermes_tools / templates 缺失）。
- 合并重复的 Windows 编码规范为包级共享 reference。
- 清理 SKILL.md 编号跳跃和角色定义重复问题。

---

## [Unreleased]

- 第二阶段：contract-consumer.js（消费 kit/bd 机器契约自动生成用例）。
- 第二阶段：MCP 7 个工具实现（wls_test_*）。
- 第三阶段：Playwright 脚本自动生成 + JMeter 脚本校验 + DI 质量门 CI 集成。
