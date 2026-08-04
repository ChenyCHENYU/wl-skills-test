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
    description: "执行 API 接口测试（从契约自动发起 HTTP 请求验证可用性，零依赖）",
    inputSchema: {
      type: "object",
      properties: {
        contractPath: { type: "string", description: "契约文件路径" },
        baseUrl: { type: "string", description: "目标服务地址" },
        token: { type: "string", description: "认证 token（可选）" },
      },
      required: ["contractPath"],
    },
  },
];

export function getToolCount() {
  return TOOL_DESCRIPTORS.length;
}

export function getToolNames() {
  return TOOL_DESCRIPTORS.map((t) => t.name);
}
