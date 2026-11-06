/**
 * MCP 工具注册表 — wls_test_* 前缀
 *
 * 工具数量以 getToolCount() 为准（文档/徽章数字请从代码派生，勿手写）。
 * 注册表与 handlers 的键一致性由 assertRegistryParity 保证（server 启动 + 测试双通道）。
 */
import schemaValidation from '../lib/schema-validation.cjs';
import { profileProperty } from "./network-profile.js";
import { resultSchemas } from "./result-schema.js";

export const TOOL_PREFIX = "wls_test";

export const TOOL_DESCRIPTORS = [
  {
    name: 'wls_test_sit_templates', description: '读取SIT Excel模板目录、版式保留范围与严格输入Schema；不写文件，不代表执行测试',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wls_test_sit_generate', description: '在明确指定的新目录生成SIT原版式Excel、方案和报告；不覆盖既有交付物，不代填执行或客户签收',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', required: ['inputFile', 'outputDir'], properties: { inputFile: { type: 'string', minLength: 1, pattern: '\\S' }, outputDir: { type: 'string', minLength: 1, pattern: '\\S' } }, additionalProperties: false },
  },
  {
    name: 'wls_test_sit_verify', description: '核验SIT交付记录（带runId时写本包回执），检查提前一周交付、两轮全量执行和问题闭环；hash回执/事实缺失阻断，不声称观察真实业务测试',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    inputSchema: { type: 'object', required: ['inputFile', 'phase'], properties: { inputFile: { type: 'string', minLength: 1, pattern: '\\S' }, phase: { enum: ['pre-sit', 'pre-uat'] }, root: { type: 'string', minLength: 1, pattern: '\\S' }, runId: { type: 'string', minLength: 1, pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$' } }, additionalProperties: false },
  },
  {
    name: "wls_test_task",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "task写本包计划；route/explain/status/doctor-host只读" } },
    description: "任务技能路由/约束/缺口与可观测回执：task 仅持久化规划，route/explain/status/doctor-host 只读；安装不能证明宿主加载",
    inputSchema: { type: "object", properties: {
      action: { type: "string", enum: ["task", "route", "explain", "status", "doctor-host"] },
      task: { type: "string" }, root: { type: "string", description: "可省略；填写时须与 MCP 启动时绑定的项目根一致" },
      runId: { type: "string", description: "与实际执行命令复用的任务关联 ID" },
      files: { type: "array", items: { type: "string" } }, domain: { type: "string" }, skill: { type: "string" }, host: { type: "string" },
    } },
  },
  {
    name: "wls_test_contract_diff",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "仅output指定时写报告；其余只读分析" } },
    description: "契约变更影响面分析：操作/字段级变更明细 + 受影响用例清单（新增/作废/需重跑），返回紧凑结构化结果",
    inputSchema: {
      type: "object",
      required: ["oldPath", "newPath"],
      properties: {
        oldPath: { type: "string", description: "旧契约文件路径" },
        newPath: { type: "string", description: "新契约文件路径" },
        output: { type: "string", description: "Markdown 报告输出路径（可选）" },
      },
    },
  },
  {
    name: "wls_test_gen_contract",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { wl: { sideEffects: "读取本项目 OpenAPI JSON 或已授权档案的接口；output指定时写契约" } },
    description: "从 OpenAPI 生成测试契约。swagger（本项目 JSON 路径）与 profile（已授权远程档案）二选一，可选写入文件",
    inputSchema: {
      type: "object",
      properties: {
        swagger: { type: "string", minLength: 1, description: "本项目 openapi.json 路径；远程 OpenAPI 使用 profile" },
        profile: profileProperty,
        module: { type: "string", description: "只提取该首段路径的模块" },
        output: { type: "string", description: "契约写入路径（缺省不写文件）" },
      },
    },
  },
  {
    name: "wls_test_standards",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "只读本包规范" } },
    description: "查询测试规范（11 条 standards 按编号或名称读取）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "规范编号，如 01、08" },
      },
    },
  },
  {
    name: "wls_test_contract_read",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "只读明确的契约文件" } },
    description: "读取 kit/bd 机器契约，提取可测试的资源和操作",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["kit", "bd"],
          description: "契约来源",
        },
        path: { type: "string", description: "契约文件路径" },
      },
      required: ["source"],
    },
  },
  {
    name: "wls_test_case_generate",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "读取契约并返回用例；仅显式output时写本地用例文件" } },
    description: "从契约生成测试用例矩阵；默认摘要，detail=full返回全量，显式output可保存JSON，不代表执行测试",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["functional", "api", "permission", "smoke"],
          description: "兼容调用方意图标签；当前返回契约完整矩阵，不按该标签过滤",
        },
        contractPath: { type: "string" },
        granularity: {
          type: "string",
          enum: ["", "field"],
          description: "field = 追加字段级细粒度用例（边界/非法值/安全/操作闭环，与 run-api DAG 映射）",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "wls_test_smoke_select",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "只读已有用例并返回选择结果" } },
    description: "从全量用例筛选冒烟测试套件",
    inputSchema: {
      type: "object",
      properties: {
        casePath: { type: "string", description: "当前 MCP 项目内的全量用例文件路径" },
        complexity: {
          type: "string",
          enum: ["simple", "medium", "complex"],
          description: "系统复杂度，决定套件规模",
        },
      },
      required: ["casePath"],
    },
  },
  {
    name: "wls_test_env_check",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "本地前置条件与命令版本检查；网络未验证" } },
    description: "检查本地测试前置条件（Node/已分发资产/测试命令）；不验证前端、后端或数据库连通性",
    inputSchema: {
      type: "object",
      properties: {
        env: { type: "string", description: "环境标识" },
        root: { type: "string", description: "当前项目根；默认 cwd，不借父项目资产" },
      },
    },
  },
  {
    name: "wls_test_quality_analyze",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "仅计算调用方提供的DI证据" } },
    description: "DI 统计与执行证据判定；缺分母或实际样本时保持未验证",
    inputSchema: {
      type: "object",
      properties: {
        roundResults: { type: "array", description: "各轮执行结果" },
        caseCount: { type: "number", description: "实际执行样本数，正整数且须与 roundResults 执行计数一致" },
        defects: { type: "array", description: "缺陷清单" },
      },
    },
  },
  {
    name: "wls_test_jmeter_validate",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "只读JMX结构；不运行压测" } },
    description: "校验 JMeter jmx 脚本有效性（XML 结构+线程组+断言）",
    inputSchema: {
      type: "object",
      properties: {
        jmxPath: { type: "string", description: "jmx 文件路径" },
      },
      required: ["jmxPath"],
    },
  },
  {
    name: "wls_test_audit",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "业务源只读；写本包执行回执" } },
    description: "审计测试代码（T1-T25 确定性规则扫描，支持 Playwright/JMeter/用例文档）",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "审计目标（文件或目录）" },
      },
      required: ["target"],
    },
  },
  {
    name: "wls_test_fix",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    _meta: { wl: { sideEffects: "预览返回planHash；confirm=true且携带原planHash后写授权范围内的修复，漂移时零写入" } },
    description: "预览测试代码反模式修复（F1-F6）；apply须confirm=true和预览planHash，写前重算，修复不等于验证通过",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "修复目标（文件或目录）" },
        root: { type: "string", minLength: 1, description: "可省略；填写时须与 MCP 启动时绑定的项目根一致" },
        confirm: { type: "boolean", description: "仅true申请执行原预览计划" },
        planHash: { type: "string", pattern: "^[a-f0-9]{64}$", description: "原预览返回的哈希；源文件变化后必须重新预览" },
      },
      required: ["target"],
      allOf: [{ if: { required: ["confirm"], properties: { confirm: { const: true } } }, then: { required: ["planHash"] } }],
    },
  },
  {
    name: "wls_test_run_api",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: { wl: { sideEffects: "向目标环境发送真实HTTP请求（可含业务写入/清理），写报告和本包回执" } },
    description: "执行深度 API 接口测试（DAG 编排 + 四层断言：成功码/结构/写后读回/负例与安全 + 契约漂移检测 + 零污染清理）",
    inputSchema: {
      type: "object",
      properties: {
        contractPath: { type: "string", description: "契约文件路径" },
        profile: profileProperty,
        dictFile: { type: "string", description: "字典 JSON 路径（{字段名: [合法值]}）" },
        lenientCoercion: { type: "boolean", description: "类型负例被后端宽恕时记 warn" },
        permWriteProbe: { type: "boolean", description: "对写操作做权限探针（意外成功自动清理）" },
      },
      required: ["contractPath", "profile"],
    },
  },
  {
    name: "wls_test_run_playwright",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { wl: { sideEffects: "执行调用方测试脚本（可能访问或写目标环境），写本包回执和产物" } },
    description: "执行 Playwright 自动化测试（调用系统已安装的 playwright test）",
    inputSchema: {
      type: "object",
      properties: {
        testDir: { type: "string", description: "测试目录" },
      },
    },
  },
  {
    name: "wls_test_run_jmeter",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { wl: { sideEffects: "执行真实压测，向目标环境请求，写产物和本包回执" } },
    description: "执行 JMeter 性能测试（调用系统已安装的 jmeter -n -t）",
    inputSchema: {
      type: "object",
      properties: {
        jmxPath: { type: "string", description: "jmx 文件路径" },
        threads: { type: "number", description: "并发线程数" },
      },
      required: ["jmxPath"],
    },
  },
  {
    name: "wls_test_e2e_generate",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "写明确outputDir下的测试脚手架；不运行测试" } },
    description: "生成成熟 E2E 工程脚手架（三轮策略：只读冒烟+受控写入+清理账本，含网络监控/写入门禁，源自 wl-ui-produce 实战沉淀）",
    inputSchema: {
      type: "object",
      properties: {
        contractPath: { type: "string", description: "page-spec.json / 契约文件 / page-spec 目录（批量）/ manifest JSON" },
        outputDir: { type: "string", description: "输出目录（默认 ./e2e）" },
        baseUrl: { type: "string", description: "被测系统基址" },
      },
      required: ["contractPath"],
    },
  },
  {
    name: "wls_test_report_generate",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "聚合本项目证据，按参数写本项目报告或 HTML，不代签 UAT" } },
    description: "聚合 run-api/run-playwright/run-jmeter/audit/DI 缺陷结果生成测试报告；报告生成状态与质量判定分别返回",
    inputSchema: {
      type: "object",
      properties: {
        api: { type: "string", description: "run-api 输出的 JSON 文件路径" },
        playwright: { type: "string", description: "run-playwright 输出的 JSON 文件路径" },
        jmeter: { type: "string", description: "性能结果 JSON 文件路径" },
        audit: { type: "string", description: "audit 输出的 JSON 文件路径" },
        defects: { type: "string", description: "缺陷清单 JSON 文件路径" },
        cases: { type: "number", description: "总用例数（DI 密度分母）" },
        allowLegacy: { type: "boolean", description: "旧无回执结果仅导入诊断，不能宣称任务验证通过" },
        trend: { type: "boolean", description: "追加最近 5 次汇总趋势" },
        reportsDir: { type: "string", description: "test-reports 目录（趋势数据源，默认 test-reports）" },
        output: { type: "string", description: "当前 MCP 项目内的报告输出路径（可选）" },
      },
    },
  },
  {
    name: "wls_test_e2e_check",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "静态读取E2E工程并写本包检查回执；不执行脚本" } },
    description: "E2E 工程强校验：用例归属闭环 / test.only / 写入组安全标记 / Bearer 截断 / 隔离声明漂移 / UI 契约拦截声明（源自 wl-ui-produce 实战约束）",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "E2E 工程根目录（含 tests/，默认 ./e2e）" },
      },
    },
  },
  {
    name: "wls_test_dict_sync",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { wl: { sideEffects: "读取目标环境字典接口并写本地dict.json" } },
    description: "同步系统字典到 dict.json（自动识别三种响应形态，支持字段级映射，供数据工厂/负例/round2 消费）",
    inputSchema: {
      type: "object",
      properties: {
        profile: profileProperty,
        output: { type: "string", description: "输出文件（默认 ./dict.json）" },
      },
      required: ["profile"],
    },
  },
  {
    name: "wls_test_gate",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { wl: { sideEffects: "读取所选证据并写本包回执和报告；不直接运行业务测试" } },
    description: "质量门聚合（一条命令：审计+E2E 强校验+冒烟通过率+DI+性能基线，任一失败即阻断）",
    inputSchema: {
      type: "object",
      properties: {
        auditDir: { type: "string", description: "测试代码审计目录" },
        e2eDir: { type: "string", description: "E2E 工程目录" },
        smokeResult: { type: "string", description: "run-api JSON 结果路径" },
        defects: { type: "string", description: "缺陷清单 JSON 路径" },
        cases: { type: "number", description: "实际执行样本数（正整数，与执行摘要一致）" },
        roundResults: { type: "array", description: "DI 各轮执行摘要；不提供时复用 smokeResult" },
        perfCurrent: { type: "string", description: "当前性能结果" },
        perfBaseline: { type: "string", description: "性能基线" },
      },
    },
  },
];

