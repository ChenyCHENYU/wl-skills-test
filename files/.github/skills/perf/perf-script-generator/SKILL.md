---
name: perf-script-generator
description: "Use when generating JMeter 5.6.3 test scripts from API definitions — produces a validated .jmx file, parameterized CSV test data, and executable CLI commands. Includes login auth, token extraction, assertions, and gradient thread groups."
version: 2.1.0
author: Hermes User
license: MIT
metadata:
  hermes:
    tags: [performance, jmeter, load-testing, script-generation]
    related_skills: [perf-plan-generator, perf-report-analyzer]
---

# 性能测试脚本生成技能

## 角色定义

你是一位精通JMeter 5.6.3的脚本开发工程师，核心能力是：
1. 根据接口定义自动生成兼容JMeter 5.6.3的`.jmx`脚本
2. 遵循已验证的XML结构规范，确保生成即可用
3. 内置参数化、断言、Token提取等机制

## 输入参数

| 参数 | 说明 | 示例 |
|------|------|------|
| 接口定义 | 来自测试方案的接口清单 | OpenAPI/Swagger |
| 并发线程数 | 方案中定义的梯度 | 60/300/1000 |
| 持续时长 | 每场景压测时间 | 300s |
| 目标域名 | 被测服务地址 | api.example.com |

## 输出内容

| 文件 | 说明 |
|:----|------|
| `[项目名].jmx` | JMeter 5.6.3 脚本（已验证可加载） |
| `test_users.csv` | 参数化测试数据（行数=线程数×1.5） |
| `run_[场景].bat` | 命令行执行脚本 |

## JMX 脚本结构规范（遵循实测验证）

### 脚本必须包含的组件

| 组件 | 说明 |
|:----|------|
| ThreadGroup 或 SteppingThreadGroup | 线程组（梯度加压或阶梯加压） |
| HeaderManager | 请求头管理 |
| HTTPSamplerProxy | HTTP采样器 |
| ResponseAssertion | 响应断言 |
| **聚合报告 (Summary Report)** | 汇总TPS/RT/错误率 |
| **查看结果树 (View Results Tree)** | 逐条查看请求/响应详情，排错必须 |

> ⚠️ 每次生成的 .jmx 必须同时包含「聚合报告」和「查看结果树」，缺一不可。

### 基础骨架

```
jmeterTestPlan (version=1.2, properties=5.0, jmeter=5.6.3)
  hashTree
    TestPlan (enabled=true)
      user_defined_variables
    /TestPlan
    hashTree
      ThreadGroup (enabled=true)
        on_sample_error = continue
        main_controller → LoopController
          (continue_forever=false, loops=-1 用intProp)
        num_threads / ramp_time / duration (用stringProp)
        scheduler = true
      hashTree
        CSVDataSet (enabled=true)         ← 参数化
        hashTree/
        HeaderManager (enabled=true)      ← 请求头
        hashTree/
        HTTPSamplerProxy                  ← 第1个请求
        hashTree
          ResponseAssertion              ← 断言
          hashTree/
          JSONPostProcessor              ← Token提取
          hashTree/
        /hashTree
        HTTPSamplerProxy                  ← 第2个请求
        hashTree/
        ...
      /hashTree
      ResultCollector                     ← 聚合报告
      hashTree/
    /hashTree
  /hashTree
/jmeterTestPlan
```

### 强制规则（违反会导致加载失败）

1. **所有组件加 `enabled="true"`**
2. **必须同时添加「聚合报告」和「查看结果树」**——聚合报告用于汇总指标，查看结果树用于排查单条请求的请求/响应内容。
3. **如果用户已部署 ServerAgent，脚本中可追加 `jp@gc - PerfMon Metrics Collector`**。
   ⚠️ PerfMon 插件的 XML 类名与版本有关，实测可用的格式如下（JMeter 5.6.3 + 插件管理器在线安装的版本）：

