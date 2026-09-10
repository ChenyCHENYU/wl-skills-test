/**
 * cli/installer.js — init / update / clean（安装器）
 *
 * update（增量）判定"用户是否修改过已安装文件"：
 * existing 与「原始内容 / 原始内容按任意历史版本替换占位符后」均不一致才算用户修改。
 * 否则含 __WL_SKILLS_TEST_VERSION__ 占位符的文件（安装时已替换为当期版本）
 * 会被永久误判"用户已修改"而永不更新。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync as fsWriteFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { PKG, PKG_ROOT } from "./context.js";

export function cmdInit(parsed) {
  const dryRun = parsed.opts["dry-run"] === true;
  const force = parsed.opts.force === true;
  const incremental = parsed.opts.incremental === true;
  const cwd = process.cwd();

  console.log(`\n${dryRun ? "[预览] " : ""}安装 ${PKG.name} v${PKG.version}...\n`);

  const filesDir = join(PKG_ROOT, "files");
  if (!existsSync(filesDir)) {
    console.error("错误：包文件目录不存在，请检查安装是否完整。");
    process.exit(1);
  }

  const plannedFiles = [];
  scanDir(filesDir, "", plannedFiles);

  console.log(`计划写入 ${plannedFiles.length} 个文件：\n`);

  const categories = {};
  for (const f of plannedFiles) {
    const cat = f.target.split("/")[0] || "root";
    categories[cat] = (categories[cat] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(categories)) {
    console.log(`  ${cat.padEnd(30)} ${count} 个文件`);
  }

  if (dryRun) {
    console.log("\n[预览模式] 未实际写入。去掉 --dry-run 执行安装。\n");
    return;
  }

  let written = 0;
  let skipped = 0;
  let preserved = 0;

  for (const f of plannedFiles) {
    const targetPath = join(cwd, f.target);
    // init 时替换版本占位符为当前包版本
    let content = f.content;
    if (content.includes("__WL_SKILLS_TEST_VERSION__")) {
      content = content.replaceAll("__WL_SKILLS_TEST_VERSION__", PKG.version);
    }
    if (existsSync(targetPath)) {
      const existing = readFileSync(targetPath, "utf-8");
      if (existing === content) {
        skipped++;
        continue;
      }
      // 增量更新（update 命令）：本地已被用户修改的文件不强制覆盖，保留并提示
      if (incremental && !force) {
        const original = readPlannedOriginal(filesDir, f.target);
        if (original !== null && isUserModified(original, existing, content)) {
          preserved++;
          console.log(`  ⚠️ 已保留本地修改: ${f.target}（如需覆盖请使用 --force）`);
          continue;
        }
      }
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    fsWriteFileSync(targetPath, content, "utf-8");
    written++;
  }

  if (incremental) {
    console.log(`\n完成：${written} 个文件更新，${skipped} 个无变化，${preserved} 个本地修改已保留。`);
  } else {
    console.log(`\n完成：${written} 个文件写入，${skipped} 个跳过（未变化）。`);
  }
  console.log(`\n下一步：`);
  console.log(`  1. 在 AI 编辑器中打开项目，AI 将自动识别测试规范和技能`);
  console.log(`  2. 说"生成测试方案"或"分析业务场景"触发 Skill`);
  console.log(`  3. 运行 npx @agile-team/wl-skills-test doctor 检查环境\n`);
}

export function cmdClean(parsed) {
  const dryRun = parsed.opts["dry-run"] === true;
  const cwd = process.cwd();

  const targets = [
    join(cwd, ".github", "standards"),
    join(cwd, ".github", "skills"),
    join(cwd, ".github", "_route-evals.json"),
    join(cwd, "copilot-instructions.md"),
    join(cwd, "AGENTS.md"),
    join(cwd, "CLAUDE.md"),
    join(cwd, ".cursor"),
    join(cwd, ".windsurf"),
    join(cwd, ".kiro"),
    join(cwd, ".trae"),
    join(cwd, ".clinerules"),
    join(cwd, ".qoder"),
    join(cwd, ".mcp.json"),
  ];

  console.log(`\n${dryRun ? "[预览] " : ""}清理 ${PKG.name} 安装文件...\n`);
  console.log("保留：测试脚本、报告、测试数据");
  console.log("清理：\n");

  let removed = 0;
  for (const target of targets) {
    if (existsSync(target)) {
      const name = target.replace(cwd, ".");
      console.log(`  ${dryRun ? "将删除" : "已删除"}: ${name}`);
      if (!dryRun) {
        rmSync(target, { recursive: true, force: true });
      }
      removed++;
    }
  }

  console.log(`\n${removed} 个目标${dryRun ? "待清理" : "已清理"}。\n`);
}

// ── 内部工具 ────────────────────────────────────
function scanDir(base, rel, results) {
  for (const entry of readdirSync(base)) {
    const full = join(base, entry);
    const target = rel ? `${rel}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      scanDir(full, target, results);
    } else {
      results.push({
        target,
        content: readFileSync(full, "utf-8"),
      });
    }
  }
}

// 读取包内原始文件内容（用于 update 判断用户是否本地修改过）
function readPlannedOriginal(filesDir, target) {
  try {
    return readFileSync(join(filesDir, target), "utf-8");
  } catch {
    return null;
  }
}

function isUserModified(original, existing, currentSubstituted) {
  if (existing === original || existing === currentSubstituted) return false;
  if (!original || !original.includes("__WL_SKILLS_TEST_VERSION__")) return true;
  const versions = collectKnownVersions();
  return !versions.some((v) => existing === original.replaceAll("__WL_SKILLS_TEST_VERSION__", v));
}

function collectKnownVersions() {
  const versions = new Set([PKG.version]);
  try {
    const changelog = readFileSync(join(PKG_ROOT, "CHANGELOG.md"), "utf-8");
    for (const m of changelog.matchAll(/v?(\d+\.\d+\.\d+)/g)) versions.add(m[1]);
  } catch {
    // CHANGELOG 不可读时仅用当前版本
  }
  return versions;
}
