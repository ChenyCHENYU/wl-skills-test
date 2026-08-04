# PerfMon 与 JMeter 5.6.3 兼容性说明

## 问题

PerfMon 2.1 从旧版本拷贝的 jar 与 JMeter 5.6.3 不兼容：
```
java.lang.NoSuchMethodError: 
org.apache.jmeter.samplers.SampleSaveConfiguration.setFormatter(Ljava/text/DateFormat;)V
```

`setFormatter()` 方法在 JMeter 5.6.3 中被移除，旧版本 `JMeterPlugins-Extras.jar` 调用该方法时报错。

## 解决方案

### 方案A：正确安装（推荐）

1. 下载 `jmeter-plugins-manager-1.10.jar` 放入 `lib/ext/`
2. 启动 JMeter → Options → Plugins Manager
3. 在线安装 PerfMon Metrics Collector（自动匹配 5.6.3）
4. 重启 JMeter

### 方案B：使用正确 XML 格式

通过插件管理器在线安装的 PerfMon 使用以下 XML 格式：

```xml
<kg.apc.jmeter.perfmon.PerfMonCollector guiclass="kg.apc.jmeter.vizualizers.PerfMonGui" 
  testclass="kg.apc.jmeter.perfmon.PerfMonCollector" 
  testname="jp@gc - PerfMon Metrics Collector">
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

旧版本格式（不兼容）：
```xml
<kg.apc.jmeter.visualizers.PerfMonMetricsCollector ...>
  <collectionProp name="metrics">...</collectionProp>
</kg.apc.jmeter.visualizers.PerfMonMetricsCollector>
```

关键差异：
- 类名：`kg.apc.jmeter.perfmon.PerfMonCollector`（新版）vs `kg.apc.jmeter.visualizers.PerfMonMetricsCollector`（旧版）
- GUI类：`kg.apc.jmeter.vizualizers.PerfMonGui`（新版）vs `kg.apc.jmeter.visualizers.PerfMonMetricsCollectorGui`（旧版）
- 属性名：`metricConnections`（新版）vs `metrics`（旧版）
- 内部属性ID不同

### 方案C：无权限时用 sar 替代

当没有服务器权限或插件无法安装时，放弃 PerfMon，改用命令采集：

```bash
# 在目标服务器上执行（需要 SSH 或人工操作）
sar -u 1 [时长秒] > /tmp/cpu.log
sar -r 1 [时长秒] > /tmp/mem.log
```