// Every option consumed by an MCP handler is discoverable and validated here.
// Unknown options are rejected instead of silently enabling undocumented behavior.
const detailSchema = { type: "string", enum: ["summary", "full"] };
const outputSchema = { type: "string", minLength: 1, description: "显式本地输出文件；省略时不额外写此文件" };
const topNSchema = { type: "integer", minimum: 1, maximum: 200 };
const supportedOptions = {
  wls_test_contract_diff: { topN: topNSchema },
  wls_test_case_generate: { detail: detailSchema, output: outputSchema },
  wls_test_audit: { detail: detailSchema, topN: topNSchema },
  wls_test_run_api: { detail: detailSchema, topN: topNSchema, output: outputSchema },
  wls_test_e2e_generate: { routes: { type: "string", minLength: 1, description: "显式routes.json文件路径" }, ui: { type: "string", enum: ["element-plus", "steel", "ant-design"] }, workstation: { type: "boolean" } },
  wls_test_report_generate: { detail: detailSchema, html: { type: "boolean" }, title: { type: "string" } },
  wls_test_gate: { perfThreshold: { type: "number", minimum: 0 } },
};
for (const descriptor of TOOL_DESCRIPTORS) {
  Object.assign(descriptor.inputSchema.properties, supportedOptions[descriptor.name] || {});
  if (Object.hasOwn(resultSchemas, descriptor.name)) descriptor.outputSchema = resultSchemas[descriptor.name];
  descriptor.inputSchema.additionalProperties = false;
  if (descriptor.inputSchema.properties.output || descriptor.name === "wls_test_e2e_generate") descriptor.annotations.destructiveHint = true;
  for (const key of descriptor.inputSchema.required || []) {
    const property = descriptor.inputSchema.properties[key];
    if (property?.type === "string") property.minLength ??= 1;
  }
}

