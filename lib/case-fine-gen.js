/**
 * case-fine-gen.js — 细粒度测试用例生成器（v0.11.0）
 *
 * 从契约字段约束生成"颗粒度到字段"的用例（对齐规范 02/03 的 P0-P3 与前置/步骤/预期格式），
 * 并与 run-api 的 DAG 步骤建立执行映射（dimension 标记 → 可自动执行的闭环用例）：
 *
 * 字段维度:
 *   必填 → 空值(P0) | maxLength → 超长(P1) | 数值 → min/min-1/max/max+1 边界(P1)
 *   枚举 → 非法枚举值(P0) | 字符串 → 特殊字符安全探测(P2) / 前后空格(P3)
 * 操作维度:
 *   重复提交(P0) | 不存在主键(P1) | 重复删除(P2) | 无权限(P0) | 分页边界(P2) | 组合查询(P3)
 *
 * 用法: run-gen --type cases --granularity field（与基线矩阵合并输出）
 */

import { createHash } from "node:crypto";
import { typeCategory } from "./shared/types.js";
import { escapeMdCell } from "./shared/utils.js";

function fieldList(summary) {
  if (Array.isArray(summary.fields)) return summary.fields;
  if (summary.fields?.createRequest) return summary.fields.createRequest;
  return [];
}

// 内容哈希稳定 ID：契约增删一个字段不再让后续所有 FG-### 编号漂移（缺陷追溯断裂）。
// ID 由 dimension+module+title 内容决定，同一契约重新生成 ID 不变。
function stableCaseHash(dimension, module, title) {
  return createHash("sha256").update(`${dimension}|${module}|${title}`).digest("hex").slice(0, 8).toUpperCase();
}

/**
 * @param {object} summary — consumeContract 的 summary
 * @returns {Array<{id,module,title,priority,preconditions,steps,expected,dimension,autoExec}>}
 */
