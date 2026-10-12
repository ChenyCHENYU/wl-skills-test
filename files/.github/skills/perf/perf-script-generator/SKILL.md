---
name: perf-script-generator
description: "Use when generating JMeter test scripts from confirmed API definitions and an authorized load plan. Report generated/loading/execution states separately; preserve real tool versions, authentication facts, data isolation and cleanup constraints."
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
2. 遵循结构约束，并在实际工具/插件版本下复验；生成不能证明可加载或已执行
3. 内置参数化、断言、Token提取等机制

## 输入参数

接口路径/方法、认证响应结构、目标环境、工具及插件版本、并发/时长、停止条件、测试数据归属和清理必须来自真实资料。缺少时标 `gap`，只能生成明确未确认的草稿，不能替换成历史客户地址或固定示例值。业务写入与压测需实际授权，不能因Skill触发自动访问生产环境。用户 Office 计划/数据模板优先并保持版式；凭据用用户提供的安全环境配置，不写入模板或报告。

| 参数 | 说明 | 示例 |
|------|------|------|
| 接口定义 | 来自测试方案的接口清单 | OpenAPI/Swagger |
| 并发线程数 | 方案中定义的梯度 | 60/300/1000 |
| 持续时长 | 每场景压测时间 | 300s |
| 目标域名 | 被测服务地址 | api.example.com |

## 输出内容

| 文件 | 说明 |
|:----|------|
| `[项目名].jmx` | 生成的脚本；仅在实际工具/插件加载检查通过后标记可加载 |
| `test_users.csv` | 参数化测试数据；按真实唯一性、负载、持续时长和复用约束准备，不使用固定倍数作为充分证据 |
| `run_[场景].bat` | 命令行执行脚本 |

## JMX 脚本结构规范（遵循实测验证）

### 按场景配置的组件

| 组件 | 说明 |
|:----|------|
| ThreadGroup 或 SteppingThreadGroup | 线程组（梯度加压或阶梯加压） |
| HeaderManager | 请求头管理 |
| HTTPSamplerProxy | HTTP采样器 |
| ResponseAssertion | 响应断言 |
| 聚合结果 | 使用实际JTL/报告采集TPS/RT/错误率，明确样本范围 |
| 查看结果树 (View Results Tree) | 本地小样本排错按需使用；压力执行默认关闭，避免额外负载与敏感响应落盘 |

> 下方 XML 是结构示例，参数/认证路径须按真实契约替换；示例并不构成本轮加载或业务执行证据。GUI监听器不必启用，真实性能数据由明确配置的JTL/报告采集。

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
2. 明确结果采集方式；查看结果树仅用于授权的小样本调试，实际压力执行关闭GUI监听器，不泄露凭据或敏感响应。
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

5. 需要 PerfMon 时核对项目实际监控工具/插件版本，复用经过版本匹配的通用结构；不得把原客户脚本或其已验证状态移植到新项目。

6. **`LoopController.loops` 用 `<intProp>`，不是 `<boolProp>`**
7. **hashTree 必须配对平衡**（open数=close数）
8. **JSON请求体用单行紧凑格式 + `&quot;` 实体转义**
9. **POST body 必须用 elementType="HTTPArgument" 格式**
10. HTTP请求默认值和每个Sampler的目标配置须与实际JMeter版本匹配并完成加载检查；未复现当前版本问题时不得全局禁用标准组件或编造兼容结论。目标未知时保留gap，不生成可误执行的默认业务地址。
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

先作本地 XML 结构检查，再在项目实际 JMeter/插件版本下检查加载；说明所使用的工具与真实回执。GUI检查不能证明业务通过，也不得把未经当前CLI支持核实的 `--validate` 参数当作验证入口。

只在已授权测试环境和明确负载/停止/清理计划下执行非GUI压测；原执行器 `wl-skills-test run-jmeter --jmx <文件> --run-id <id>` 的退出码、真实JTL样本与本包status证据共同收尾。未安装工具、加载未检查、未执行、零样本或失败保留unverified/failed，不在生成文件说明中写「已验证可加载/已通过」。

## 参考文件

- `references/perfmon-compatibility.md`：PerfMon 与 JMeter 5.6.3 兼容性问题及正确 XML 格式
- `references/stepping-thread-group.md`：Stepping Thread Group 正确属性名及常见错误

> **文件输出规范**：输出的 `.jmx`/`.md` 文件以正确结构开头。Windows 文件编码（UTF-8 BOM 等）统一遵循 `../../../standards/` 及 `../../case/test-case-generator/references/windows-output-best-practices.md`。
