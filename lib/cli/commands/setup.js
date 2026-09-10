/**
 * cli/commands/setup.js — 项目接入探测与引导（v0.21.0）
 *
 * 一条命令回答"这个项目怎么接入测试"：探测形态/接口描述来源 → 生成配置骨架 →
 * 输出给 AI 的标准作业指令（配合 .github/skills/onboarding/test-onboarding）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SWAGGER_PATHS = ["v3/api-docs", "api/v3/api-docs", "v2/api-docs"];

export async function probeSwagger(baseUrl) {
  for (const p of SWAGGER_PATHS) {
    const url = `${String(baseUrl).replace(/\/$/, "")}/${p}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { Accept: "application/json" } });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return { url, ok: true };
        continue; // yaml/HTML → 试下一个
      }
    } catch {
      // 不可达/超时 → 试下一个
    }
  }
  return { ok: false };
}

function findLocalOpenApi(cwd) {
  for (const name of ["openapi.json", "swagger.json", "api-docs.json"]) {
    for (const dir of [cwd, join(cwd, "docs")]) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function findApiDoc(cwd) {
  const candidates = ["api.md", "API.md"];
  for (const dir of [cwd, join(cwd, "docs")]) {
    for (const n of candidates) if (existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

export async function cmdSetup(parsed) {
  const { opts } = parsed;
  const cwd = process.cwd();
  const baseUrl = opts["base-url"] || opts.baseUrl;

  console.log(`\n[setup] 项目接入探测 — ${cwd}\n`);

  // ── 1. 项目形态 ──
  const isJava = existsSync(join(cwd, "pom.xml")) ? "Maven" : existsSync(join(cwd, "build.gradle")) ? "Gradle" : null;
  let shape = "未知";
  if (isJava) shape = `Java（${isJava}${existsSync(join(cwd, "src/main/java")) ? "，Spring 结构" : ""}）`;
  else if (existsSync(join(cwd, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    shape = `前端/Node（${deps.vue ? "Vue" : deps.react ? "React" : pkg.name}）`;
  }
  console.log(`项目形态: ${shape}`);

  // ── 2. 接口描述来源（优先级: Swagger URL > 本地 OpenAPI > api.md）──
  let source = null;
  if (baseUrl) {
    console.log(`探测 Swagger (${baseUrl}): ...`);
    const probe = await probeSwagger(baseUrl);
    if (probe.ok) {
      source = { type: "swagger-url", value: probe.url };
      console.log(`接口描述: ✅ OpenAPI 在线（${probe.url}）`);
    } else {
      console.log(`探测 Swagger: 未发现（v3/api-docs 等路径不可达或非 JSON）`);
    }
  }
  if (!source) {
    const local = findLocalOpenApi(cwd);
    if (local) {
      source = { type: "swagger-file", value: local };
      console.log(`接口描述: ✅ OpenAPI 本地文件（${local}）`);
    }
  }
  const apiDoc = findApiDoc(cwd);
  if (!source && apiDoc) {
    source = { type: "doc", value: apiDoc };
    console.log(`接口描述: 📄 接口文档（${apiDoc}，AI 提取 + validate 把关）`);
  }
  if (!source) {
    console.log(`接口描述: ❌ 未发现（Swagger/OpenAPI/api.md 均无）`);
  }

  // ── 3. 已安装状态 ──
  const inited = existsSync(join(cwd, ".github", "standards"));
  console.log(`规范/Skill: ${inited ? "✅ 已安装" : "❌ 未安装（先运行: npx @agile-team/wl-skills-test init）"}`);
  const nodeMajor = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
  console.log(`Node: ${process.version} ${nodeMajor >= 20 ? "✅" : "❌（需 ≥20）"}`);

  // ── 4. 配置骨架（不覆盖已有）──
  const configPath = join(cwd, "wl-test.config.json");
  if (existsSync(configPath)) {
    console.log(`环境配置: 已存在 ${configPath}（不覆盖）`);
  } else {
    const skeleton = {
      profiles: {
        default: { baseUrl: baseUrl || "http://localhost:8080" },
        sit: { baseUrl: baseUrl || "http://sit:8080", token: "$WL_TOKEN" },
        uat: { baseUrl: "http://uat:8080", token: "$WL_UAT_TOKEN" },
      },
      auth: { loginPath: "/login", usernameEnv: "WL_USER", passwordEnv: "WL_PASSWORD" },
    };
    writeFileSync(configPath, JSON.stringify(skeleton, null, 2), "utf-8");
    console.log(`环境配置: 已生成骨架 ${configPath}（sit/uat 档案 + auth 凭据走 $ENV 引用，请填写）`);
  }

  // ── 5. 给 AI 的标准作业指令（handoff）──
  console.log(`\n${"─".repeat(56)}`);
  console.log(`下一步（把下面这段话发给 AI 即可完成接入）:`);
  console.log(`${"─".repeat(56)}\n`);
  const contractHint =
    source?.type === "swagger-url"
      ? `从 ${source.value} 用 gen-contract --swagger 提取契约（按模块分次）`
      : source?.type === "swagger-file"
        ? `从 ${source.value} 用 gen-contract --swagger 提取契约`
        : source?.type === "doc"
          ? `按 .github/standards 的契约规范，从 ${source.value} 提取契约（AI 提取，必须过 validate-contract）`
          : `与后端确认接口定义来源后补契约（Swagger/OpenAPI/文档均可）`;
  console.log(`  按 .github/skills/onboarding/test-onboarding 的流程接入测试：`);
  console.log(`  1. ${contractHint} → wl-contract.json`);
  console.log(`  2. validate-contract 把关，未过不往下走`);
  console.log(`  3. 与我确认环境地址与凭据（填 wl-test.config.json，凭据用 $ENV 引用，不落明文）`);
  console.log(`  4. 试跑一个模块: run-api --contract wl-contract.json --profile sit`);
  console.log(`  5. 汇报摘要（结论+失败+诊断指引），问是否固化 CI（ci 命令）\n`);
}