export function generateFineGrainedCases(summary) {
  const entity = summary.entity || summary.pageName || "Entity";
  const module = summary.module || entity;
  if (summary.apiFactsStatus === "unresolved") {
    return (summary.operations || []).map((operation) => ({
      id: `FG-${stableCaseHash("ui-intent", module, operation.key)}`, module,
      title: `${entity} — ${operation.key} 页面交互`, priority: "P1",
      preconditions: "页面可访问；API 事实待补，按浏览器交互验证", steps: `1. 打开 ${summary.route || "页面"}\n2. 完成 ${operation.intent || operation.key} 交互`,
      expected: "页面状态与交互意图一致；不得据此断言接口落库或伪造请求路径",
      dimension: "ui-intent", autoExec: false,
    }));
  }
  const fields = fieldList(summary);
  const ops = Object.fromEntries((summary.operations || []).map((o) => [o.key, o]));
  const cases = [];
  const seen = new Set(); // (dimension|field|title) 去重——同名/同语义字段只出一条
  const N = (c) => {
    const id = `FG-${stableCaseHash(c.dimension, module, c.title)}`;
    const dedupeKey = `${c.dimension}|${c.field ?? ""}|${c.title}`;
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    return { id, module, ...c };
  };
  const push = (c) => {
    const entry = c ? N(c) : null;
    if (entry) cases.push(entry);
  };

  const label = (f) => f.comment || f.description || f.label || f.name;

  // ── 字段维度 ──
  for (const f of fields) {
    const L = label(f);
    // 类型分类口径统一取自 lib/shared/types.js（与 run-api 负例同一分类器）
    const t = typeCategory(f) === "unknown" ? "string" : typeCategory(f);
    const required = f.required || f.requiredOnCreate;

    if (required) {
      push({
        title: `${entity} 新增 — ${L} 置空`,
        field: f.name,
        priority: "P0",
        preconditions: "已登录且有新增权限；其余必填字段合法",
        steps: `1. 打开新增（或调用 ${ops.create?.externalPath || "save"}）\n2. ${L} 留空，其余必填字段填合法值\n3. 提交`,
        expected: `保存被拒绝，提示 ${L} 必填；数据库无新增记录`,
        dimension: "field-required",
        autoExec: true,
      });
    }

    const maxLen = f.constraints?.maxLength || f.constraints?.length || f.maxLength;
    if (t === "string" && maxLen) {
      push({
        title: `${entity} 新增 — ${L} 超长（${maxLen}+1 字符）`,
        field: f.name,
        priority: "P1",
        preconditions: "已登录且有新增权限",
        steps: `1. 打开新增\n2. ${L} 输入 ${Number(maxLen) + 1} 个字符\n3. 提交`,
        expected: "前端或后端拦截，提示长度超限；不产生截断脏数据",
        dimension: "field-length",
        autoExec: true,
      });
    }

    if (t === "number") {
      const min = f.constraints?.min ?? f.constraints?.minimum;
      const max = f.constraints?.max ?? f.constraints?.maximum;
      if (min !== undefined) {
        push({
          title: `${entity} 新增 — ${L} 下边界（${min}）与越界（${min - 1}）`,
          field: f.name,
          priority: "P1",
          preconditions: "已登录且有新增权限",
          steps: `1. ${L} 输入边界值 ${min} → 提交\n2. ${L} 输入越界值 ${min - 1} → 提交`,
          expected: `${min} 保存成功；${min - 1} 被拒绝并提示范围`,
          dimension: "field-numeric-boundary",
          autoExec: true,
        });
      }
      if (max !== undefined) {
        push({
          title: `${entity} 新增 — ${L} 上边界（${max}）与越界（${max + 1}）`,
          field: f.name,
          priority: "P1",
          preconditions: "已登录且有新增权限",
          steps: `1. ${L} 输入边界值 ${max} → 提交\n2. ${L} 输入越界值 ${max + 1} → 提交`,
          expected: `${max} 保存成功；${max + 1} 被拒绝并提示范围`,
          dimension: "field-numeric-boundary",
          autoExec: true,
        });
      }
      push({
        title: `${entity} 新增 — ${L} 非数值类型`,
        field: f.name,
        priority: "P0",
        preconditions: "已登录且有新增权限",
        steps: `1. ${L} 输入字符串 "AT_NOT_A_NUMBER"\n2. 提交`,
        expected: "保存被拒绝，提示类型错误；不做隐式转换",
        dimension: "field-type",
        autoExec: true,
      });
    }

    const enums = f.enumValues || f.enum;
    if (Array.isArray(enums) && enums.length > 0) {
      push({
        title: `${entity} 新增 — ${L} 非法枚举值`,
        field: f.name,
        priority: "P0",
        preconditions: `已知合法枚举: ${enums.slice(0, 5).map((e) => (typeof e === "object" ? e.value ?? e.code : e)).join(" / ")}（dict.json 提供后 run-api 自动注入合法值并执行本用例）`,
        steps: `1. ${L} 输入不在枚举内的值（如 "@INVALID_ENUM@"）\n2. 提交`,
        expected: "保存被拒绝，提示取值范围；不落库",
        dimension: "field-enum",
        autoExec: true,
      });
    }

    if (t === "string") {
      push({
        title: `${entity} 新增 — ${L} 特殊字符（XSS/SQL 注入探测）`,
        field: f.name,
        priority: "P2",
        preconditions: "已登录且有新增权限",
        steps: `1. ${L} 输入 \\<script>alert(1)\\</script&gt; 与 '\\" OR 1=1 --\n2. 提交后查询列表与详情回显`,
        expected: "系统不报错；回显正确转义，无脚本执行；列表查询不受注入影响",
        dimension: "field-security",
        autoExec: false,
      });
      push({
        title: `${entity} 新增 — ${L} 前后空格`,
        field: f.name,
        priority: "P3",
        preconditions: "已登录且有新增权限",
        steps: `1. ${L} 输入 "  AT_SPACED  "（前后空格）\n2. 保存后读取回显`,
        expected: "保存成功且回显与产品约定一致（trim 或原样），行为确定可复现",
        dimension: "field-format",
        autoExec: false,
      });
    }
  }

  // ── 操作维度 ──
  if (ops.create) {
    push({
      title: `${entity} — 重复提交（同业务键）`,
      priority: "P0",
      preconditions: "已构造唯一业务键的合法 payload",
      steps: `1. 调用 ${ops.create.externalPath} 提交\n2. 相同 payload 立即再提交一次`,
      expected: "第二次被拒绝（业务键重复）或幂等返回同一主键；不产生重复脏数据",
      dimension: "op-duplicate",
      autoExec: true,
    });
    push({
      title: `${entity} — 并发重复提交（同业务键 ×5 并发）`,
      priority: "P0",
      preconditions: "已构造唯一业务键的合法 payload",
      steps: `1. 以 5 个并发请求同时提交相同 payload`,
      expected: "至多一条新记录或全部幂等返回同一主键——并发窗口不得重复落库（唯一约束/幂等）",
      dimension: "op-duplicate-concurrent",
      autoExec: true,
    });
    for (const key of ["create", "update", "remove"]) {
      if (!ops[key]) continue;
      push({
        title: `${entity} — ${key} 无权限账号访问`,
        priority: "P0",
        preconditions: "准备无该操作权限的账号 token",
        steps: `1. 用无权限 token 调用 ${ops[key].externalPath}`,
        expected: "HTTP 401/403 或业务拒绝码；数据无变化",
        dimension: "op-permission",
        autoExec: true,
      });
    }
  }

  // ── 更新生效验证（有 update+detail 操作时 run-api 自动执行）──
  if (ops.update && ops.detail) {
    push({
      title: `${entity} — 更新后字段回读一致（差异化值）`,
      priority: "P1",
      preconditions: "已存在一条本次测试创建的记录",
      steps: `1. 调用 ${ops.update.externalPath} 提交差异化字段值\n2. 调用 ${ops.detail.externalPath} 读回`,
      expected: "读回值与更新提交值一致（更新真实落库，未被忽略）",
      dimension: "op-update",
      autoExec: true,
    });
  }

  for (const key of ["detail", "remove"]) {
    if (!ops[key]?.externalPath?.includes("{id}")) continue;
    push({
      title: `${entity} — ${key} 不存在的主键`,
      priority: "P1",
      preconditions: "构造确定性不存在的主键（如 NOT_EXIST_999999）",
      steps: `1. 调用 ${ops[key].externalPath.replace("{id}", "NOT_EXIST_999999")}`,
        expected: "返回未找到的业务码；HTTP 非 5xx；无异常堆栈泄露",
        dimension: "op-notfound",
        autoExec: true,
    });
  }

  if (ops.remove && ops.page) {
    push({
      title: `${entity} — 删除后重复删除`,
      priority: "P2",
      preconditions: "已删除一条本次测试创建的记录",
      steps: `1. 对已删除主键再次调用 ${ops.remove.externalPath}`,
        expected: "拒绝（不存在）或幂等成功；不误删其他数据",
        dimension: "op-idempotent",
        autoExec: true,
    });
  }

  if (ops.page) {
    const maxSize = summary.transport?.maxSize ?? 200;
    push({
      title: `${entity} — 分页边界（current=0 / size 超 max=${maxSize}）`,
      priority: "P2",
      preconditions: "已登录且有查询权限",
      steps: `1. queryPage 传 current=0\n2. queryPage 传 size=${maxSize + 1000}`,
      expected: "拒绝或钳制为合法分页；HTTP 非 5xx；total 字段类型稳定",
      dimension: "op-pagination",
      autoExec: true,
    });
    const qFields = summary.queryFields?.filter((q) => q.name) || fields.filter((f) => f.queryMode && f.queryMode !== "none").slice(0, 2);
    if (qFields.length >= 2) {
      push({
        title: `${entity} — 组合查询（${label(qFields[0])} + ${label(qFields[1])}）`,
        priority: "P3",
        preconditions: "列表已有多条可区分数据",
        steps: `1. 仅按 ${label(qFields[0])} 查询记结果集 A\n2. 加上 ${label(qFields[1])} 条件查询记结果集 B`,
        expected: "B ⊆ A 且 B 中记录同时满足两条件（收敛正确）",
        dimension: "op-query-combine",
        autoExec: true,
      });
    }
  }

  return cases;
}