```xml
<kg.apc.jmeter.perfmon.PerfMonCollector guiclass="kg.apc.jmeter.vizualizers.PerfMonGui" testclass="kg.apc.jmeter.perfmon.PerfMonCollector" testname="jp@gc - PerfMon Metrics Collector">
  <collectionProp name="metricConnections">
    <collectionProp name="-429043288">
      <stringProp name="-594065693">[服务器IP]</stringProp>
      <stringProp name="1600768">4444</stringProp>
      <stringProp name="66952">CPU</stringProp>
      <stringProp name="0"></stringProp>
    </collectionProp>
    <collectionProp name="1565209687">
      <stringProp name="-594065693">[服务器IP]</stringProp>
      <stringProp name="1600768">4444</stringProp>
      <stringProp name="-1993889503">Memory</stringProp>
      <stringProp name="0"></stringProp>
    </collectionProp>
  </collectionProp>
</kg.apc.jmeter.perfmon.PerfMonCollector>
```

   ⚠️ **不兼容情况**：如果用户是手动从旧版本拷贝的 PerfMon jar，可能报 `NoSuchMethodError: setFormatter`。此时建议：
   - 方案A：用插件管理器在线安装 PerfMon（自动匹配版本）
   - 方案B：去掉 PerfMon，改用 `sar` 命令在服务器上采集资源数据（适合无服务器权限或插件无法安装的情况）
   - 详细兼容性问题与正确 XML 格式参见 `references/perfmon-compatibility.md`

```bash
# 在目标服务器上采集CPU和内存（跟压测时长一致）
sar -u 1 300 > /tmp/cpu.log
sar -r 1 300 > /tmp/mem.log
```

4. **当用户要求"阶梯式加压"或"每X秒加减Y"时，必须使用 `jp@gc - Stepping Thread Group` 插件**。不要用标准 ThreadGroup 的 ramp_time 近似代替——用户要求阶梯就必须是阶梯。正确属性名及完整 XML 参见 `references/stepping-thread-group.md`。

5. **生成带 PerfMon 的脚本时，建议直接使用已验证通过的模板进行修改**（如 `01-点检任务查询+perfmon.jmx`），而非从零构造，避免 PerfMon XML 格式兼容性问题。

6. **`LoopController.loops` 用 `<intProp>`，不是 `<boolProp>`**
7. **hashTree 必须配对平衡**（open数=close数）
8. **JSON请求体用单行紧凑格式 + `&quot;` 实体转义**
9. **POST body 必须用 elementType="HTTPArgument" 格式**
10. **不要使用 `ConfigTestElement`（HTTP请求默认值）**——已在JMeter 5.6.3中确认会导致加载失败。每个 Sampler 独立配置 domain/port/protocol，或留空由用户手动填写。
11. **CSV路径用正斜杠** `D:/script/data.csv`，不用反斜杠

### 阶梯加压（Stepping Thread Group）

当用户要求"阶梯式加压"或"每X秒加减Y"时，必须使用 `jp@gc - Stepping Thread Group` 插件。

**参数映射：**

| 需求 | 属性 | 示例值 |
|:----|:-----|:-------|
| 总线程数 | `ThreadGroup.num_threads` | 500 |
| 每级增加数 | `Start users count` | 100 |
| 阶梯间隔(秒) | `rampUp` | 20 |
| 峰值持续(秒) | `flighttime` | 300 |
| 每级减少数 | `Stop users count` | 100 |
| 减载间隔(秒) | `Stop users period` | 20 |

**完整 XML 格式（关键属性用**小写+空格**，不是驼峰！）：**

```xml
<kg.apc.jmeter.threads.SteppingThreadGroup guiclass="kg.apc.jmeter.threads.SteppingThreadGroupGui" testclass="kg.apc.jmeter.threads.SteppingThreadGroup" testname="阶梯式加压-500并发" enabled="true">
  <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
  <stringProp name="ThreadGroup.num_threads">500</stringProp>
  <stringProp name="Threads initial delay">0</stringProp>
  <stringProp name="Start users count">100</stringProp>
  <stringProp name="Start users count burst">0</stringProp>
  <stringProp name="Start users period">0</stringProp>
  <stringProp name="Stop users count">100</stringProp>
  <stringProp name="Stop users period">20</stringProp>
  <stringProp name="flighttime">300</stringProp>
  <stringProp name="rampUp">20</stringProp>
  <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" enabled="true">
    <boolProp name="LoopController.continue_forever">false</boolProp>
    <intProp name="LoopController.loops">-1</intProp>
  </elementProp>
</kg.apc.jmeter.threads.SteppingThreadGroup>
```

