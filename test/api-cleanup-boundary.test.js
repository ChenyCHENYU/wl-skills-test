import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApiTests } from "../lib/api-executor.js";

const page = { method: "POST", externalPath: "/orders/queryPage" };
const create = { method: "POST", externalPath: "/orders/save" };
const remove = { method: "DELETE", externalPath: "/orders/deleteById/{id}" };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

function contract(t, operations) {
  const root = mkdtempSync(join(tmpdir(), "wl-api-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contractPath = join(root, "contract.json");
  writeFileSync(contractPath, JSON.stringify({ kind: "wl-api-contract", schemaVersion: 1,
    resource: { module: "orders", entity: "Order" }, operations,
    models: { createRequest: [{ name: "orderNo", type: "string", required: true }] }, transport: { successCode: 2000 },
  }));
  return { contractPath, baseUrl: "http://fixture.invalid" };
}

function backend({ afterDelete, afterCreate } = {}) {
  let id = 0;
  const removed = [], calls = [], rows = new Map();
  const fetchImpl = async (input, options) => {
    const { pathname } = new URL(input);
    calls.push(pathname);
    if (pathname === "/orders/save") {
      const body = JSON.parse(options.body);
      if (!body.orderNo || [...rows.values()].some(row => row.orderNo === body.orderNo)) return response({ code: 4000 });
      const key = `fixture-${++id}`;
      rows.set(key, { ...body, id: key });
      afterCreate?.();
      return response({ code: 2000, data: { id: key } });
    }
    if (pathname.startsWith("/orders/deleteById/")) {
      const key = pathname.split("/").at(-1);
      if (rows.delete(key)) removed.push(key);
      return response({ code: 2000 });
    }
    if (removed.length && afterDelete) return afterDelete();
    return response({ code: 2000, data: { records: [...rows.values()], total: rows.size } });
  };
  return { fetchImpl, calls, removed };
}

test("unscoped DELETE and API-test write contracts missing cleanup stop before any request", async t => {
  const fixture = backend();
  const broad = await runApiTests({ ...contract(t, { page, remove: { ...remove, externalPath: "/orders" } }), fetchImpl: fixture.fetchImpl });
  const missing = await runApiTests({ ...contract(t, { page, create }), fetchImpl: fixture.fetchImpl, requireScopedCleanup: true });
  assert.equal(broad.errorCode, "UNSCOPED_REMOVE");
  assert.equal(missing.errorCode, "MCP_CLEANUP_REQUIRED");
  assert.deepEqual(fixture.calls, []);
});

test("repeat DELETE requires an ID created and deleted by the current test", async t => {
  const fixture = backend();
  const result = await runApiTests({ ...contract(t, { page, remove }), fetchImpl: fixture.fetchImpl });
  assert.equal(result.results.find(step => step.kind === "idempotent").status, "skip");
  assert.ok(fixture.calls.filter(path => path.includes("deleteById/")).every(path => path.includes("/NOT_EXIST_")));
});

test("failed, malformed and incomplete list responses cannot verify cleanup", async t => {
  const input = contract(t, { page, create, remove });
  for (const afterDelete of [
    () => response({ code: 500 }, 500),
    () => response({ code: 2000, data: { records: {} } }),
    () => response({ code: 2000, data: { records: [], total: 101 } }),
  ]) {
    const fixture = backend({ afterDelete });
    const result = await runApiTests({ ...input, fetchImpl: fixture.fetchImpl });
    assert.equal(result.results.find(step => step.kind === "verify-gone").status, "fail");
    assert.deepEqual(result.summary.cleanup, { created: 1, cleaned: 1, verified: false, pending: true });
    assert.equal(result.summary.pass, false);
  }
});

test("the time budget stops further probes but still cleans and verifies an already recorded ID", async t => {
  let now = 10_000;
  t.mock.method(Date, "now", () => now);
  const fixture = backend({ afterCreate: () => { now += 31_000; } });
  const result = await runApiTests({ ...contract(t, { page, create, remove }), fetchImpl: fixture.fetchImpl, maxDurationMs: 30_000 });
  assert.deepEqual(fixture.removed, ["fixture-1"]);
  assert.equal(result.results.find(step => step.kind === "idempotent").status, "skip");
  assert.equal(result.results.find(step => step.kind === "verify-gone").status, "pass");
  assert.deepEqual(result.summary.cleanup, { created: 1, cleaned: 1, verified: true, pending: false });
  assert.equal(result.summary.pass, false, "expired test coverage stays incomplete even after cleanup");
});

test("a write without a usable ID remains pending and cannot trigger guessed deletion", async t => {
  const fixture = backend();
  const result = await runApiTests({ ...contract(t, { page, create, remove }), fetchImpl: async (url, opts) => {
    if (new URL(url).pathname === "/orders/save") return response({ code: 2000, data: { id: {} } });
    return fixture.fetchImpl(url, opts);
  } });
  assert.equal(result.summary.pass, false);
  assert.deepEqual(result.summary.cleanup, { created: 0, cleaned: 0, verified: false, pending: true, unresolvedWrites: 1 });
  assert.ok(fixture.calls.filter(path => path.includes("deleteById/")).every(path => path.includes("/NOT_EXIST_")));
});

test("a timed-out concurrent write preserves known sibling IDs for cleanup", async t => {
  let validWrites = 0;
  const fixture = backend();
  const result = await runApiTests({ ...contract(t, { page, create, remove }), fetchImpl: async (url, opts) => {
    if (new URL(url).pathname !== "/orders/save" || !JSON.parse(opts.body).orderNo) return fixture.fetchImpl(url, opts);
    validWrites++;
    if (validWrites === 1) return fixture.fetchImpl(url, opts);
    if (validWrites === 3) throw new Error("synthetic connection lost after send");
    if (validWrites === 4) {
      const body = { ...JSON.parse(opts.body), orderNo: "fixture-concurrent-sibling" };
      return fixture.fetchImpl(url, { ...opts, body: JSON.stringify(body) });
    }
    return response({ code: 4000 });
  } });
  assert.deepEqual(fixture.removed, ["fixture-1", "fixture-2"]);
  assert.equal(result.results.find(step => step.kind === "duplicate-concurrent").status, "error");
  assert.deepEqual(result.summary.cleanup, { created: 2, cleaned: 2, verified: false, pending: true, unresolvedWrites: 1 });
});
