/**
 * MCP 工具 Handler 实现
 */
import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
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
import { inspectInstallation } from "../../lib/host-diagnostics.js";
import integrationSupport from "../../lib/project-integration.cjs";
import saxes from "../../lib/vendor/saxes/saxes.js";
import { planTask, taskStatus, hostDiagnostic } from "../../lib/cli/commands/tasks.js";
import { compactApiResult, compactAuditResult, compactReportResult } from "../../lib/shared/compact.js";
import { computePlanHash } from "../../lib/plan-hash.js";
import { confirmAndWrite } from "../../lib/write-guard.js";
import { collectFixTargets } from "../../lib/fix-targets.js";
import { describeSitTemplates, generateSitDelivery } from '../../lib/sit-delivery.js';
import { checkSitFile } from '../../lib/sit-execution.js';
import { createMcpNetworkContext } from "../network-profile.js";

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
export function handleContractRead(args, network) {
  const path = args.path && (network?.pathWithinProject(args.path) ?? args.path);
  if (!path || !existsSync(path)) {
    return { error: "契约文件路径无效或不存在" };
  }
  const result = consumeContract(path, { validateInputPath: network?.pathWithinProject });
  return {
    type: result.type,
    summary: result.summary,
  };
}

// ── wls_test_case_generate ─────────────────────
export function handleCaseGenerate(args, network) {
  const contractPath = args.contractPath && (network ? network.pathWithinProject(args.contractPath) : args.contractPath);
  if (contractPath && existsSync(contractPath)) {
    const result = consumeContract(contractPath, { validateInputPath: network?.pathWithinProject });
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
      (network?.writeOutputFile || writeTextFile)(args.output, JSON.stringify({ entity: payload.summary.entity, cases: payload.cases, fineCases: payload.fineCases ?? [] }, null, 2));
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
export function handleSmokeSelect(args, network) {
  const complexity = args.complexity || "medium";
  const casePath = args.casePath && (network?.pathWithinProject(args.casePath) ?? args.casePath);
  if (casePath && existsSync(casePath)) {
    // 坏 JSON 返回明确错误，而非抛异常被上层误标为 -32603 内部错误
    const { data: cases, error } = readJsonFile(casePath);
    if (error) return { error: `用例文件读取失败: ${error}` };
    if (!Array.isArray(cases)) return { error: "用例文件必须是 JSON 数组" };
    return generateSmokeSuite(cases, { complexity });
  }
  return {
    error: "需要 casePath 参数（全量用例 JSON 文件）",
  };
}

// ── wls_test_contract_diff ─────────────────────
export function handleContractDiff(args, network) {
  const oldPath = network ? network.pathWithinProject(args.oldPath) : args.oldPath;
  const newPath = network ? network.pathWithinProject(args.newPath) : args.newPath;
  if (!oldPath || !existsSync(oldPath)) return { error: `旧契约不存在: ${oldPath}` };
  if (!newPath || !existsSync(newPath)) return { error: `新契约不存在: ${newPath}` };
  const result = diffContracts(oldPath, newPath, { validateInputPath: network?.pathWithinProject });
  // token 经济学：结构化变更 + 受影响用例计数即可决策；全量 markdown 落文件
  if (args.output) {
    (network?.writeOutputFile || writeTextFile)(args.output, result.markdown);
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
export async function handleGenContract(args, network = createMcpNetworkContext()) {
  let profile;
  try {
    profile = args.profile ? network.resolveProfile(args.profile) : null;
    const source = profile ? profile.swaggerUrl : network.pathWithinProject(args.swagger);
    const output = args.output && network.checkOutputFile(args.output);
    const imported = await importOpenApi(source, {
      module: args.module,
      token: profile?.token,
      fetchImpl: profile?.fetchImpl,
    });
    const { contract, warnings } = profile ? profile.redact(imported) : imported;
    if (output) network.writeOutputFile(output, JSON.stringify(contract, null, 2));
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
    return { error: profile ? profile.redact(e.message) : e.message, errorCode: e.code || "OPENAPI_IMPORT_FAILED" };
  }
}

// ── wls_test_env_check ─────────────────────────
export function handleEnvCheck(args = {}, network) {
  // 当前项目的本地前置条件，不借父项目资产，不使用可能自动下载依赖的 npx。
  const root = network?.requireProjectRoot(args.root) ?? resolve(args.root || process.cwd());
  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  const installation = inspectInstallation(root);
  const checks = {
    root,
    nodeVersion: process.version,
    nodeOk: nodeMajor >= 20,
    playwright: ["@playwright/test", "playwright"].some(name => existsSync(join(root, "node_modules", name, "package.json"))),
    jmeter: checkCommandAvailable("jmeter --version").ok,
    standardsDir: installation.installed && existsSync(integrationSupport.resolveResourcePath(root, ".github/standards/01-test-process.md", PKG_ROOT)),
    skillsDir: installation.installed && installation.skills.missing.length === 0,
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
export function handleJmeterValidate(args, network) {
  const jmxPath = args.jmxPath && (network?.pathWithinProject(args.jmxPath) ?? args.jmxPath);
  if (!jmxPath || !existsSync(jmxPath)) {
    return { error: "jmx 文件路径无效" };
  }

  const content = readFileSync(jmxPath, "utf-8");
  const issues = [];
  let root;
  const elements = new Set();
  let mixedTestPlan = false;
  try {
    const parser = new saxes.SaxesParser();
    parser.on("doctype", () => { throw new Error("DOCTYPE"); });
    parser.on("opentag", tag => {
      root ??= tag.name;
      elements.add(tag.name);
      mixedTestPlan ||= tag.name === "ConfigTestElement" && tag.attributes.guiclass === "TestPlanGui";
    });
    parser.write(content).close();
  } catch {
    return { valid: false, issues: [{ severity: "fatal", message: "JMX XML 格式无效或包含 DOCTYPE" }], warnings: [] };
  }

  if (root !== "jmeterTestPlan") {
    issues.push({ severity: "fatal", message: "缺少 <jmeterTestPlan> 根元素" });
  }
  if (!["ThreadGroup", "SteppingThreadGroup", "SetupThreadGroup", "PostThreadGroup"].some(tag => elements.has(tag))) {
    issues.push({ severity: "fatal", message: "缺少线程组 <ThreadGroup>" });
  }
  if (mixedTestPlan) {
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

  if (!elements.has("ResultCollector") && !elements.has("SummaryReport")) {
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
export function handleAudit(args, network) {
  const requestedTarget = args.target || ".";
  const target = network?.pathWithinProject(requestedTarget) ?? requestedTarget;
  const options = network ? { ...args, root: network.requireProjectRoot(args.root), reportsDir: network.pathWithinProject(args.reportsDir || "test-reports", { output: true }) } : args;
  const result = observeSync("audit", options, [target], () => audit(target), network);
  if (result.error) return result;
  // token 经济学：默认紧凑摘要（分布 + TopN 违规 + 修复入口）；detail:"full" 才回全量 findings
  if (args.detail === "full") return result;
  return compactAuditResult(result, { topN: typeof args.topN === "number" ? args.topN : 10 });
}

// ── wls_test_fix ───────────────────────────────
export function handleFix(args, network) {
  const target = args.target || ".";
  // 安全约束：AI 可调用工具默认只预览，必须显式 confirm: true 才实际写文件
  const confirmed = args.confirm === true;
  let collected;
  try { collected = collectFixTargets(target, { projectRoot: network?.requireProjectRoot(args.root) ?? args.root ?? process.cwd() }); }
  catch (error) { return { error: error.message, errorCode: error.code || "FIX_TARGET_ERROR", validationStatus: "unverified" }; }
  const { files, skippedEntries } = collected;
  const coverageStatus = !files.length ? "unverified" : skippedEntries.length ? "partial" : "complete";
  if (!files.length) return { error: "没有可安全修复的 JS/TS 样本", validationStatus: "unverified", skippedEntries, fixed: 0, total: 0 };
  const pendingWrites = [];
  const details = [];
  for (const file of files) {
    const result = autoFix(file);
    if (result.changed) {
      pendingWrites.push({ target: file, content: result.content, beforeHash: result.sourceHash });
      details.push({ file, fixes: result.fixes });
    }
  }
  const planHash = computePlanHash(pendingWrites);
  if (!confirmed) return {
    dryRun: true, planHash, fileCount: pendingWrites.length,
    hint: "预览模式。评审后传 confirm: true 和同一 planHash；源文件变化时须重新预览",
    files: details.slice(0, 20), previewTruncated: details.length > 20,
    coverageStatus, skippedEntries,
  };
  if (typeof args.planHash !== "string" || args.planHash !== planHash) return {
    error: "缺少原预览planHash或计划已变化，拒绝写入；请重新预览并确认",
    errorCode: "plan-hash-mismatch", written: 0, currentPlanHash: planHash, coverageStatus, skippedEntries,
    validationStatus: "unverified",
  };
  if (pendingWrites.length > 0) {
    const writeResult = confirmAndWrite(pendingWrites, args.planHash);
    if (!writeResult.success) {
      return { error: writeResult.reason || "写入失败已回滚", errorCode: "fix-write-failed", written: 0, errors: writeResult.errors, rollbackErrors: writeResult.rollbackErrors };
    }
  }
  return { fixed: pendingWrites.length, total: files.length, details, coverageStatus, skippedEntries,
    validationStatus: "unverified", hint: "自动修复不等于规则全部通过，请执行 audit 复验" };
}

// ── wls_test_run_api ───────────────────────────
export async function handleRunApi(args, network = createMcpNetworkContext()) {
  if (args.root && (!existsSync(resolve(network.root, args.root)) || realpathSync(resolve(network.root, args.root)) !== network.root)) {
    return { error: "root 必须与 MCP 启动项目一致", errorCode: "MCP_PROJECT_SCOPE" };
  }
  const profile = network.resolveProfile(args.profile, { writes: true });
  const contractPath = network.pathWithinProject(args.contractPath);
  const dictFile = args.dictFile && network.pathWithinProject(args.dictFile);
  const output = args.output && network.checkOutputFile(args.output);
  const reportsDir = network.pathWithinProject(args.reportsDir || "test-reports", { output: true });
  const result = await observe("run-api", { ...args, root: network.root, reportsDir }, [contractPath, dictFile], async () => {
    if (!existsSync(contractPath)) return { error: "contractPath 不存在或未提供", errorCode: "CONTRACT_NOT_FOUND" };
    try {
      network.assertProfileFresh();
      const executed = await runApiTests({
        contractPath,
        baseUrl: profile.baseUrl,
        token: profile.token,
        noPermToken: profile.noPermToken,
        auth: profile.auth,
        fetchImpl: profile.fetchImpl,
        validateDestination: profile.validateDestination,
        validateInputPath: network.pathWithinProject,
        includeSnapshotBodies: false,
        dictFile,
        lenientCoercion: args.lenientCoercion === true,
        permWriteProbe: args.permWriteProbe === true,
        requireScopedCleanup: true,
      });
      return { ...profile.redact(executed), profile: args.profile,
        ...(!network.profileIsFresh() ? { profileSourceChanged: true } : {}),
      };
    } catch (error) {
      return { error: profile.redact(error.message), errorCode: error.code || "API_TEST_FAILED" };
    }
  }, network);
  if (result.error) return result;
  // token 经济学：默认紧凑摘要（结论 + 失败 TopN + 诊断指引）；
  // 全量结果按需落文件；MCP 快照保留请求位置、状态与耗时，省略原始报文。
  if (output) {
    try {
      network.writeOutputFile(output, JSON.stringify(result, null, 2));
      result.resultFile = args.output;
    } catch {
      return { ...result, error: "执行回执已记录，指定的输出文件无法安全保存；请用同一 runId 查询实际执行结果", errorCode: "MCP_REPORT_WRITE_FAILED" };
    }
  }
  if (args.detail === "full") return result;
  return compactApiResult(result, { topN: typeof args.topN === "number" ? args.topN : 5 });
}

// ── wls_test_run_playwright ────────────────────
export async function handleRunPlaywright(args, network) {
  const requestedDir = args.testDir || "./tests";
  const testDir = network?.pathWithinProject(requestedDir) ?? requestedDir;
  const options = network ? { ...args, root: network.requireProjectRoot(args.root), reportsDir: network.pathWithinProject(args.reportsDir || "test-reports", { output: true }) } : args;
  return observe("run-playwright", options, [testDir], () => runPlaywright({ testDir, cwd: network?.root }), network);
}

// ── wls_test_run_jmeter ────────────────────────
export async function handleRunJmeter(args, network) {
  const jmxPath = network ? network.pathWithinProject(args.jmxPath) : args.jmxPath;
  const reportsDir = network?.pathWithinProject(args.reportsDir || "test-reports", { output: true });
  const resultDir = network?.pathWithinProject("jmeter-results", { output: true });
  const options = network ? { ...args, root: network.root, reportsDir } : args;
  return observe("run-jmeter", options, [jmxPath], () => runJmeter({ jmxPath, threads: args.threads, cwd: network?.root, resultDir }), network);
}

// ── wls_test_e2e_generate ──────────────────────
export function handleE2eGenerate(args, network) {
  const contractPath = args.contractPath && (network?.pathWithinProject(args.contractPath) ?? args.contractPath);
  if (!contractPath || !existsSync(contractPath)) {
    return { error: "需要 contractPath 参数（page-spec.json 或契约文件）" };
  }
  const outputDir = args.outputDir || "./e2e";
  const result = generateE2eScaffold(contractPath, {
    outputDir: network?.pathWithinProject(outputDir, { output: true }) ?? outputDir,
    baseUrl: args.baseUrl,
    routes: args.routes && (network?.pathWithinProject(args.routes) ?? args.routes),
    validateInputPath: network?.pathWithinProject,
    checkOutputFile: network?.checkOutputFile,
    writeOutputFile: network?.writeOutputFile,
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
export function handleReportGenerate(args, network) {
  const source = (name) => args[name] && (network?.pathWithinProject(args[name]) ?? args[name]);
  const reportsDir = source("reportsDir") ?? (network && args.trend ? network.pathWithinProject("test-reports") : undefined);
  const output = args.html === true
    ? args.output ? args.output.replace(/\.md$/, "") + ".html" : join(reportsDir || "test-reports", "测试报告.html")
    : args.output;
  if (output) network?.checkOutputFile(output);
  const result = generateReport({
    projectRoot: network?.requireProjectRoot(args.root) ?? args.root ?? process.cwd(), runId: args.runId, strictCorrelation: true, allowLegacy: args.allowLegacy === true,
    api: source("api"),
    playwright: source("playwright"),
    jmeter: source("jmeter"),
    audit: source("audit"),
    defects: source("defects"),
    cases: typeof args.cases === "number" ? args.cases : undefined,
    title: args.title,
    trend: args.trend === true,
    reportsDir,
    validateInputPath: network?.pathWithinProject,
  });
  if (result.error) return { error: result.error };
  const status = { reportStatus: "generated", quality: { pass: result.pass, decision: result.decision, validationStatus: result.validationStatus } };
  if (output) (network?.writeOutputFile || writeTextFile)(output, args.html === true ? renderHtmlReport(result, { title: args.title }) : result.report);
  if (args.html === true) return { ...status, written: output, pass: result.pass, score: result.score, hint: "HTML 单文件报告（数据内嵌）已生成" };
  if (args.detail === "full") return { ...result, ...status, ...(output ? { written: output } : {}) };
  const summary = compactReportResult(result, { reportFile: output });
  if (!result.pass && summary.failingChecks.length === 0) summary.hint = `已生成报告；验证状态 ${result.validationStatus}，仍缺任务通过证据。`;
  return { ...summary, ...status };
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
export async function handleE2eCheck(args, network) {
  const target = network?.pathWithinProject(args.target || "./e2e") ?? args.target ?? "./e2e";
  const options = network ? { ...args, root: network.root, reportsDir: network.pathWithinProject(args.reportsDir || "test-reports", { output: true }) } : args;
  return observe("e2e-check", options, [target], () => e2eCheck(target), network);
}

// ── wls_test_dict_sync ─────────────────────────
export async function handleDictSync(args, network = createMcpNetworkContext()) {
  const profile = network.resolveProfile(args.profile);
  return profile.redact(await syncDict({
    baseUrl: profile.baseUrl,
    token: profile.token,
    dictApi: profile.dictApi,
    fetchImpl: profile.fetchImpl,
    redact: profile.redact,
    output: network.checkOutputFile(args.output || "dict.json"),
    writeOutputFile: network.writeOutputFile,
  }));
}

// ── wls_test_gate ──────────────────────────────
export async function handleGate(args, network) {
  if (network) {
    args = { ...args, root: network.root, reportsDir: network.pathWithinProject(args.reportsDir || "test-reports", { output: true }) };
    for (const key of ["auditDir", "e2eDir", "smokeResult", "defects", "perfCurrent", "perfBaseline"]) {
      if (args[key]) args[key] = network.pathWithinProject(args[key]);
    }
  }
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
  }), network);
}

export function handleTask(args, network) {
  try {
    if (network) args = { ...args, root: network.requireProjectRoot(args.root), files: args.files?.map(file => network.pathWithinProject(file)) };
    const action = args.action || "task";
    if (action === "status") return taskStatus(args);
    if (action === "doctor-host") return hostDiagnostic(args);
    if (!["task", "route", "explain"].includes(action)) return { error: "Unknown task action" };
    return planTask({ task: args.task, root: args.root || process.cwd(), runId: args.runId, skill: args.skill, context: { files: args.files || [], domain: args.domain } }, action === "task", network?.requireProjectRoot);
  } catch (error) { return { error: error.message, ...(error.code ? { errorCode: error.code } : {}) }; }
}

export const HANDLERS = {
  wls_test_sit_templates: () => describeSitTemplates(),
  wls_test_sit_generate: (args, network) => {
    const inputFile = network ? network.pathWithinProject(args.inputFile) : args.inputFile;
    const outputDir = network ? network.pathWithinProject(args.outputDir, { output: true }) : args.outputDir;
    return generateSitDelivery(JSON.parse(readFileSync(inputFile, 'utf8')), { outputDir, evidenceRoot: dirname(resolve(inputFile)) });
  },
  wls_test_sit_verify: (args, network) => checkSitFile(network ? { ...args,
    inputFile: network.pathWithinProject(args.inputFile), root: network.requireProjectRoot(args.root),
  } : args),
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
