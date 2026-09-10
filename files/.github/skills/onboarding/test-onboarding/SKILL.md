---
name: test-onboarding
description: "Use when the user asks to onboard/integrate testing into a project (接入测试/上质量门禁). Deterministic SOP: detect project shape, extract contract from existing OpenAPI/api docs, validate, configure profiles, trial-run, report. AI orchestrates; scripts and tools execute."
version: 1.0.0
author: Hermes User
license: MIT
metadata:
  hermes:
    tags: [testing, onboarding, quality-gate, api-testing, contract]
    related_skills: [api-test-executor, universal-test-rules]
---

# 测试接入引导（test-onboarding）

## 角色定义

你是测试接入引导员。用户说"接入测试 / 上质量门禁 / 让这个项目能跑测试"时，你按本 SOP 执行。
**铁律：探测、转换、校验、执行全部走命令/工具（确定性）；你只负责编排、理解文档、与用户确认。禁止自己手写契约内容、禁止自己编造命令参数。**

## 触发词

"接入测试"、"上质量门禁"、"帮我接入 wl-skills-test"、"让 AI 能跑测试"、"接入接口测试"

## 标准作业流程（SOP）

### 第 1 步：探测（跑命令，不猜）

```
npx @agile-team/wl-skills-test setup [--base-url http://sit:8080]
```

读取输出：项目形态 / 接口描述来源 / 规范安装状态 / 配置骨架。若规范未安装，先让用户运行 init 再继续。

### 第 2 步：契约（按来源走对应路径，全部确定性）

- **来源 = Swagger URL/文件**（setup 已探测到）：
  ```
  npx @agile-team/wl-skills-test gen-contract --swagger <来源> [--module <模块>] --force
  ```
  多模块项目按模块分别提取（--module 参数）。**你不手写契约**，只执行工具。
- **来源 = api.md/接口文档**：按 `.github/standards/` 的契约规范从文档提取 → 写 `wl-contract.json`（这是你唯一可写的环节），但**必须**通过下一步校验才算数。
- **来源 = 无**：停下来问用户接口定义在哪（Swagger 地址 / 文档 / 让后端提供），不要编。

### 第 3 步：校验（不过不往下走）

```
npx @agile-team/wl-skills-test validate-contract --contract wl-contract.json
```

error 级未过 → 修正后重跑，直到通过。重点向用户核对 gen-contract 输出的"需人工核对"项（尤其 successCode，默认 2000 是 jh4j 惯例，别的体系可能是 0/200）。

### 第 4 步：配置（与用户确认，不碰明文凭据）

让用户填写 `wl-test.config.json`（setup 已生成骨架）：
- sit/uat 的 baseUrl
- 凭据：`auth.usernameEnv/passwordEnv` 指向环境变量，值放 `.env`（WL_USER/WL_PASSWORD），**你不得把明文密码写进任何文件**

### 第 5 步：试跑（工具执行，读紧凑摘要）

```
npx @agile-team/wl-skills-test run-api --contract wl-contract.json --profile sit
```

（MCP 可用时优先调 wls_test_run_api，返回紧凑摘要 + failures[].hint）

### 第 6 步：汇报与固化

向用户汇报三行内摘要：结论 / 失败项（引用诊断指引，说明该找后端还是改配置）/ 报告位置（test-reports/）。
然后问：是否固化 CI？用户同意则：
```
npx @agile-team/wl-skills-test ci --type github|gitlab|jenkins
```

## 边界与升级

- 后端服务不可达 → 报告用户"先确认环境"，不重试超过 1 次
- 契约校验反复不过 → 把 validate 输出原样给用户，请后端确认接口定义
- 跨字段业务规则、关联链场景 → 如实告知"当前契约测试覆盖 CRUD 闭环，这类场景走 E2E/人工"，不硬凑
- 凭据相关问题 → 只引导用户自己配 .env，你不接触明文