/** 细粒度用例 Markdown（与基线矩阵同格式，含执行映射列） */
export function exportFineCasesMarkdown(cases, entity = "业务实体") {
  const auto = cases.filter((c) => c.autoExec).length;
  const lines = [
    `## 细粒度用例（字段级/操作级，共 ${cases.length} 条，其中 ${auto} 条可由 run-api 自动执行）`,
    ``,
    `> dimension 标记与 run-api DAG 步骤一一映射：field-required/field-type/field-length/field-enum（dict 提供后）/op-duplicate/op-duplicate-concurrent/op-update/op-permission/op-pagination → 自动执行；`,
    `> 执行后对照 run-api --json 结果的 summary.dimensionCoverage（各维度 executed/passed）核对声明与执行一致。`,
    `> 其余（数值边界/枚举/安全字符/组合查询等）为人工或待扩展自动化的闭环用例。`,
    ``,
    `| 编号 | 模块 | 用例标题 | 优先级 | 前置条件 | 操作步骤 | 预期结果 | 维度 | 自动执行 |`,
    `|------|------|---------|:------:|---------|---------|---------|------|:-------:|`,
  ];
  const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  for (const c of [...cases].sort((a, b) => pOrder[a.priority] - pOrder[b.priority])) {
    lines.push(
      `| ${escapeMdCell(c.id)} | ${escapeMdCell(c.module)} | ${escapeMdCell(c.title)} | ${escapeMdCell(c.priority)} | ${escapeMdCell(c.preconditions.replaceAll("\n", "<br>"))} | ${escapeMdCell(c.steps.replaceAll("\n", "<br>"))} | ${escapeMdCell(c.expected.replaceAll("\n", "<br>"))} | ${escapeMdCell(c.dimension)} | ${c.autoExec ? "✅" : "—"} |`,
    );
  }
  const byP = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const c of cases) byP[c.priority]++;
  lines.push(``, `**优先级分布**: P0=${byP.P0} / P1=${byP.P1} / P2=${byP.P2} / P3=${byP.P3}（对齐规范 02）`, ``);
  return lines.join("\n");
}
