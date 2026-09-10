/**
 * cli/commands/gen-contract.js — 从 OpenAPI/Swagger 生成测试契约（v0.21.0 接入故事核心）
 */
import { existsSync } from "node:fs";
import { importOpenApi } from "../../swagger-import.js";
import { validateContractData } from "../../contract-validate.js";
import { writeTextFile } from "../../shared/utils.js";

export async function cmdGenContract(parsed) {
  const { opts } = parsed;
  const source = opts.swagger || opts.openapi;
  if (!source) {
    console.log(`
用法: wl-skills-test gen-contract --swagger <URL或openapi.json> [--module order] [--entity 订单] [--success-code 2000] [--output wl-contract.json] [--force]

从后端已有的 OpenAPI(Swagger) 接口描述直接生成测试契约——人不再手写第二份契约。
  URL:  http://sit:8080/v3/api-docs（springdoc 默认，返回 JSON）
  文件: 本地 openapi.json（YAML 请经 URL 或先转 JSON）

识别规则（确定性）: queryPage/page/list→page；getById/detail→detail；save/create/add→create；
  update/edit→update；delete/remove→remove。字段（required/maxLength/min·max/枚举）全保留。
核对点: OpenAPI 不含业务成功码（默认 2000，jh4j 惯例，--success-code 可改）与登录鉴权语义。

示例:
  wl-skills-test gen-contract --swagger http://sit:8080/v3/api-docs --module order
`);
    process.exitCode = 2;
    return;
  }

  console.log(`\n[gen-contract] 从 OpenAPI 提取契约: ${source}\n`);
  let result;
  try {
    result = await importOpenApi(source, {
      module: opts.module,
      entity: opts.entity,
      successCode: opts.successCode ? parseInt(opts.successCode, 10) : undefined,
    });
  } catch (e) {
    console.error(`❌ ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  const { contract, warnings } = result;
  const opCount = Object.keys(contract.operations).length;
  console.log(`实体: ${contract.resource.entity}（module=${contract.resource.module}）`);
  console.log(`操作: ${opCount} 个 — ${Object.entries(contract.operations).map(([k, o]) => `${k}→${o.method} ${o.externalPath}`).join("；")}`);
  console.log(`字段: ${contract.models.createRequest.length} 个（required×${contract.models.createRequest.filter((f) => f.required).length}）`);
  if (warnings.length > 0) {
    console.log(`\n需人工核对（${warnings.length}）:`);
    for (const w of warnings) console.log(`  ⚠️ ${w}`);
  }

  const check = validateContractData(contract);
  if (!check.valid) {
    console.error(`\n❌ 转换结果未通过契约校验（不应发生，请反馈）:\n${check.findings.filter((f) => f.severity === "error").map((f) => `  - ${f.message}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  const output = opts.output || "wl-contract.json";
  if (existsSync(output) && opts.force !== true) {
    console.error(`\n已存在 ${output}（--force 覆盖）\n`);
    process.exitCode = 1;
    return;
  }
  writeTextFile(output, JSON.stringify(contract, null, 2));
  console.log(`\n✅ 契约已写入: ${output}`);
  console.log(`下一步:`);
  console.log(`  1. 按上方"需人工核对"项确认（尤其 successCode）`);
  console.log(`  2. wl-skills-test validate-contract --contract ${output}`);
  console.log(`  3. wl-skills-test run-api --contract ${output} --base-url <环境> [或 --profile sit]\n`);
}
