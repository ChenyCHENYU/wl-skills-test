/**
 * MCP 工具 Handler 实现
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { consumeContract, generateTestCaseMatrix } from "../../lib/contract-consumer.js";
import { generateSmokeSuite, calculateDI, exportCasesMarkdown } from "../../lib/test-codegen.js";
import { generateFineGrainedCases } from "../../lib/case-fine-gen.js";
import { audit, autoFix, checkSteppingThreadGroup } from "../../lib/test-audit.js";
import { runApiTests, generateSmokeReport } from "../../lib/api-executor.js";
import { runPlaywright, runJmeter } from "../../lib/executors.js";
import { generateE2eScaffold } from "../../lib/e2e-generator.js";
import { e2eCheck } from "../../lib/e2e-check.js";
import { syncDict } from "../../lib/dict-sync.js";
import { runGate } from "../../lib/gate.js";
import { generateReport } from "../../lib/report-generator.js";
import { diffContracts } from "../../lib/contract-diff.js";
import { renderHtmlReport } from "../../lib/report/html.js";
import { importOpenApi } from "../../lib/swagger-import.js";
import { readJsonFile, checkCommandAvailable, writeTextFile } from "../../lib/shared/utils.js";
import { observe, observeSync } from "../../lib/observed-execution.js";
import { planTask, taskStatus, hostDiagnostic } from "../../lib/cli/commands/tasks.js";
import { compactApiResult, compactAuditResult, compactReportResult } from "../../lib/shared/compact.js";
import { computePlanHash } from "../../lib/plan-hash.js";
import { confirmAndWrite } from "../../lib/write-guard.js";
import { collectFixTargets } from "../../lib/fix-targets.js";
import { describeSitTemplates, generateSitDelivery } from '../../lib/sit-delivery.js';
import { checkSitFile } from '../../lib/sit-execution.js';

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
    const payload = {
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
    // granularity=field：追加字段级细粒度用例（与 run-api DAG 映射）
    if (args.granularity === "field") {
      const fine = generateFineGrainedCases(result.summary);
      payload.fineGrainedCases = fine;
      payload.fineGrained = {
        count: fine.length,
        autoExecutable: fine.filter((c) => c.autoExec).length,
        byPriority: fine.reduce((m, c) => ({ ...m, [c.priority]: (m[c.priority] || 0) + 1 }), {}),
      };
      payload.caseCount += fine.length;
      if (args.granularity === "field") payload.fineCases = fine;
    }
    // token 经济学（v0.24.0 收尾）：默认紧凑——全量用例数组是 MCP 里最后一处 token 大头；
    // detail:"full" 才回全量，output 可落文件供离线消费
    if (args.output) {
      writeTextFile(args.output, JSON.stringify({ entity: payload.summary.entity, cases: payload.cases, fineCases: payload.fineCases ?? [] }, null, 2));
      payload.writtenTo = args.output;
    }
    if (args.detail !== "full") {
      payload.sample = payload.cases.slice(0, 5).map((c) => ({ id: c.id, name: c.name, type: c.type, priority: c.priority }));
      payload.hint = "计数与分布供决策；全量用例 detail:'full' 或读 writtenTo 文件";
      delete payload.cases;
      delete payload.fineCases;
    }
    return payload;
  }
  return {
    error: "需要 contractPath 参数（kit wl-api-contract 或 bd wl-contract.json）",
  };
}

// ── wls_test_smoke_select ──────────────────────
export function handleSmokeSelect(args) {
  const complexity = args.complexity || "medium";
  if (args.casePath && existsSync(args.casePath)) {
    // 坏 JSON 返回明确错误，而非抛异常被上层误标为 -32603 内部错误
    const { data: cases, error } = readJsonFile(args.casePath);
    if (error) return { error: `用例文件读取失败: ${error}` };
    if (!Array.isArray(cases)) return { error: "用例文件必须是 JSON 数组" };
    return generateSmokeSuite(cases, { complexity });
  }
  return {
    error: "需要 casePath 参数（全量用例 JSON 文件）",
  };
}

// ── wls_test_contract_diff ─────────────────────
export function handleContractDiff(args) {
  const { oldPath, newPath } = args;
  if (!oldPath || !existsSync(oldPath)) return { error: `旧契约不存在: ${oldPath}` };
  if (!newPath || !existsSync(newPath)) return { error: `新契约不存在: ${newPath}` };
  const result = diffContracts(oldPath, newPath);
  // token 经济学：结构化变更 + 受影响用例计数即可决策；全量 markdown 落文件
  if (args.output) {
    writeTextFile(args.output, result.markdown);
  }
  const a = result.affected;
  return {
    entity: result.entity,
    changeCount: result.changes.length,
    changes: result.changes.slice(0, typeof args.topN === "number" ? args.topN : 30),
    affectedCounts: { added: a.addedCases.length, removed: a.removedCases.length, rerun: a.rerunCases.length },
    addedCases: a.addedCases.slice(0, 50),
    removedCases: a.removedCases.slice(0, 50),
    rerunCases: a.rerunCases.slice(0, 50),
    changedFields: a.changedFields,
    reportFile: args.output ?? null,
    hint: "需重跑 run-api（新契约）覆盖变更字段；E2E 按变更字段核对定位器；detail markdown 见报告文件",
  };
}

// ── wls_test_gen_contract ──────────────────────
export async function handleGenContract(args) {
  try {
    const { contract, warnings } = await importOpenApi(args.swagger, {
      module: args.module,
      token: args.token,
    });
    if (args.output) writeTextFile(args.output, JSON.stringify(contract, null, 2));
    // token 经济学：紧凑结构化结果；全量契约在文件里（或 detail 需要 AI 自己读时用 contract_read）
    return {
      written: args.output ?? null,
      entity: contract.resource.entity,
      module: contract.resource.module,
      operations: Object.fromEntries(Object.entries(contract.operations).map(([k, o]) => [k, `${o.method} ${o.externalPath}`])),
      fieldCount: contract.models.createRequest.length,
      requiredCount: contract.models.createRequest.filter((f) => f.required).length,
      hasRecordModel: Boolean(contract.models.record),
      warnings,
      hint: "核对 warnings（尤其 successCode 默认 2000）→ wls_test_run_api 可直接执行该契约文件",
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── wls_test_env_check ─────────────────────────
export function handleEnvCheck(args = {}) {
  // 当前项目的本地前置条件，不借父项目资产，不使用可能自动下载依赖的 npx。
  const root = resolve(args.root || process.cwd());
  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  const checks = {
    root,
    nodeVersion: process.version,
    nodeOk: nodeMajor >= 20,
    playwright: ["@playwright/test", "playwright"].some(name => existsSync(join(root, "node_modules", name, "package.json"))),
    jmeter: checkCommandAvailable("jmeter --version").ok,
    standardsDir: existsSync(join(root, ".github", "standards")),
    skillsDir: existsSync(join(root, ".github", "skills")),
  };
  const allPass = checks.nodeOk && checks.standardsDir && checks.skillsDir;
  return { checks, ready: allPass, readinessScope: "local-prerequisites", networkConnectivity: "unverified",
    hint: "ready 仅表示本地 Node 与规范/技能资产前置条件；前端、后端、数据库连通性须另行实际验证" };
}

// ── wls_test_quality_analyze ───────────────────
export function handleQualityAnalyze(args = {}) {
  const defects = args.defects === undefined ? [] : args.defects;
  return calculateDI(defects, args.caseCount, { roundResults: args.roundResults });
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
  return checkCommandAvailable(cmd);
}

// ── wls_test_audit ─────────────────────────────
export function handleAudit(args) {
  const target = args.target || ".";
  const result = observeSync("audit", args, [target], () => audit(target));
  if (result.error) return result;
  // token 经济学：默认紧凑摘要（分布 + TopN 违规 + 修复入口）；detail:"full" 才回全量 findings
  if (args.detail === "full") return result;
  return compactAuditResult(result, { topN: typeof args.topN === "number" ? args.topN : 10 });
}

// ── wls_test_fix ───────────────────────────────
export function handleFix(args) {
  const target = args.target || ".";
  if (!existsSync(target)) return { error: "目标路径不存在" };

  // 安全约束：AI 可调用工具默认只预览，必须显式 confirm: true 才实际写文件
  const confirmed = args.confirm === true;
  let collected;
  try { collected = collectFixTargets(target, { projectRoot: args.root || process.cwd() }); }
  catch (error) { return { error: error.message, errorCode: error.code || "FIX_TARGET_ERROR", validationStatus: "unverified" }; }
  const { files, skippedEntries } = collected;
  const coverageStatus = !files.length ? "unverified" : skippedEntries.length ? "partial" : "complete";
  if (!files.length) return { error: "没有可安全修复的 JS/TS 样本", validationStatus: "unverified", skippedEntries, fixed: 0, total: 0 };
  if (!confirmed) {
    const preview = files
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
      coverageStatus,
      skippedEntries,
    };
  }

  const pendingWrites = [];
  const details = [];
  for (const file of files) {
    const result = autoFix(file);
    if (result.changed) {
      pendingWrites.push({ target: file, content: result.content });
      details.push({ file, fixes: result.fixes });
    }
  }
  if (pendingWrites.length > 0) {
    const writeResult = confirmAndWrite(pendingWrites, computePlanHash(pendingWrites));
    if (!writeResult.success) {
      return { error: "写入失败已回滚", errors: writeResult.errors, rollbackErrors: writeResult.rollbackErrors };
    }
  }
  return { fixed: pendingWrites.length, total: files.length, details, coverageStatus, skippedEntries,
    validationStatus: "unverified", hint: "自动修复不等于规则全部通过，请执行 audit 复验" };
}

// ── wls_test_run_api ───────────────────────────
export async function handleRunApi(args) {
  const { contractPath, baseUrl, token } = args;
  if (!contractPath || !existsSync(contractPath)) {
    return { error: "需要 contractPath 参数" };
  }
  const result = await observe("run-api", args, [contractPath, args.dictFile], () => runApiTests({
    contractPath,
    baseUrl: baseUrl || "http://localhost:8080",
    token,
    noPermToken: args.noPermToken,
    dictFile: args.dictFile,
    lenientCoercion: args.lenientCoercion === true,
    permWriteProbe: args.permWriteProbe === true,
    auth: args.auth && typeof args.auth === "object" ? args.auth : null,
  }));
  if (result.error) return result;
  // token 经济学：默认紧凑摘要（结论 + 失败 TopN + 诊断指引）；
  // 全量结果（含报文快照数十 KB）写文件或 detail:"full" 按需取
  if (args.output) {
    writeTextFile(args.output, JSON.stringify(result, null, 2));
    result.resultFile = args.output;
  }
  if (args.detail === "full") return result;
  return compactApiResult(result, { topN: typeof args.topN === "number" ? args.topN : 5 });
}

// ── wls_test_run_playwright ────────────────────
export async function handleRunPlaywright(args) {
  return observe("run-playwright", args, [args.testDir || "./tests"], () => runPlaywright({ testDir: args.testDir || "./tests" }));
}

// ── wls_test_run_jmeter ────────────────────────
export async function handleRunJmeter(args) {
  return observe("run-jmeter", args, [args.jmxPath], () => runJmeter({ jmxPath: args.jmxPath, threads: args.threads }));
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
    routes: args.routes,
    ui: args.ui,
    workstation: args.workstation === true,
  });
  return {
    outputDir,
    pageName: result.pageName,
    files: result.files,
    warnings: result.warnings || [],
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
    projectRoot: args.root || process.cwd(), runId: args.runId, strictCorrelation: true, allowLegacy: args.allowLegacy === true,
    api: args.api,
    playwright: args.playwright,
    jmeter: args.jmeter,
    audit: args.audit,
    defects: args.defects,
    cases: typeof args.cases === "number" ? args.cases : undefined,
    title: args.title,
    trend: args.trend === true,
    reportsDir: args.reportsDir,
  });
  if (result.error) return { error: result.error };
  // 单文件 HTML 交互报告（零依赖、数据内嵌、离线可看）——AI 只需回传路径，token 零消耗
  if (args.html === true) {
    const htmlPath = args.output ? args.output.replace(/\.md$/, "") + ".html" : join(args.reportsDir || "test-reports", "测试报告.html");
    writeTextFile(htmlPath, renderHtmlReport(result, { title: args.title }));
    return { written: htmlPath, pass: result.pass, score: result.score, hint: "HTML 单文件报告（数据内嵌）已生成，发给用户路径即可" };
  }
  if (args.output) {
    writeTextFile(args.output, result.report);
    // token 经济学：写文件时默认只回结论 + 未达标项（报告全文在文件里）
    if (args.detail === "full") return { written: args.output, ...result };
    return compactReportResult(result, { reportFile: args.output });
  }
  if (args.detail === "full") return result;
  return compactReportResult(result, {});
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
  if (typeof uri !== "string") return null;
  const m = uri.match(/^wl-test:\/\/standards\/([^/?#]+\.md)$/);
  if (!m) return null;
  const file = join(PKG_ROOT, "files", ".github", "standards", m[1]);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf-8");
}

/** Only registered tools are callable; inherited Object methods are not tools. */
export function getToolHandler(name) {
  return typeof name === "string" && Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : null;
}

