/**
 * MCP 工具 Handler 实现
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { consumeContract, generateTestCaseMatrix } from "../../lib/contract-consumer.js";
import { generateSmokeSuite, calculateDI, exportCasesMarkdown } from "../../lib/test-codegen.js";
import { audit, autoFix, checkSteppingThreadGroup } from "../../lib/test-audit.js";
import { runApiTests, generateSmokeReport } from "../../lib/api-executor.js";
import { runPlaywright, runJmeter } from "../../lib/executors.js";
import { generateE2eScaffold } from "../../lib/e2e-generator.js";
import { generateReport } from "../../lib/report-generator.js";

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
  // 优先用显式 root；否则从 cwd 向上探测 .github（MCP server 的 cwd 不一定是项目根）
  const root = args.root || findProjectRoot(process.cwd());
  const checks = {
    root,
    nodeVersion: process.version,
    playwright: checkCommand("npx playwright --version"),
    jmeter: checkCommand("jmeter --version"),
    standardsDir: existsSync(join(root, ".github", "standards")),
    skillsDir: existsSync(join(root, ".github", "skills")),
  };
  const allPass = checks.standardsDir && checks.skillsDir;
  return { checks, ready: allPass };
}

function findProjectRoot(start) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".github", "standards")) || existsSync(join(dir, ".github", "skills"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
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

  const steppingMatch = content.match(/<SteppingThreadGroup[\s\S]*?(?:<\/SteppingThreadGroup>|\/>)/);
  if (steppingMatch && checkSteppingThreadGroup(content)) {
    issues.push({
      severity: "fatal",
      message: "SteppingThreadGroup 属性名必须用小写空格格式",
    });
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

// ── wls_test_audit ─────────────────────────────
export function handleAudit(args) {
  const target = args.target || ".";
  if (!existsSync(target)) return { error: "目标路径不存在" };
  return audit(target);
}

// ── wls_test_fix ───────────────────────────────
export function handleFix(args) {
  const target = args.target || ".";
  if (!existsSync(target)) return { error: "目标路径不存在" };

  // 安全约束：AI 可调用工具默认只预览，必须显式 confirm: true 才实际写文件
  const confirmed = args.confirm === true;
  if (!confirmed) {
    const preview = collectFixFiles(target)
      .slice(0, 20)
      .map((file) => {
        const result = autoFix(file);
        return { file, fixes: result.fixes };
      })
      .filter((r) => r.fixes.length > 0);
    return {
      dryRun: true,
      hint: "预览模式。确认后传 confirm: true 执行实际写入",
      files: preview,
    };
  }

  const files = collectFixFiles(target);
  let fixed = 0;
  const details = [];
  for (const file of files) {
    const result = autoFix(file);
    if (result.changed) {
      writeFileSync(file, result.content, "utf-8");
      fixed++;
      details.push({ file, fixes: result.fixes });
    }
  }
  return { fixed, total: files.length, details };
}

function collectFixFiles(target) {
  const stat = statSync(target);
  const files = [];
  if (stat.isDirectory()) {
    const walk = (dir) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        const s = statSync(full);
        if (s.isDirectory() && !e.startsWith("node_modules") && !e.startsWith(".")) walk(full);
        else if (s.isFile() && (e.endsWith(".js") || e.endsWith(".ts"))) files.push(full);
      }
    };
    walk(target);
  } else {
    files.push(target);
  }
  return files;
}

// ── wls_test_run_api ───────────────────────────
export async function handleRunApi(args) {
  const { contractPath, baseUrl, token } = args;
  if (!contractPath || !existsSync(contractPath)) {
    return { error: "需要 contractPath 参数" };
  }
  const result = await runApiTests({
    contractPath,
    baseUrl: baseUrl || "http://localhost:8080",
    token,
  });
  return result;
}

// ── wls_test_run_playwright ────────────────────
export function handleRunPlaywright(args) {
  return runPlaywright({ testDir: args.testDir || "./tests" });
}

// ── wls_test_run_jmeter ────────────────────────
export function handleRunJmeter(args) {
  return runJmeter({ jmxPath: args.jmxPath, threads: args.threads || 100 });
}

// ── wls_test_e2e_generate ──────────────────────
export function handleE2eGenerate(args) {
  const contractPath = args.contractPath;
  if (!contractPath || !existsSync(contractPath)) {
    return { error: "需要 contractPath 参数（page-spec.json 或契约文件）" };
  }
  const outputDir = args.outputDir || "./e2e";
  const result = generateE2eScaffold(contractPath, {
    outputDir,
    baseUrl: args.baseUrl,
  });
  return {
    outputDir,
    pageName: result.pageName,
    files: result.files,
    next: [
      "cd e2e && npm i -D @playwright/test && npx playwright install chromium",
      "设置 E2E_BASE_URL / E2E_API_BASE / E2E_API_PREFIX",
      "npx playwright test --project=round1-readonly",
      "写入套件需 E2E_ENABLE_WRITE=1 E2E_WRITE_CONFIRM=<确认串>",
    ],
  };
}

// ── wls_test_report_generate ───────────────────
export function handleReportGenerate(args) {
  const result = generateReport({
    api: args.api,
    playwright: args.playwright,
    jmeter: args.jmeter,
    defects: args.defects,
    cases: args.cases,
    title: args.title,
  });
  if (result.error) return { error: result.error };
  if (args.output) {
    writeFileSync(args.output, result.report, "utf-8");
    return { written: args.output, pass: result.pass, decision: result.decision };
  }
  return { pass: result.pass, decision: result.decision, report: result.report };
}

// ── MCP resources（standards 只读资源）──────────
export function listStandardResources() {
  const dir = join(PKG_ROOT, "files", ".github", "standards");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const content = readFileSync(join(dir, f), "utf-8");
      const titleMatch = content.match(/^#\s+(.+)$/m);
      return {
        uri: `wl-test://standards/${f}`,
        name: titleMatch ? titleMatch[1] : f,
        mimeType: "text/markdown",
      };
    });
}

export function readStandardResource(uri) {
  const m = String(uri).match(/^wl-test:\/\/standards\/([^/?#]+\.md)$/);
  if (!m) return null;
  const file = join(PKG_ROOT, "files", ".github", "standards", m[1]);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}

export const HANDLERS = {
  wls_test_standards: handleStandards,
  wls_test_contract_read: handleContractRead,
  wls_test_case_generate: handleCaseGenerate,
  wls_test_smoke_select: handleSmokeSelect,
  wls_test_env_check: handleEnvCheck,
  wls_test_quality_analyze: handleQualityAnalyze,
  wls_test_jmeter_validate: handleJmeterValidate,
  wls_test_audit: handleAudit,
  wls_test_fix: handleFix,
  wls_test_run_api: handleRunApi,
  wls_test_run_playwright: handleRunPlaywright,
  wls_test_run_jmeter: handleRunJmeter,
  wls_test_e2e_generate: handleE2eGenerate,
  wls_test_report_generate: handleReportGenerate,
};
