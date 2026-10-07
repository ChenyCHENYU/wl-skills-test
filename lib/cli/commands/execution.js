/**
 * cli/commands/execution.js — run-api / run-playwright / run-jmeter / perf-compare / dict-sync
 */
import { existsSync, mkdirSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { runApiTests, generateSmokeReport } from "../../api-executor.js";
import { runPlaywright, runJmeter } from "../../executors.js";
import { perfCompare } from "../../perf-compare.js";
import { syncDict } from "../../dict-sync.js";
import { appendHistory, parsePlaywrightResults, renderE2eReport, renderPerfReport } from "../../report-dimensions.js";
import { writeTextFile } from "../../shared/utils.js";
import { observe, printExecution } from "../../observed-execution.js";
import { resolveOpts } from "../../config.js";
import { resolveReportsDir } from "../context.js";

export async function cmdRunApi(parsed) {
  const resolved = resolveOpts(parsed);
  const { opts, config } = resolved;
  const contractPath = opts.contract;
  const baseUrl = opts["base-url"] || "http://localhost:8080";
  const token = typeof opts.token === "string" ? opts.token : undefined;
  const noPermToken = opts["token-no-perm"] || opts.tokenNoPerm;
  const dictFile = opts["dict-file"] || opts.dictFile;
  const lenientCoercion = opts["lenient-coercion"] === true;
  const permWriteProbe = opts["perm-write-probe"] === true;
  const strictCode = opts["strict-code"] === true;
  // 数值参数下限校验（非法输入给用法错误，不产生怪诊断）
  const timeoutMs = opts.timeout !== undefined ? parseInt(opts.timeout, 10) : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1000)) {
    console.error(`❌ --timeout 必须 ≥1000（毫秒），当前: ${opts.timeout}\n`);
    process.exitCode = 2;
    return;
  }
  const maxDurationSec = opts["max-duration"] !== undefined ? parseInt(opts["max-duration"], 10) : undefined;
  if (maxDurationSec !== undefined && (!Number.isFinite(maxDurationSec) || maxDurationSec < 30)) {
    console.error(`❌ --max-duration 必须 ≥30（秒），当前: ${opts["max-duration"]}\n`);
    process.exitCode = 2;
    return;
  }
  const reportsDir = resolveReportsDir(opts);
  const output = opts.output || join(reportsDir, "api-报告.md");
  const jsonOutput = opts.json || join(reportsDir, "api-result.json");

  if (!contractPath) {
    console.log(`
用法: wl-skills-test run-api --contract <契约路径> [选项]

深度接口测试（DAG 编排 + 四层断言：成功码/结构/写后读回/负例与安全）:
  --base-url <URL>        目标基址（默认 http://localhost:8080）
  --token <token>         认证 token（自动补 Bearer）
  --token-no-perm <token> 无权限账号 token（启用权限拒绝验证）
  --dict-file <路径>       字典 JSON（{字段名: [合法值]}，提升枚举字段 payload 通过率）
  --lenient-coercion      类型负例被后端隐式转换时记 warn 而非 fail
  --perm-write-probe      允许对写操作做权限探针（意外成功自动清理）
  --output <报告.md>      Markdown 报告路径（默认 接口测试报告.md）
  --json <结果.json>      JSON 结果路径（供 quality-gate --smoke-result / report 消费）

执行链路: 列表冒烟 → 新增 → 写后读回比对 → 更新 → 详情 → 负例(必填/类型/超长)
          → 重复提交 → 权限拒绝 → 分页边界 → 清理 → 零污染复查
`);
    process.exitCode = 2; // 用法错误（缺必填参数）
    return;
  }

  if (!existsSync(contractPath)) {
    console.error(`❌ 契约文件不存在: ${contractPath}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[run-api] 执行 API 接口测试`);
  console.log(`  契约: ${contractPath}`);
  console.log(`  目标: ${baseUrl}\n`);

  try {
    const result = await observe("run-api", opts, [contractPath, dictFile], () => runApiTests({
      baseUrl,
      contractPath,
      token,
      noPermToken,
      dictFile,
      lenientCoercion,
      permWriteProbe,
      strictCode,
      timeout: timeoutMs,
      maxDurationMs: maxDurationSec !== undefined ? maxDurationSec * 1000 : undefined,
      // 认证适配（v0.16.0）：配置文件的 auth 段 → 无 token 自动登录 / 401 自动重登
      auth: config.auth && typeof config.auth === "object" ? config.auth : null,
    }));
    printExecution(result);
    if (result.error) {
      console.error(`❌ ${result.error}\n`);
      process.exitCode = 1;
      return;
    }

    const s = result.summary;
    // 布尔判定优先（新版结果自带 pass 字段）；旧格式退化为文案判断
    const apiPass = typeof s.pass === "boolean" ? s.pass : String(s.decision || "").startsWith("通过");
    console.log(`执行结果：\n`);
    console.log(`  实体:     ${s.entity}`);
    console.log(`  步骤:     ${s.total}（断言 ${s.assertions.total} 条）`);
    console.log(`  ✅ 通过:   ${s.passed}（含 warn ${s.warned}）`);
    console.log(`  ❌ 失败:   ${s.failed}`);
    console.log(`  ⚠️ 错误:   ${s.errors}`);
    console.log(`  ⏭️ 跳过:   ${s.skipped}`);
    if (s.negatives) console.log(`  负例:     ${s.negatives.passed}/${s.negatives.total} 通过（必填缺失/类型错误/超长）`);
    if (s.permissions) console.log(`  权限:     ${s.permissions.total > 0 ? `${s.permissions.passed}/${s.permissions.total} 通过` : "未启用（--token-no-perm）"}`);
    if (s.drift) {
      const d = s.drift.missing.length + s.drift.extra.length + s.drift.typeMismatch.length;
      console.log(`  契约漂移: ${d === 0 ? "无" : `${d} 项（缺失 ${s.drift.missing.length} / 未声明 ${s.drift.extra.length} / 类型 ${s.drift.typeMismatch.length}）`}`);
    }
    console.log(`  清理:     登记 ${s.cleanup.created} / 清理 ${s.cleanup.cleaned} / 复查${s.cleanup.verified ? "无残留" : "未验证"}`);
    console.log(`  通过率:   ${s.passRate}%`);
    console.log(`  结论:     ${s.decision}\n`);

    if (s.failed > 0 || s.errors > 0) {
      console.log("失败/错误详情：\n");
      for (const r of result.results) {
        if (r.status === "fail" || r.status === "error") {
          console.log(`  ❌ ${r.name}: ${r.reason}`);
          if (r.hint) console.log(`     💡 ${r.hint}`);
        }
      }
      console.log();
    }

    result.resultFile = jsonOutput;
    writeTextFile(output, generateSmokeReport(result));
    console.log(`接口测试报告已写入: ${output}`);
    writeTextFile(jsonOutput, JSON.stringify(result, null, 2));
    console.log(`JSON 结果已写入: ${jsonOutput}（可供 quality-gate --smoke-result / report 自动发现消费）`);
    appendHistory(reportsDir, { kind: "api", runId: result.runId, pass: apiPass, passRate: s.passRate, file: output });
    console.log(`运行历史已记录: ${join(reportsDir, "history.jsonl")}\n`);

    // CI 卡门：不通过时非零退出（消费布尔判定，不依赖中文文案）
    if (!apiPass) {
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(`❌ 执行失败: ${e.message}\n`);
    process.exitCode = 1;
  }
}

export async function cmdRunPlaywright(parsed) {
  const { opts } = parsed;
  const testDir = opts["test-dir"] || opts.target || "./tests";
  const reporter = opts.reporter || "list";
  const headed = opts.headed === true;

  console.log(`\n[run-playwright] 执行自动化测试: ${testDir}\n`);

  const result = await observe("run-playwright", opts, [testDir], () => runPlaywright({ testDir, reporter, headed }));

  printExecution(result);
  if (result.error) {
    console.error(`❌ ${result.error}`);
    if (result.hint) console.error(`   ${result.hint}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`结果：\n`);
  console.log(`  ✅ 通过: ${result.passed}`);
  console.log(`  ❌ 失败: ${result.failed}`);
  console.log(`  ⏭️ 跳过: ${result.skipped}`);
  if (result.flaky) console.log(`  🟡 不稳定: ${result.flaky}`);
  console.log(`  通过率: ${result.passRate}%`);
  console.log(`  结论:   ${result.decision}\n`);

  // JSON 结果 + E2E 维度报告（统一产出到 test-reports/）
  const reportsDir = resolveReportsDir(opts);
  const jsonOutput = opts.json || join(reportsDir, "playwright-result.json");
  writeTextFile(jsonOutput, JSON.stringify(result, null, 2));
  const e2eMd = join(reportsDir, "e2e-报告.md");
  const parsedPw = parsePlaywrightResults(result);
  if (parsedPw) {
    fsWriteFileSync(e2eMd, renderE2eReport(parsedPw, jsonOutput), "utf-8");
    const rate = parsedPw.total > 0 ? Math.round((parsedPw.passed / parsedPw.total) * 100) : 0;
    appendHistory(reportsDir, { kind: "e2e", runId: result.runId, pass: parsedPw.failed === 0 && rate >= 95, passRate: rate, file: e2eMd });
  }
  console.log(`JSON 结果已写入: ${jsonOutput}`);
  if (parsedPw) console.log(`E2E 维度报告已写入: ${e2eMd}\n`);

  if (result.output && result.failed > 0) {
    console.log("失败详情（末尾）：\n");
    console.log(result.output.slice(-1000));
    console.log();
  }

  // CI 卡门：不通过时非零退出（消费布尔判定，不依赖中文文案）
  if (result.pass === false) {
    process.exitCode = 1;
  }
}

export async function cmdRunJmeter(parsed) {
  const { opts } = parsed;
  const jmxPath = opts.jmx || opts.target;
  const threads = opts.threads ? parseInt(opts.threads) : 100;
  const resultDir = opts["result-dir"] || "./jmeter-results";

  if (!jmxPath) {
    console.log(`
用法: wl-skills-test run-jmeter --jmx <jmx路径> [--threads <并发数>] [--result-dir <结果目录>]
`);
    process.exitCode = 2; // 用法错误（缺必填参数）
    return;
  }

  console.log(`\n[run-jmeter] 执行性能测试: ${jmxPath} (${threads} 线程)\n`);

  const result = await observe("run-jmeter", opts, [jmxPath], () => runJmeter({ jmxPath, threads, resultDir }));

  printExecution(result);
  if (result.error) {
    console.error(`❌ ${result.error}`);
    if (result.hint) console.error(`   ${result.hint}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`结果：\n`);
  console.log(`  样本数: ${result.samples || 0}`);
  console.log(`  ✅ 成功: ${result.passed || 0}`);
  console.log(`  ❌ 失败: ${result.failed || 0}`);
  console.log(`  错误率: ${result.errorRate || 0}%`);
  console.log(`  P50:    ${result.p50 || 0}ms`);
  console.log(`  P95:    ${result.p95 || 0}ms`);
  console.log(`  P99:    ${result.p99 || 0}ms`);
  console.log(`  SLA:    ${result.sla || "-"}`);
  console.log(`  结论:   ${result.decision || "-"}\n`);

  if (result.reportPath) {
    console.log(`HTML 报告: ${result.reportPath}`);
  }

  // 性能维度报告 + JSON（统一产出到 test-reports/）
  const reportsDir = resolveReportsDir(opts);
  mkdirSync(reportsDir, { recursive: true });
  const perfMd = join(reportsDir, "perf-报告.md");
  fsWriteFileSync(perfMd, renderPerfReport(result, jmxPath), "utf-8");
  const perfJson = join(reportsDir, "perf-result.json");
  fsWriteFileSync(perfJson, JSON.stringify({ runId: result.runId, provenance: result.provenance, execution: result.execution, summary: result }, null, 2), "utf-8");
  appendHistory(reportsDir, { kind: "perf", runId: result.runId, pass: result.pass !== false, file: perfMd });
  console.log(`性能维度报告已写入: ${perfMd}\n`);

  // 压测+基线对比一条命令（v0.22.0）：自动用刚产出的 result.jtl 对比基线存档
  if (opts["baseline-compare"] === true) {
    const jtlPath = join(resultDir, "result.jtl");
    if (existsSync(jtlPath)) {
      console.log(`[baseline-compare] 压测结果自动对比基线...`);
      const cmp = await perfCompare({
        currentPath: jtlPath,
        autoBaseline: true,
        baselineStorePath: join(reportsDir, "perf-baseline.json"),
      });
      if (cmp.error) {
        console.error(`❌ ${cmp.error}\n`);
      } else if (cmp.baselineCreated) {
        console.log(`首次运行：基线已存档 ${cmp.baselineStorePath}\n`);
      } else {
        for (const m of cmp.metrics) {
          console.log(`  ${m.regressed ? "❌" : "✅"} ${m.metric}: ${m.baseline} → ${m.current}（${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}${m.metric === "errorRate" ? "pp" : "%"}）`);
        }
        console.log(`结论: ${cmp.summary.verdict}\n`);
      }
    }
  }

  // CI 卡门：不通过时非零退出（消费布尔判定）
  if (result.pass === false) {
    process.exitCode = 1;
  }
}

export async function cmdPerfCompare(parsed) {
  const { opts } = parsed;
  const current = opts.current;
  const baseline = opts.baseline;
  const threshold = opts.threshold ? parseFloat(opts.threshold) : 15;
  const autoBaseline = opts["auto-baseline"] === true;
  const updateBaseline = opts["update-baseline"] === true;

  if (!current || (!baseline && !autoBaseline)) {
    console.log(`
用法: wl-skills-test perf-compare --current <jtl或json> (--baseline <jtl或json> | --auto-baseline) [--threshold 15] [--update-baseline] [--output <报告>]

判定:
  P50/P95/P99 相对劣化超过阈值（默认 15%）→ 劣化
  错误率绝对上升超过 1pp → 劣化
  任一劣化 → 退出码 1（CI 卡门）

基线管理（--auto-baseline）:
  首次运行: 当前指标自动存档为基线（test-reports/perf-baseline.json），不做对比
  此后运行: 自动对比存档基线；确认优化到位后 --update-baseline 人工更新（防慢性漂移被吞）

示例:
  wl-skills-test perf-compare --current ./jmeter-results/result.jtl --auto-baseline
  wl-skills-test perf-compare --current result.jtl --baseline baseline.json --threshold 10
`);
    process.exitCode = 2; // 用法错误（缺必填参数）
    return;
  }

  const reportsDir = resolveReportsDir(opts);
  const result = await perfCompare({
    currentPath: current,
    baselinePath: baseline,
    threshold,
    autoBaseline,
    updateBaseline,
    baselineStorePath: autoBaseline ? join(reportsDir, "perf-baseline.json") : undefined,
  });
  printExecution(result);
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (result.baselineCreated) {
    console.log(`\n[perf-compare] ${result.summary.verdict}\n`);
    console.log(`基线存档: ${result.baselineStorePath}\n`);
    return;
  }

  console.log(`\n[perf-compare] 基线对比（阈值 ${threshold}%${autoBaseline ? `，基线存档 ${result.baselineStorePath}` : ""}）\n`);
  for (const m of result.metrics) {
    const unit = m.metric === "errorRate" ? "%" : "ms";
    const deltaText =
      m.deltaPct === Number.POSITIVE_INFINITY
        ? "基线为 0"
        : m.metric === "errorRate"
          ? `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}pp`
          : `${m.deltaPct > 0 ? "+" : ""}${m.deltaPct}%`;
    console.log(`  ${m.regressed ? "❌" : "✅"} ${m.metric.padEnd(10)} 基线 ${m.baseline}${unit} → 当前 ${m.current}${unit}（${deltaText}）`);
  }
  console.log(`\n结论: ${result.summary.verdict}${result.baselineUpdated ? "（基线已按 --update-baseline 更新）" : ""}\n`);

  const output = opts.output;
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    fsWriteFileSync(output, result.markdown, "utf-8");
    console.log(`报告已写入: ${output}\n`);
  } else {
    const reportsDir = resolveReportsDir(opts);
    mkdirSync(reportsDir, { recursive: true });
    const defaultOut = join(reportsDir, "perf-compare-报告.md");
    fsWriteFileSync(defaultOut, result.markdown, "utf-8");
    appendHistory(reportsDir, { kind: "perf-compare", pass: !result.regressed, file: defaultOut });
    console.log(`基线对比报告已写入: ${defaultOut}\n`);
  }
  // 结构化产物（v0.24.0 JSON 化）：劣化判定/指标供平台与 AI 直接消费
  if (opts.json) {
    writeTextFile(opts.json, JSON.stringify({ regressed: result.regressed, baselineCreated: result.baselineCreated ?? false, metrics: result.metrics, summary: result.summary, generatedAt: new Date().toISOString() }, null, 2));
    console.log(`JSON 结果已写入: ${opts.json}\n`);
  }

  if (result.regressed) {
    process.exitCode = 1;
  }
}

export async function cmdDictSync(parsed) {
  const resolved = resolveOpts(parsed);
  const { opts } = resolved;
  const baseUrl = opts["base-url"];
  const token = typeof opts.token === "string" ? opts.token : undefined;
  const dictApi = opts["dict-api"] || "/pl/system/dict/all";
  const output = opts.output || "dict.json";
  const maps = Array.isArray(opts.map) ? opts.map : opts.map ? [opts.map] : [];

  if (!baseUrl) {
    console.log(`
用法: wl-skills-test dict-sync --base-url <URL> [--token <token>] [--dict-api <路径>] [--output <文件>] [--map 字段=字典码 ...]

拉取系统字典并归一化为 { dictCode: [合法值] }，供 run-api --dict-file / round2 / 负例消费。
兼容三种响应形态（map-of-arrays / 列表式 / map-of-items，自动识别）。

示例:
  wl-skills-test dict-sync --base-url http://sit:8080 --token "$TOKEN" --output e2e/fixtures/dict.json
  wl-skills-test dict-sync --base-url http://sit:8080 --map plant_code=pl_plant_code --map status=pl_yes_no
`);
    process.exitCode = 2; // 用法错误（缺必填参数）
    return;
  }

  console.log(`\n[dict-sync] ${baseUrl}${dictApi} → ${output}\n`);
  const result = await syncDict({ baseUrl, token, dictApi, output, maps });
  printExecution(result);
  if (result.error) {
    console.error(`❌ ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✅ 字典码: ${result.dictCodes} 个，共 ${result.totalValues} 个合法值`);
  for (const [code, values] of Object.entries(result.samples)) {
    console.log(`     ${code}: ${values.slice(0, 3).join(" / ")}${values.length > 3 ? " …" : ""}`);
  }
  console.log(`\n已写入: ${result.output}（run-api --dict-file / round2 自动消费）\n`);
}
