/**
 * api-executor 深度测试 — 本地 mock 后端（jh4j 风格信封），覆盖 v0.9.0 全部能力
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runApiTests, generateSmokeReport } from "../lib/api-executor.js";

const TMP = join(process.cwd(), ".tmp-api-exec");

// ── mock 后端工厂 ──────────────────────────────
function startMock(config = {}) {
  const {
    validateRequired = true,
    validateType = true,
    validateLength = true,
    rejectDuplicate = true,
    idempotent = false,
    enforcePerm = true,
    corruptReadback = false,
    strictPagination = false,
    extraField = true,
  } = config;

  const store = new Map();
  let idSeq = 0;
  const server = createServer((req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    const auth = (req.headers.authorization || "").toLowerCase();
    if (enforcePerm && auth.includes("noperm")) {
      return send(403, { code: 4003, message: "无权限", data: null });
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      const url = req.url;
      const method = req.method;

      if (method === "POST" && url === "/order/queryPage") {
        if (strictPagination && (json.current < 1 || json.size > 200)) {
          return send(200, { code: 4004, message: "分页参数非法", data: null });
        }
        const size = Math.min(json.size || 10, 200);
        const records = [...store.values()].slice(0, size).map((r) => ({ ...r, ...(extraField ? { drift_extra: "x" } : {}) }));
        return send(200, { code: 2000, message: "ok", data: { records, total: store.size } });
      }

      if (method === "POST" && url === "/order/save") {
        if (validateRequired && !json.orderNo) {
          return send(200, { code: 4004, message: "orderNo 必填", data: null });
        }
        if (validateType && typeof json.amount === "string") {
          return send(200, { code: 4004, message: "amount 类型错误", data: null });
        }
        if (validateLength && (String(json.orderNo || "").length > 32 || String(json.orderName || "").length > 20)) {
          return send(200, { code: 4004, message: "字段超长", data: null });
        }
        const existing = rejectDuplicate || idempotent ? [...store.values()].find((r) => r.orderNo === json.orderNo) : null;
        if (existing) {
          if (idempotent) return send(200, { code: 2000, message: "幂等", data: existing.id });
          return send(200, { code: 4004, message: "orderNo 重复", data: null });
        }
        const id = `ID${++idSeq}`;
        store.set(id, {
          id,
          orderNo: json.orderNo,
          orderName: corruptReadback ? `${json.orderName}_CORRUPT` : json.orderName,
          amount: json.amount,
        });
        return send(200, { code: 2000, message: "ok", data: id });
      }

      const detailMatch = url.match(/^\/order\/getById\/(.+)$/);
      if (method === "GET" && detailMatch) {
        const rec = store.get(decodeURIComponent(detailMatch[1]));
        if (!rec) return send(200, { code: 4004, message: "不存在", data: null });
        return send(200, { code: 2000, message: "ok", data: rec });
      }

      if (method === "PUT" && url === "/order/updateById") {
        if (!store.has(json.id)) return send(200, { code: 4004, message: "不存在", data: null });
        return send(200, { code: 2000, message: "ok", data: true });
      }

      const delMatch = url.match(/^\/order\/deleteById\/(.+)$/);
      if (method === "DELETE" && delMatch) {
        const id = decodeURIComponent(delMatch[1]);
        if (!store.has(id)) return send(200, { code: 4004, message: "不存在", data: null });
        store.delete(id);
        return send(200, { code: 2000, message: "ok", data: true });
      }

      send(404, { code: 404, message: "not found", data: null });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, store });
    });
  });
}

// 契约：kit 格式（createRequest 含必填 orderNo、数值 amount、限长 orderName）
const CONTRACT = {
  kind: "wl-api-contract",
  schemaVersion: 1,
  protocolVersion: "1.0",
  resource: { contractId: "api-exec-test", module: "order", entity: "Order", permissionPrefix: "order" },
  operations: {
    page: { method: "POST", externalPath: "/order/queryPage", permission: "order_query_page" },
    detail: { method: "GET", externalPath: "/order/getById/{id}", permission: "order_get_by_id" },
    create: { method: "POST", externalPath: "/order/save", permission: "order_save" },
    update: { method: "PUT", externalPath: "/order/updateById", permission: "order_update_by_id" },
    remove: { method: "DELETE", externalPath: "/order/deleteById/{id}", permission: "order_delete_by_id" },
  },
  models: {
    createRequest: [
      { name: "orderNo", description: "订单号", required: true, type: "string", constraints: { maxLength: 32 } },
      { name: "orderName", description: "订单名", required: true, type: "string", constraints: { maxLength: 20 } },
      { name: "amount", description: "金额", required: true, type: "number" },
    ],
    listResponse: [
      { name: "id", type: "string" },
      { name: "orderNo", type: "string" },
      { name: "orderName", type: "string" },
      { name: "amount", type: "number" },
    ],
  },
  transport: { successCode: 2000, pagination: { defaultSize: 10, maxSize: 200 } },
};

function writeContract(name = "contract.json") {
  mkdirSync(TMP, { recursive: true });
  const p = join(TMP, name);
  writeFileSync(p, JSON.stringify(CONTRACT));
  return p;
}

async function withMock(config, fn) {
  const mock = await startMock(config);
  try {
    return await fn(mock);
  } finally {
    mock.server.close();
  }
}

function step(result, kind) {
  return result.results.filter((r) => r.kind === kind);
}

test("api-executor: 全链路 DAG 通过（四层断言 + 零污染 + 负例 + 漂移）", async () => {
  const contract = writeContract();
  await withMock({}, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    assert.equal(result.error, undefined);

    const s = result.summary;
    // 正例链路
    assert.equal(step(result, "smoke")[0].status, "pass", "列表冒烟应通过");
    assert.equal(step(result, "create")[0].status, "pass", "新增应通过");
    const rb = step(result, "readback")[0];
    assert.equal(rb.status, "pass", "写后读回应通过");
    assert.ok(rb.assertions.some((a) => a.name.includes("字段回读一致")), "应含字段级比对断言");
    assert.equal(step(result, "update")[0].status, "pass");
    assert.equal(step(result, "detail")[0].status, "pass");
    // 负例全部通过（后端有校验）
    const negs = step(result, "negative");
    assert.equal(negs.length, 3, "应执行三类负例");
    assert.ok(negs.every((n) => n.status === "pass"), negs.map((n) => `${n.name}:${n.status}:${n.reason}`).join(" | "));
    // 重复提交被拒
    assert.equal(step(result, "duplicate")[0].status, "pass");
    // 分页边界
    assert.equal(step(result, "pagination")[0].status, "pass");
    // 清理 + 复查
    assert.equal(step(result, "remove")[0].status, "pass");
    assert.equal(step(result, "verify-gone")[0].status, "pass");
    assert.equal(mock.store.size, 0, "mock 存储应清空（零污染）");
    // 漂移：extra 含 drift_extra（排除审计字段后）
    assert.ok(s.drift.extra.some((d) => d.field === "drift_extra"), `extra: ${JSON.stringify(s.drift.extra)}`);
    assert.equal(s.drift.missing.length, 0, `missing 应为空: ${JSON.stringify(s.drift.missing)}`);
    // 汇总与结论
    assert.equal(s.failed, 0);
    assert.equal(s.errors, 0);
    assert.ok(s.decision.startsWith("通过"), s.decision);
    assert.ok(s.assertions.total >= 10, "断言总数应可观");
    assert.equal(s.cleanup.verified, true);
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 无权限 token 被拒（读探针）", async () => {
  const contract = writeContract();
  await withMock({ enforcePerm: true }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good", noPermToken: "noperm" });
    const perms = step(result, "permission");
    assert.ok(perms.length >= 1, "应执行权限步骤");
    assert.ok(perms.every((p) => p.status === "pass"), perms.map((p) => p.reason).join("|"));
    assert.equal(result.summary.permissions.failed, 0);
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 权限未拦截被检出为失败", async () => {
  const contract = writeContract();
  await withMock({ enforcePerm: false }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good", noPermToken: "noperm" });
    const perms = step(result, "permission");
    assert.ok(perms.every((p) => p.status === "fail"), "无权限 token 成功访问应判失败");
    assert.ok(perms[0].reason.includes("权限未拦截"));
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 后端无校验时负例失败（暴露校验缺口）", async () => {
  const contract = writeContract();
  await withMock({ validateRequired: false, validateType: false, validateLength: false, rejectDuplicate: false }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    const negs = step(result, "negative");
    assert.ok(negs.every((n) => n.status === "fail"), "校验缺口应使负例失败");
    assert.ok(negs.find((n) => n.name.includes("必填缺失")).reason.includes("校验缺口"));
    // 重复提交产生新主键 → fail 且登记清理
    assert.equal(step(result, "duplicate")[0].status, "fail");
    assert.ok(step(result, "duplicate")[0].reason.includes("污染"));
    // 意外成功的负例记录也应被清理
    assert.equal(step(result, "remove")[0].status, "pass");
    assert.equal(mock.store.size, 0, "负例意外成功的数据也应零污染");
    assert.ok(result.summary.decision.startsWith("不通过") || result.summary.decision.startsWith("部分通过"));
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: lenient-coercion 把类型负例宽恕记 warn", async () => {
  const contract = writeContract();
  await withMock({ validateType: false }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good", lenientCoercion: true });
    const typeNeg = step(result, "negative").find((n) => n.name.includes("类型错误"));
    assert.equal(typeNeg.status, "warn");
    assert.ok(result.summary.warned >= 1);
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 幂等重复提交通过（同主键）", async () => {
  const contract = writeContract();
  await withMock({ rejectDuplicate: false, idempotent: true }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    const dup = step(result, "duplicate")[0];
    assert.equal(dup.status, "pass");
    assert.ok(dup.assertions.some((a) => a.name.includes("幂等")));
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 写后读回不一致被检出（数据正确性）", async () => {
  const contract = writeContract();
  await withMock({ corruptReadback: true }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    const rb = step(result, "readback")[0];
    assert.equal(rb.status, "fail");
    assert.ok(rb.assertions.some((a) => !a.pass && a.name.includes("orderName")), "应定位到 orderName 回读不一致");
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 契约声明但响应缺失 → drift.missing", async () => {
  const contract = writeContract();
  await withMock({}, async (mock) => {
    // 修改契约 listResponse 声明一个后端不返回的字段
    const c2 = { ...CONTRACT, models: { ...CONTRACT.models, listResponse: [...CONTRACT.models.listResponse, { name: "ghost_field", type: "string" }] } };
    const p = join(TMP, "contract2.json");
    writeFileSync(p, JSON.stringify(c2));
    const result = await runApiTests({ baseUrl: mock.url, contractPath: p, token: "good" });
    assert.ok(result.summary.drift.missing.some((d) => d.field === "ghost_field"));
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: create 失败时后续依赖级联 skip 并标注原因", async () => {
  // 后端一切写操作都拒绝（模拟服务异常）
  const contract = writeContract();
  await withMock({ validateRequired: false, rejectDuplicate: false }, async (mock) => {
    // 直接让 save 500：换一个极简破坏配置——用不存在的路径
    const c2 = JSON.parse(JSON.stringify(CONTRACT));
    c2.operations.create.externalPath = "/order/no-such-save";
    const p = join(TMP, "contract3.json");
    writeFileSync(p, JSON.stringify(c2));
    const result = await runApiTests({ baseUrl: mock.url, contractPath: p, token: "good" });
    assert.equal(step(result, "create")[0].status, "fail");
    const rb = step(result, "readback")[0];
    assert.equal(rb.status, "skip");
    assert.ok(rb.reason.includes("前置失败"));
    assert.equal(step(result, "remove")[0].status, "skip");
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 分页边界 strict 拒绝 / 宽松都无 5xx", async () => {
  const contract = writeContract();
  await withMock({ strictPagination: true }, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    assert.equal(step(result, "pagination")[0].status, "pass");
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 报文快照留证 + 报告含新章节", async () => {
  const contract = writeContract();
  await withMock({}, async (mock) => {
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good", noPermToken: "noperm" });
    for (const r of result.results) {
      if (r.status !== "skip" && ["smoke", "create"].includes(r.kind)) {
        assert.ok(r.snapshot, `${r.id} 应有报文快照`);
      }
    }
    const md = generateSmokeReport(result);
    assert.ok(md.includes("负例执行"));
    assert.ok(md.includes("权限验证"));
    assert.ok(md.includes("契约漂移检测"));
    assert.ok(md.includes("零污染清理"));
    assert.ok(md.includes("步骤详情"));
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: dict-file 注入枚举合法值", async () => {
  const contract = writeContract();
  await withMock({}, async (mock) => {
    const dictPath = join(TMP, "dict.json");
    writeFileSync(dictPath, JSON.stringify({ orderNo: ["DICT_ORDER_001"] }));
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good", dictFile: dictPath });
    assert.equal(step(result, "create")[0].status, "pass");
    assert.equal(step(result, "readback")[0].status, "pass");
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 空库自举——首个 create 即种子，detail/remove 正常", async () => {
  const contract = writeContract();
  await withMock({}, async (mock) => {
    assert.equal(mock.store.size, 0, "前置：空库");
    const result = await runApiTests({ baseUrl: mock.url, contractPath: contract, token: "good" });
    assert.equal(step(result, "detail")[0].status, "pass", "空库下 detail 应可用（用 create 产生的主键）");
    assert.equal(mock.store.size, 0, "结束后仍零残留");
  });
  rmSync(TMP, { recursive: true, force: true });
});

test("api-executor: 网络不可达时负例/权限不产生假通过（记 error 而非误判拒绝）", async () => {
  const contract = writeContract();
  // 指向一个不存在的端口（连不上，而非拒绝）
  const result = await runApiTests({
    baseUrl: "http://127.0.0.1:1",
    contractPath: contract,
    token: "good",
    noPermToken: "noperm",
    timeout: 1500,
  });
  // 正例步骤应为 error（连不上）
  assert.equal(step(result, "smoke")[0].status, "error");
  assert.equal(step(result, "create")[0].status, "error");
  // 关键：负例/权限/重复提交绝不能因为"连不上"被判为"被拒绝"而 pass
  for (const r of [...step(result, "negative"), ...step(result, "permission"), ...step(result, "duplicate")]) {
    assert.notEqual(r.status, "pass", `${r.id} ${r.name} 网络错误不得判通过（实际 ${r.status}）`);
    assert.ok(r.status === "error" || r.status === "skip", `${r.id} 应为 error 或级联 skip`);
  }
  rmSync(TMP, { recursive: true, force: true });
});
