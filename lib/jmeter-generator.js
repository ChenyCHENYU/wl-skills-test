/**
 * jmeter-generator.js — 从 bd/kit 契约生成 JMeter jmx 脚本
 *
 * 遵循 perf-script-generator 的 11 条强制规则：
 * - 不混用 ConfigTestElement 与 TestPlan
 * - SteppingThreadGroup 属性名用小写空格
 * - 必须含聚合报告 + 结果树
 */

import { consumeContract } from "./contract-consumer.js";

/**
 * 从契约生成 JMeter jmx 脚本
 * @param {string} contractPath
 * @param {object} options — { threads, rampUp, loops, host, port, token }
 * @returns {string} 生成的 .jmx 内容
 */
export function generateJmeterScript(contractPath, options = {}) {
  const result = consumeContract(contractPath);
  const summary = result.summary;

  const threads = options.threads || 100;
  const rampUp = options.rampUp || 10;
  const loops = options.loops || 50;
  const host = options.host || "${__P(HOST,localhost)}";
  const port = options.port || "";
  const token = options.token || "${__P(TOKEN,)}";

  const entity = summary.entity || "Entity";
  const module = summary.module || "module";

  // 从契约提取要压测的操作（优先 page 和 detail）
  const ops = summary.operations || [];
  const targetOps = ops.filter((o) => ["page", "detail", "create", "update"].includes(o.key));

  const samplers = targetOps.length > 0 ? targetOps : [
    { key: "page", method: "POST", externalPath: `/api/${module}/queryPage` },
  ];

  // 生成采样器 XML
  const samplerXml = samplers.map((op, idx) => buildSampler(op, idx, host, port, token, summary)).join("\n");

  return buildJmx(entity, threads, rampUp, loops, samplerXml);
}

function buildSampler(op, idx, host, port, token, summary) {
  const path = op.externalPath || `/api/${op.key}`;
  const method = op.method || "GET";
  const name = `${op.key} (${method})`;

  let bodyXml = "";
  if (method === "POST" || method === "PUT") {
    let bodyContent = "";
    if (op.key === "page") {
      bodyContent = JSON.stringify({ current: 1, size: 10 });
    } else if (summary.fields) {
      const fields = Array.isArray(summary.fields) ? summary.fields.slice(0, 3) : [];
      const bodyObj = {};
      for (const f of fields) {
        bodyObj[f.name] = "test_${__Random(1000,9999)}";
      }
      bodyContent = JSON.stringify(bodyObj);
    }
    bodyXml = `
      <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
      <elementProp name="HTTPsampler.Files" elementType="Arguments">
        <collectionProp name="Arguments.arguments">
          <elementProp name="" elementType="HTTPArgument">
            <boolProp name="HTTPArgument.always_encode">false</boolProp>
            <stringProp name="Argument.value">${bodyContent}</stringProp>
            <stringProp name="Argument.metadata">=</stringProp>
          </elementProp>
        </collectionProp>
      </elementProp>`;
  }

  const portProp = port ? `<stringProp name="HTTPSampler.port">${port}</stringProp>` : "";

  return `      <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${name}" enabled="true">
        <stringProp name="HTTPSampler.domain">${host}</stringProp>${portProp}
        <stringProp name="HTTPSampler.path">${path}</stringProp>
        <stringProp name="HTTPSampler.method">${method}</stringProp>
        <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
        <boolProp name="HTTPSampler.use_keepalive">true</boolProp>${bodyXml}
      </HTTPSamplerProxy>
      <hashTree>
        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP 头" enabled="true">
          <collectionProp name="HeaderManager.headers">
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">Content-Type</stringProp>
              <stringProp name="Header.value">application/json</stringProp>
            </elementProp>
            <elementProp name="" elementType="Header">
              <stringProp name="Header.name">Authorization</stringProp>
              <stringProp name="Header.value">Bearer ${token}</stringProp>
            </elementProp>
          </collectionProp>
        </HeaderManager>
        <hashTree/>
        <JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="响应码断言" enabled="true">
          <stringProp name="JSON_PATH">$.code</stringProp>
          <stringProp name="EXPECTED_VALUE">2000</stringProp>
          <boolProp name="JSONVALIDATION">true</boolProp>
        </JSONPathAssertion>
        <hashTree/>
      </hashTree>`;
}

function buildJmx(entity, threads, rampUp, loops, samplerXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${entity} 性能测试" enabled="true">
      <stringProp name="TestPlan.comments">自动生成 — 三场景可按线程数切换</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="峰值场景" enabled="true">
        <intProp name="ThreadGroup.num_threads">${threads}</intProp>
        <intProp name="ThreadGroup.ramp_time">${rampUp}</intProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="循环控制器" enabled="true">
          <intProp name="LoopController.loops">${loops}</intProp>
        </elementProp>
      </ThreadGroup>
      <hashTree>
${samplerXml}
        <ResultCollector guiclass="StatVisualizer" testclass="ResultCollector" testname="聚合报告" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
        <ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="查看结果树" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;
}