// ── wls_test_e2e_check ─────────────────────────
export async function handleE2eCheck(args) {
  return observe("e2e-check", args, [args.target || "./e2e"], () => e2eCheck(args.target || "./e2e"));
}

// ── wls_test_dict_sync ─────────────────────────
export async function handleDictSync(args) {
  return syncDict({
    baseUrl: args.baseUrl,
    token: args.token,
    dictApi: args.dictApi,
    output: args.output || "./dict.json",
  });
}

// ── wls_test_gate ──────────────────────────────
export async function handleGate(args) {
  return observe("gate", args, [args.auditDir, args.e2eDir, args.smokeResult, args.defects, args.perfCurrent, args.perfBaseline], () => runGate({
    auditDir: args.auditDir,
    e2eDir: args.e2eDir,
    smokeResult: args.smokeResult,
    defects: args.defects,
    cases: args.cases,
    roundResults: args.roundResults,
    perfCurrent: args.perfCurrent,
    perfBaseline: args.perfBaseline,
    perfThreshold: args.perfThreshold !== undefined ? parseFloat(args.perfThreshold) || 15 : 15,
  }));
}

export function handleTask(args) {
  try {
    const action = args.action || "task";
    if (action === "status") return taskStatus(args);
    if (action === "doctor-host") return hostDiagnostic(args);
    if (!["task", "route", "explain"].includes(action)) return { error: "Unknown task action" };
    return planTask({ task: args.task, root: args.root || process.cwd(), runId: args.runId, skill: args.skill, context: { files: args.files || [], domain: args.domain } }, action === "task");
  } catch (error) { return { error: error.message }; }
}

export const HANDLERS = {
  wls_test_sit_templates: () => describeSitTemplates(),
  wls_test_sit_generate: (args) => generateSitDelivery(JSON.parse(readFileSync(args.inputFile, 'utf8')), { outputDir: args.outputDir, evidenceRoot: dirname(resolve(args.inputFile)) }),
  wls_test_sit_verify: checkSitFile,
  wls_test_task: handleTask,
  wls_test_standards: handleStandards,
  wls_test_contract_read: handleContractRead,
  wls_test_contract_diff: handleContractDiff,
  wls_test_gen_contract: handleGenContract,
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
  wls_test_e2e_check: handleE2eCheck,
  wls_test_dict_sync: handleDictSync,
  wls_test_gate: handleGate,
};
