/**
 * MCP 工具注册表 — wls_test_* 前缀
 * 工具前缀 wls_test_*，7 个工具已全部实现并有测试覆盖
 */

export const TOOL_PREFIX = "wls_test";

export const TOOL_DESCRIPTORS = [
  {
    name: "wls_test_standards",
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
    description: "按契约+需求生成测试用例（功能用例+接口用例）",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["functional", "api", "permission", "smoke"],
          description: "用例类型",
        },
        contractPath: { type: "string" },
        requirementPath: { type: "string" },
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
    description: "从全量用例筛选冒烟测试套件",
    inputSchema: {
      type: "object",
      properties: {
        casePath: { type: "string", description: "全量用例文件路径" },
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
    description: "校验测试环境连通性（前端/后端/数据库）",
    inputSchema: {
      type: "object",
      properties: {
        env: { type: "string", description: "环境标识" },
      },
    },
  },
  {
    name: "wls_test_quality_analyze",
    description: "DI 缺陷指数质量评估与上线判定",
    inputSchema: {
      type: "object",
      properties: {
        roundResults: { type: "array", description: "各轮执行结果" },
        defects: { type: "array", description: "缺陷清单" },
      },
    },
  },
  {
    name: "wls_test_jmeter_validate",
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
    description: "审计测试代码（T1-T12 确定性规则扫描，支持 Playwright/JMeter/用例文档）",
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
    description: "自动修复测试代码反模式（F1-F3：v-deep/beforeEach/waitForTimeout）",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "修复目标（文件或目录）" },
      },
      required: ["target"],
    },
  },
  {
    name: "wls_test_run_api",
    description: "执行深度 API 接口测试（DAG 编排 + 四层断言：成功码/结构/写后读回/负例与安全 + 契约漂移检测 + 零污染清理）",
    inputSchema: {
      type: "object",
      properties: {
        contractPath: { type: "string", description: "契约文件路径" },
        baseUrl: { type: "string", description: "目标基址" },
        token: { type: "string", description: "认证 token" },
        noPermToken: { type: "string", description: "无权限账号 token（启用权限拒绝验证）" },
        dictFile: { type: "string", description: "字典 JSON 路径（{字段名: [合法值]}）" },
        lenientCoercion: { type: "boolean", description: "类型负例被后端宽恕时记 warn" },
        permWriteProbe: { type: "boolean", description: "对写操作做权限探针（意外成功自动清理）" },
      },
      required: ["contractPath"],
    },
  },
  {
    name: "wls_test_run_playwright",
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
    description: "聚合 run-api/run-playwright/run-jmeter/DI 缺陷结果生成测试报告（对齐规范 10 模板，含上线判定）",
    inputSchema: {
      type: "object",
      properties: {
        api: { type: "string", description: "run-api 输出的 JSON 文件路径" },
        playwright: { type: "string", description: "run-playwright 输出的 JSON 文件路径" },
        jmeter: { type: "string", description: "性能结果 JSON 文件路径" },
        defects: { type: "string", description: "缺陷清单 JSON 文件路径" },
        cases: { type: "number", description: "总用例数（DI 密度分母）" },
        output: { type: "string", description: "报告输出路径（可选）" },
      },
    },
  },
  {
    name: "wls_test_e2e_check",
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
    description: "同步系统字典到 dict.json（自动识别三种响应形态，支持字段级映射，供数据工厂/负例/round2 消费）",
    inputSchema: {
      type: "object",
      properties: {
        baseUrl: { type: "string", description: "被测系统基址" },
        token: { type: "string", description: "认证 token" },
        dictApi: { type: "string", description: "字典接口路径（默认 /pl/system/dict/all）" },
        output: { type: "string", description: "输出文件（默认 ./dict.json）" },
      },
      required: ["baseUrl"],
    },
  },
  {
    name: "wls_test_gate",
    description: "质量门聚合（一条命令：审计+E2E 强校验+冒烟通过率+DI+性能基线，任一失败即阻断）",
    inputSchema: {
      type: "object",
      properties: {
        auditDir: { type: "string", description: "测试代码审计目录" },
        e2eDir: { type: "string", description: "E2E 工程目录" },
        smokeResult: { type: "string", description: "run-api JSON 结果路径" },
        defects: { type: "string", description: "缺陷清单 JSON 路径" },
        cases: { type: "number", description: "总用例数" },
        perfCurrent: { type: "string", description: "当前性能结果" },
        perfBaseline: { type: "string", description: "性能基线" },
      },
    },
  },
];

export function getToolCount() {
  return TOOL_DESCRIPTORS.length;
}

export function getToolNames() {
  return TOOL_DESCRIPTORS.map((t) => t.name);
}