// Shared correlation metadata is declared for actual execution tools.
for (const descriptor of TOOL_DESCRIPTORS) {
  if (["wls_test_audit", "wls_test_run_api", "wls_test_run_playwright", "wls_test_run_jmeter", "wls_test_e2e_check", "wls_test_gate", "wls_test_report_generate"].includes(descriptor.name)) {
    Object.assign(descriptor.inputSchema.properties, {
      runId: { type: "string", description: "复用 task 返回的 runId；不跨任务拼接证据" },
      root: { type: "string", description: "可省略；填写时须与 MCP 启动时绑定的项目根一致" },
      reportsDir: { type: "string", description: "报告目录；各结果在 runs/<runId> 内保存" },
    });
  }
}

// Public discovery and protocol.describe use the same host-facing projection;
// validateToolInput below continues to use TOOL_DESCRIPTORS unchanged.
export const HOST_TOOL_DESCRIPTORS = TOOL_DESCRIPTORS.map(schemaValidation.projectMcpToolSchema);

export function getToolCount() {
  return TOOL_DESCRIPTORS.length;
}

export function getToolNames() {
  return TOOL_DESCRIPTORS.map((t) => t.name);
}

/**
 * 注册表 ↔ handler 一致性校验（两份 map 只在调用时才发现漂移，这里在启动期拦截）
 * @param {Record<string, Function>} handlers
 * @returns {{ ok: boolean, missing: string[], extra: string[] }}
 */
