# Stepping Thread Group 参考

## 正确 XML 格式（JMeter 5.6.3 + jmeter-plugins）

属性名使用 **小写+空格**（不是驼峰），否则 JMeter 不识别，只显示总线程数：

```xml
<kg.apc.jmeter.threads.SteppingThreadGroup
  guiclass="kg.apc.jmeter.threads.SteppingThreadGroupGui"
  testclass="kg.apc.jmeter.threads.SteppingThreadGroup"
  testname="阶梯式加压-500并发" enabled="true">

  <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
  <stringProp name="ThreadGroup.num_threads">500</stringProp>          <!-- 总线程数 -->
  <stringProp name="Threads initial delay">0</stringProp>              <!-- 初始延迟 -->
  <stringProp name="Start users count">100</stringProp>                <!-- 每阶梯增加数 -->
  <stringProp name="Start users count burst">0</stringProp>            <!-- 突发线程 -->
  <stringProp name="Start users period">0</stringProp>                 <!-- 初期间隔 -->
  <stringProp name="Stop users count">100</stringProp>                 <!-- 每步减少数 -->
  <stringProp name="Stop users period">20</stringProp>                 <!-- 减载间隔(秒) -->
  <stringProp name="flighttime">300</stringProp>                       <!-- 峰值持续(秒) -->
  <stringProp name="rampUp">20</stringProp>                            <!-- 阶梯间隔(秒) -->
  <elementProp name="ThreadGroup.main_controller"
    elementType="LoopController" guiclass="LoopControlPanel"
    testclass="LoopController" enabled="true">
    <boolProp name="LoopController.continue_forever">false</boolProp>
    <intProp name="LoopController.loops">-1</intProp>
  </elementProp>
</kg.apc.jmeter.threads.SteppingThreadGroup>
```

## 参数映射

| 需求 | SteppingThreadGroup 属性 | 说明 |
|:----|:-------------------------|:-----|
| 500 并发 | `ThreadGroup.num_threads` | 总线程数 |
| 每20秒加100 | `Start users count`=100, `rampUp`=20 | 每级加100，间隔20秒 |
| 峰值5分钟 | `flighttime`=300 | 单位：秒 |
| 每20秒减100 | `Stop users count`=100, `Stop users period`=20 | 每级减100，间隔20秒 |

## 阶梯数计算

阶梯数 = `num_threads` / `Start users count`。例如 500/100=5 级阶梯。

## 常见错误

1. ❌ 使用驼峰属性名（`startUsersCount`、`flightTime`、`rampUpStepTime`）
   ✅ **必须使用小写+空格**（`Start users count`、`flighttime`、`rampUp`）

2. ❌ 使用了 `rampUpStepsCount`、`rampUpUsersCountPerStep` 等不存在的属性名
   ✅ 旧版插件只有 `Start users count`（每级增加数）+ `rampUp`（每级间隔），阶梯数自动计算

3. ❌ 省略 `<elementProp>` LoopController
   ✅ 标准 TG 和 SteppingThreadGroup 都需要 LoopController

## 模板来源

从 JMeter 3.3 版备份文件反推（`bzm - Concurrency Thread Group.jmx`），经验证兼容 JMeter 5.6.3。
