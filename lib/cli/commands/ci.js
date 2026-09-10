/**
 * cli/commands/ci.js — CI 流水线模板生成（v0.16.0）
 *
 * 一条命令接入质量门：init 后运行 `wl-skills-test ci --type github|gitlab|jenkins`，
 * 生成现成的流水线定义（跑 gate + report + 产物上传 + 非零阻断），不再手工拼命令。
 */
import { existsSync } from "node:fs";
import { writeTextFile } from "../../shared/utils.js";

const TEMPLATES = {
  github: {
    output: ".github/workflows/wl-quality-gate.yml",
    content: `name: wl-quality-gate

on:
  push:
    branches: [main, master, develop]
  pull_request:
  workflow_dispatch:

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      # 测试代码静态审计（T1-T25）+ E2E 工程强校验（存在才检查）
      - name: Audit test code
        run: npx @agile-team/wl-skills-test audit --target ./tests

      # API 深度测试（需要契约与环境变量；按需启用）
      # - name: API deep test
      #   env:
      #     WL_TOKEN: \${{ secrets.WL_TOKEN }}
      #   run: npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url \${{ vars.WL_BASE_URL }} --token "\${WL_TOKEN}"

      # 聚合报告（自动发现 test-reports/ 下各维度结果）
      - name: Aggregate report
        run: npx @agile-team/wl-skills-test report --trend
        continue-on-error: true

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: wl-test-reports
          path: test-reports/
          if-no-files-found: ignore
`,
  },
  gitlab: {
    output: ".gitlab-ci.yml",
    content: `wl-quality-gate:
  stage: test
  image: node:20
  script:
    # 静态审计（非零退出即阻断流水线）
    - npx @agile-team/wl-skills-test audit --target ./tests
    # API 深度测试（按需启用；凭据走 GitLab CI/CD Variables）
    # - npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url "$WL_BASE_URL" --token "$WL_TOKEN"
    - npx @agile-team/wl-skills-test report --trend
  artifacts:
    when: always
    paths:
      - test-reports/
    expire_in: 30 days
`,
  },
  jenkins: {
    output: "Jenkinsfile",
    content: `pipeline {
  agent any
  stages {
    stage('wl-quality-gate') {
      steps {
        nodejs(nodeJSInstallationName: 'node20') {
          sh 'npx @agile-team/wl-skills-test audit --target ./tests'
          // API 深度测试按需启用（凭据走 Jenkins Credentials）
          // withCredentials([string(credentialsId: 'wl-token', variable: 'WL_TOKEN')]) {
          //   sh 'npx @agile-team/wl-skills-test run-api --contract ./wl-contract.json --base-url $WL_BASE_URL --token $WL_TOKEN'
          // }
          sh 'npx @agile-team/wl-skills-test report --trend || true'
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'test-reports/**', allowEmptyArchive: true
        }
      }
    }
  }
}
`,
  },
};

export function cmdCi(parsed) {
  const { opts } = parsed;
  const type = opts.type || "github";
  const template = TEMPLATES[type];
  if (!template) {
    console.error(`未知 CI 类型: ${type}（可选: ${Object.keys(TEMPLATES).join(" / ")}）`);
    process.exitCode = 2;
    return;
  }
  const output = opts.output || template.output;
  const dryRun = opts["dry-run"] === true;

  console.log(`\n[ci] 生成 ${type} 质量门流水线模板 → ${output}\n`);
  if (dryRun) {
    console.log(template.content);
    console.log("[预览模式] 未实际写入。去掉 --dry-run 执行生成。\n");
    return;
  }
  if (existsSync(output) && opts.force !== true) {
    console.log(`已存在 ${output}（--force 覆盖）\n`);
    return;
  }
  writeTextFile(output, template.content);
  console.log(`✅ 已写入: ${output}`);
  console.log(`下一步:`);
  console.log(`  1. 提交后流水线将执行: audit（阻断）→ [按需启用 run-api] → report（产物上传）`);
  console.log(`  2. 在 CI 凭据中配置 WL_TOKEN / WL_BASE_URL（或项目根 wl-test.config.json 的 auth 段）`);
  console.log(`  3. 本地对齐验证: npx @agile-team/wl-skills-test gate --audit-dir ./tests\n`);
}