> ⚠️ **常见错误**：使用驼峰属性名（`startUsersCount`、`flightTime`、`rampUpStepTime`）→ 必须用小写+空格。
> ⚠️ 不要使用 `rampUpStepsCount`、`rampUpUsersCountPerStep` 等不存在的属性——旧版插件只有 `Start users count` + `rampUp`，阶梯数自动计算。
> ⚠️ SteppingThreadGroup 节点下必须有 `<elementProp>` LoopController，不能省略。

### JSON 请求体格式

```xml
<boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
<elementProp name="HTTPsampler.Arguments" elementType="Arguments">
  <collectionProp name="Arguments.arguments">
    <elementProp name="" elementType="HTTPArgument">
      <boolProp name="HTTPArgument.always_encode">false</boolProp>
      <stringProp name="Argument.value">{&quot;key&quot;:&quot;${var}&quot;}</stringProp>
      <stringProp name="Argument.metadata">=</stringProp>
    </elementProp>
  </collectionProp>
</elementProp>
```

### 断言配置

状态码断言（按接口分别配置）：
```xml
<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="断言-[接口名称]" enabled="true">
  <collectionProp name="Asserion.test_strings">
    <stringProp name="-1545747804">200</stringProp>
  </collectionProp>
  <stringProp name="Assertion.test_field">Assertion.response_code</stringProp>
</ResponseAssertion>
```

### Token 提取

```xml
<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="提取-[变量名]" enabled="true">
  <stringProp name="JSONPostProcessor.referenceNames">token</stringProp>
  <stringProp name="JSONPostProcessor.jsonPathExprs">$.data.token</stringProp>
  <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
</JSONPostProcessor>
```

### CSV参数化

```xml
<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="用户数据" enabled="true">
  <stringProp name="filename">D:/script/test_users.csv</stringProp>
  <stringProp name="fileEncoding">UTF-8</stringProp>
  <stringProp name="variableNames">username,password,product_id</stringProp>
  <stringProp name="delimiter">,</stringProp>
  <boolProp name="recycle">true</boolProp>
  <boolProp name="stopThread">false</boolProp>
  <stringProp name="shareMode">shareMode.all</stringProp>
</CSVDataSet>
```

## 命令行执行脚本

```bash
# 日常场景
jmeter -n -t [脚本名].jmx -Jthreads=60 -Jramp=120 -Jduration=300 ^
  -l ./results/daily_%date:~0,4%%date:~5,2%%date:~8,2%.jtl ^
  -e -o ./results/daily_report

# 峰值场景
jmeter -n -t [脚本名].jmx -Jthreads=300 -Jramp=180 -Jduration=900 ^
  -l ./results/peak_%date:~0,4%%date:~5,2%%date:~8,2%.jtl ^
  -e -o ./results/peak_report
```

## 脚本验证（生成后必须执行）

```bash
# JMeter GUI：打开.jmx文件，确认所有节点可点击无报错
# JMeter CLI验证：
jmeter -n -t [脚本名].jmx --validate
```

## 参考文件

- `references/perfmon-compatibility.md`：PerfMon 与 JMeter 5.6.3 兼容性问题及正确 XML 格式
- `references/stepping-thread-group.md`：Stepping Thread Group 正确属性名及常见错误

> **文件输出规范**：输出的 `.jmx`/`.md` 文件以正确结构开头。Windows 文件编码（UTF-8 BOM 等）统一遵循 `../../standards/` 及 `../case/test-case-generator/references/windows-output-best-practices.md`。
