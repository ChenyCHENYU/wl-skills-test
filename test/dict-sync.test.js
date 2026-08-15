/**
 * dict-sync 测试 — 三种响应形态 / 字段映射 / 失败场景（mock 字典接口）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { syncDict } from "../lib/dict-sync.js";

const TMP = join(process.cwd(), ".tmp-dict");

function withDictApi(payload, fn) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 2000, message: "ok", data: payload }));
    });
    server.listen(0, "127.0.0.1", async () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      try {
        const r = await fn(url);
        resolve(r);
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test("dict-sync: map-of-arrays 形态", async () => {
  const r = await withDictApi({ pl_yes_no: ["是", "否"], pl_plant_code: ["烟台厂区"] }, (url) =>
    syncDict({ baseUrl: url, output: join(TMP, "d1.json") }),
  );
  assert.equal(r.error, undefined);
  assert.equal(r.dictCodes, 2);
  assert.equal(r.totalValues, 3);
  const saved = JSON.parse(readFileSync(join(TMP, "d1.json"), "utf-8"));
  assert.deepEqual(saved.pl_yes_no, ["是", "否"]);
  rmSync(TMP, { recursive: true, force: true });
});

test("dict-sync: 列表式形态（jh4j items）", async () => {
  const payload = [
    { code: "pl_plant_code", items: [{ value: "YTS0", label: "烟台" }, { value: "YT01", label: "烟台二" }] },
    { dictCode: "pl_yes_no", rows: [{ itemValue: "0" }, { itemValue: "1" }] },
  ];
  const r = await withDictApi(payload, (url) => syncDict({ baseUrl: url, output: join(TMP, "d2.json") }));
  assert.equal(r.dictCodes, 2);
  const saved = JSON.parse(readFileSync(join(TMP, "d2.json"), "utf-8"));
  assert.deepEqual(saved.pl_plant_code, ["YTS0", "YT01"]);
  assert.deepEqual(saved.pl_yes_no, ["0", "1"]);
  rmSync(TMP, { recursive: true, force: true });
});

test("dict-sync: map-of-item-objects 形态 + 字段映射", async () => {
  const payload = { pl_plant_code: { items: [{ value: "YTS0" }] }, pl_flag: [{ value: "1" }] };
  const r = await withDictApi(payload, (url) =>
    syncDict({ baseUrl: url, output: join(TMP, "d3.json"), maps: ["plant_code=pl_plant_code", "flag=pl_flag"] }),
  );
  const saved = JSON.parse(readFileSync(join(TMP, "d3.json"), "utf-8"));
  assert.deepEqual(saved.pl_plant_code, ["YTS0"]);
  assert.deepEqual(saved.pl_flag, ["1"]);
  assert.deepEqual(saved.__fieldMap__, { plant_code: "pl_plant_code", flag: "pl_flag" });
  rmSync(TMP, { recursive: true, force: true });
});

test("dict-sync: 业务码失败返回错误", async () => {
  const r = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 4004, message: "无权限" }));
    });
    server.listen(0, "127.0.0.1", async () => {
      const r2 = await syncDict({ baseUrl: `http://127.0.0.1:${server.address().port}` });
      server.close();
      resolve(r2);
    });
  });
  assert.ok(r.error.includes("4004"));
});

test("dict-sync: 不可达返回超时/连接错误", async () => {
  const r = await syncDict({ baseUrl: "http://127.0.0.1:1", timeout: 1000 });
  assert.ok(r.error);
});

test("dict-sync: 空字典返回错误（形态未识别）", async () => {
  const r = await withDictApi({ unrelated: 42 }, (url) => syncDict({ baseUrl: url }));
  assert.ok(r.error.includes("未识别"));
});