export function assertRegistryParity(handlers) {
  const described = new Set(TOOL_DESCRIPTORS.map((t) => t.name));
  const implemented = new Set(Object.keys(handlers));
  const missing = [...described].filter((n) => !implemented.has(n));
  const extra = [...implemented].filter((n) => !described.has(n));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

/**
 * tools/call 始终验证完整 Schema；tools/list 可使用宿主兼容投影。
 * @returns {string|null} 错误消息；null 表示通过
 */
export function validateToolInput(name, args) {
  const descriptor = TOOL_DESCRIPTORS.find((t) => t.name === name);
  if (!descriptor) return null;
  if (["wls_test_gen_contract", "wls_test_run_api", "wls_test_dict_sync"].includes(name) && args && typeof args === "object") {
    const directFields = ["baseUrl", "token", "noPermToken", "auth", "dictApi"];
    if (directFields.some(field => Object.hasOwn(args, field)) || (typeof args.swagger === "string" && /^[a-z][a-z\d+.-]*:\/\//i.test(args.swagger))) {
      return "此工具使用项目 wl-test.config.json 中的 profile；请在本机配置地址和环境变量引用，重连 MCP 后传入档案名";
    }
    if (name === "wls_test_gen_contract" && Object.hasOwn(args, "swagger") === Object.hasOwn(args, "profile")) return "swagger（本地文件）与 profile（远程档案）必须且只能提供一个";
  }
  const validation = schemaValidation.validateSchema(descriptor.inputSchema, args);
  return validation.valid ? null : `参数不符合Schema: ${validation.errors.join("；")}`;
}
