/**
 * MCP 工具 Handler 实现
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { consumeContract, generateTestCaseMatrix } from "../../lib/contract-consumer.js";
import { generateSmokeSuite, calculateDI, exportCasesMarkdown } from "../../lib/test-codegen.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..", "..");

// ── wls_test_standards ─────────────────────────
export function handleStandards(args) {
  const id = args.id;
  if (id) {
    const file = findStandardFile(id);
    if (!file) return { error: `规范 ${id} 不存在` };
    return { id, content: readFileSync(file, "utf-8") };
  }
  return { standards: listStandards() };
}

// ── wls_test_contract_read ─────────────────────
export function handleContractRead(args) {
  const path = args.path;
  if (!path || !existsSync(path)) {
    return { error: "契约文件路径无效或不存在" };
  }
  const result = consumeContract(path);
  return {
    type: result.type,
    summary: result.summary,
  };
}

// ── wls_test_case_generate ─────────────────────
export function handleCaseGenerate(args) {
  if (args.contractPath && existsSync(args.contractPath)) {
    const result = consumeContract(args.contractPath);
    const cases = generateTestCaseMatrix(result.summary);
    const apiTests = cases.filter((c) => c.type === "api").length;
    const permTests = cases.filter((c) => c.type === "permission").length;
    const boundTests = cases.filter((c) => c.type === "boundary").length;
    return {
      caseCount: cases.length,
      summary: {
        entity: result.summary.entity || result.summary.pageName,
        module: result.summary.module,
        apiTests,
        permissionTests: permTests,
        boundaryTests: boundTests,
      },
      cases,
    };
  }
  return {
    error: "需要 contractPath 参数（kit wl-api-contract 或 bd wl-contract.json）",
  };
}

// ── wls_test_smoke_select ──────────────────────
export function handleSmokeSelect(args) {
  const complexity = args.complexity || "medium";
  if (args.casePath && existsSync(args.casePath)) {
    const cases = JSON.parse(readFileSync(args.casePath, "utf-8"));
    const suite = generateSmokeSuite(cases, { complexity });
    return suite;
  }
  return {
    error: "需要 casePath 参数（全量用例 JSON 文件）",
  };
}

// ── wls_test_env_check ─────────────────────────
export function handleEnvCheck(args) {
  const checks = {
    nodeVersion: process.version,
    playwright: checkCommand("npx playwright --version"),
    jmeter: checkCommand("jmeter --version"),
    standardsDir: existsSync(join(process.cwd(), ".github", "standards")),
    skillsDir: existsSync(join(process.cwd(), ".github", "skills")),
  };
  const allPass = checks.standardsDir && checks.skillsDir;
  return { checks, ready: allPass };
}

// ── wls_test_quality_analyze ───────────────────
export function handleQualityAnalyze(args) {
  const defects = args.defects || [];
  const caseCount = args.caseCount || 50;
  return calculateDI(defects, caseCount);
}

// ── wls_test_jmeter_validate ───────────────────
export function handleJmeterValidate(args) {
  const jmxPath = args.jmxPath;
  if (!jmxPath || !existsSync(jmxPath)) {
    return { error: "jmx 文件路径无效" };
  }

  const content = readFileSync(jmxPath, "utf-8");
  const issues = [];

  if (!content.includes("<jmeterTestPlan")) {
    issues.push({ severity: "fatal", message: "缺少 <jmeterTestPlan> 根元素" });
  }
  if (!content.includes("<ThreadGroup")) {
    issues.push({ severity: "fatal", message: "缺少线程组 <ThreadGroup>" });
  }
  if (content.includes("ConfigTestElement") && content.includes('guiclass="TestPlanGui"')) {
    issues.push({
      severity: "fatal",
      message: "ConfigTestElement 与 TestPlan 混用，会导致 JMeter 加载失败",
    });
  }

  const steppingMatch = content.match(/<SteppingThreadGroup[\s\S]*?>/);
  if (steppingMatch) {
    const block = steppingMatch[0];
    if (block.includes("threads") || block.includes("rampUp")) {
      issues.push({
        severity: "fatal",
        message: "SteppingThreadGroup 属性名必须用小写空格格式",
      });
    }
  }

  if (!content.includes("ResultCollector") && !content.includes("SummaryReport")) {
    issues.push({ severity: "warning", message: "建议包含聚合报告或查看结果树" });
  }

  return {
    valid: issues.filter((i) => i.severity === "fatal").length === 0,
    issues,
    warnings: issues.filter((i) => i.severity === "warning"),
  };
}

// ── 辅助函数 ──────────────────────────────────
function findStandardFile(id) {
  const dir = join(PKG_ROOT, "files", ".github", "standards");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith(id) && f.endsWith(".md"));
  return files.length > 0 ? join(dir, files[0]) : null;
}

function listStandards() {
  const dir = join(PKG_ROOT, "files", ".github", "standards");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => {
      const content = readFileSync(join(dir, f), "utf-8");
      const titleMatch = content.match(/^#\s+(.+)$/m);
      return {
        id: f.split("-")[0],
        file: f,
        title: titleMatch ? titleMatch[1] : f,
      };
    });
}

function checkCommand(cmd) {
  try {
    execSync(cmd, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export const HANDLERS = {
  wls_test_standards: handleStandards,
  wls_test_contract_read: handleContractRead,
  wls_test_case_generate: handleCaseGenerate,
  wls_test_smoke_select: handleSmokeSelect,
  wls_test_env_check: handleEnvCheck,
  wls_test_quality_analyze: handleQualityAnalyze,
  wls_test_jmeter_validate: handleJmeterValidate,
};
