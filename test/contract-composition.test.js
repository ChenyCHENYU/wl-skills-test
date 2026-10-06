import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consumeContract } from '../lib/contract-consumer.js';
import { validateContractFile } from '../lib/contract-validate.js';
import { isDateField } from '../lib/shared/types.js';
function tmp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-contract-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function write(root, rel, data) { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data)); return target; }
const api = {
  kind: 'wl-api-contract', schemaVersion: 1, protocolVersion: '1.0',
  source: { profile: 'jh4j3-openapi3' }, resource: { contractId: 'order-api', entity: 'Order', module: 'order' },
  operations: { page: { method: 'POST', externalPath: '/gateway/orders/search', requestModel: 'OrderQuery', responseModel: 'OrderRows' }, create: { method: 'POST', externalPath: '/gateway/orders/create', requestModel: 'OrderCreate', responseModel: 'NewOrderId' } },
  models: { OrderQuery: [{ name: 'pageSize', type: 'integer' }], OrderRows: [{ name: 'amount', type: 'number', format: 'decimal', constraints: { fractionDigits: 2 }, nullable: true }],
    OrderCreate: [{ name: 'orderDate', type: 'string', format: 'date', required: true, default: '2026-01-01', constraints: { pattern: '^\\d{4}' }, 'x-id-format': 'date-key' }], NewOrderId: [{ name: 'id', type: 'string' }] },
  transport: { successCode: 0, pagination: { defaultSize: 20, maxSize: 500 } },
};
const bd = { schemaVersion: 1, profile: 'jh4j3-openapi3', rootPackage: 'com.example', module: 'order', entity: { name: 'Order' }, database: 'mysql', api: { requestPath: 'orders', externalBasePath: '/gateway/orders' }, fields: [{ name: 'amount', javaType: 'BigDecimal', format: 'decimal', writable: true }] };
function fullProfile(profileId = 'jh4j3-openapi3') {
  return { protocolVersion: '1.0', profileId, transport: {
    operations: { page: { method: 'POST', path: 'search' }, detail: { method: 'GET', path: 'detail/{id}' }, create: { method: 'POST', path: 'create' }, update: { method: 'POST', path: 'updateRecord' }, remove: { method: 'DELETE', path: 'remove/{id}' } },
    responseEnvelope: { successCode: 0, codeField: 'code', messageField: 'message', dataField: 'data' },
    pagination: { requestCurrent: 'page', requestSize: 'pageSize', defaultCurrent: 1, defaultSize: 30, maxSize: 400, responseRecords: 'data.records', responseTotal: 'data.total' },
  } };
}


test('page references api.md relative to the page location and keeps real operations / model metadata', (t) => {
  const root = tmp(t); write(root, 'pages/order/api.md', '# API\n\n```wl-api-contract\n' + JSON.stringify(api) + '\n```\n');
  const spec = write(root, 'pages/order/page-spec.json', { page: '订单', mode: 'LIST', dir: '/ui/wrong-api-path', apiContract: './api.md', toolbar: [{ label: '新增' }] });
  const result = consumeContract(spec);
  assert.equal(result.type, 'page-spec'); assert.equal(result.summary.operationSource, 'api-contract');
  assert.equal(result.summary.operations[0].externalPath, '/gateway/orders/search');
  assert.equal(result.summary.operations[1].requestModel, 'OrderCreate');
  assert.equal(result.summary.fields.createRequest[0].format, 'date');
  assert.equal(result.summary.fields.createRequest[0].default, '2026-01-01');
  assert.equal(result.summary.operationModels.create.requestFields[0]['x-id-format'], 'date-key');
  assert.equal(result.summary.transport.successCode, 0);
  assert.equal(result.summary.transport.paginationConfig.maxSize, 500);
  assert.equal(validateContractFile(spec).valid, true);
  assert.equal(isDateField(result.summary.fields.createRequest[0]), true);
});

test('multiple Markdown blocks require a contractId selection, and explicit broken links never infer fake APIs', (t) => {
  const root = tmp(t); const other = { ...api, resource: { ...api.resource, contractId: 'other' } };
  write(root, 'api.md', '```wl-api-contract\n' + JSON.stringify(api) + '\n```\n```wl-api-contract\n' + JSON.stringify(other) + '\n```');
  const selected = write(root, 'page-spec.json', { page: '订单', mode: 'LIST', dir: '/ui', apiContract: './api.md#order-api' });
  assert.equal(consumeContract(selected).summary.contractId, 'order-api');
  const ambiguous = write(root, 'ambiguous.json', { page: '订单', mode: 'LIST', dir: '/ui', apiContract: './api.md' });
  assert.throws(() => consumeContract(ambiguous), /明确选择/);
  const missing = write(root, 'missing.json', { page: '订单', mode: 'LIST', dir: '/ui', apiContract: './missing-api.json' });
  assert.throws(() => consumeContract(missing), /不存在/); assert.equal(validateContractFile(missing).valid, false);
});

test('unknown schema and protocol fail both consuming and execution validation', (t) => {
  const root = tmp(t);
  for (const change of [{ schemaVersion: 2 }, { protocolVersion: '2.0' }]) {
    const file = write(root, 'unsupported.json', { ...api, ...change });
    assert.throws(() => consumeContract(file), /不支持/); assert.equal(validateContractFile(file).valid, false);
  }
  const legacy = { ...api }; delete legacy.protocolVersion;
  assert.equal(consumeContract(write(root, 'legacy.json', legacy)).type, 'wl-api-contract');
});

test('bd standalone keeps its default; nested contracts load project delivery profile methods and paths', (t) => {
  const root = tmp(t); const file = write(root, 'docs/modules/order/wl-contract.json', bd);
  assert.equal(consumeContract(file).summary.operations.find((op) => op.key === 'update').method, 'PUT');
  write(root, '.wl-skills-bd/contracts/wl-delivery-profile.v1.json', fullProfile());
  const summary = consumeContract(file).summary;
  assert.equal(summary.operations.find((op) => op.key === 'update').method, 'POST');
  assert.equal(summary.operations.find((op) => op.key === 'update').externalPath, '/gateway/orders/updateRecord');
  assert.equal(summary.transport.successCode, 0); assert.equal(summary.transport.maxSize, 400);
  assert.equal(summary.fields[0].format, 'decimal'); assert.equal(validateContractFile(file).valid, true);
});

test('bd custom profiles are explicit and incompatible profile versions are rejected', (t) => {
  const root = tmp(t); const file = write(root, 'wl-contract.json', { ...bd, profile: 'custom' });
  assert.throws(() => consumeContract(file), /delivery profile/);
  const custom = fullProfile('custom'); custom.transport.operations.page = { method: 'GET', path: 'list' };
  assert.equal(consumeContract(file, { deliveryProfile: custom }).summary.operations[0].method, 'GET');
  assert.throws(() => consumeContract(file, { deliveryProfile: { ...custom, protocolVersion: '9.0' } }), /不兼容/);
});

test('unlinked page remains independently usable and cyclic links fail clearly', (t) => {
  const root = tmp(t); const plain = write(root, 'plain.json', { page: '订单', mode: 'LIST', dir: '/orders' });
  assert.equal(consumeContract(plain).summary.operationSource, 'page-intent');
  const a = write(root, 'a.json', { page: 'A', mode: 'LIST', dir: '/a', apiContract: './b.json' });
  write(root, 'b.json', { page: 'B', mode: 'LIST', dir: '/b', apiContract: './a.json' });
  assert.throws(() => consumeContract(a), /循环/);
});

test('completion and raw model metadata stay intact; extension names reference existing operations once', (t) => {
  const root = tmp(t); const completion = { contractStatus: 'confirmed', deviations: [{ field: 'id', reason: 'project policy' }], skeletonOperations: ['remove'], openQuestions: [], extraEvidence: 'approval' };
  const approve = { method: 'POST', externalPath: '/gateway/orders/approve', permission: 'order:approve', requestModel: 'OrderCreate' };
  const input = { ...api, operations: { ...api.operations, approve }, completion, extensionOperations: ['approve', { name: 'approve', method: 'POST', externalPath: '/duplicate-must-not-win' }] };
  const summary = consumeContract(write(root, 'sale-order.json', input)).summary;
  assert.equal(summary.completion.contractStatus, 'confirmed'); assert.equal(summary.completion.status, 'confirmed');
  assert.deepEqual(summary.completion.deviations, completion.deviations); assert.deepEqual(summary.completion.skeletonOperations, ['remove']);
  assert.equal(summary.completion.extraEvidence, 'approval'); assert.deepEqual(summary.models, input.models);
  assert.equal(summary.operations.filter((op) => op.key === 'approve').length, 1);
  assert.equal(summary.operations.find((op) => op.key === 'approve').externalPath, approve.externalPath);
  assert.ok(!summary.operations.some((op) => op.key === 'extension'));
  assert.deepEqual(summary.operationModels.approve.requestFields, api.models.OrderCreate);
});

test('legacy extension objects require explicit method and path; absent extension references fail clearly', (t) => {
  const root = tmp(t);
  const legacy = consumeContract(write(root, 'legacy-extension.json', { ...api, extensionOperations: [{ name: 'export', method: 'GET', path: '/orders/export' }] })).summary;
  assert.equal(legacy.operations.find((op) => op.key === 'export').externalPath, '/orders/export');
  for (const extensionOperations of [['missing'], [{ name: 'cancel' }], [{ name: 'cancel', method: 'POST' }]]) {
    assert.throws(() => consumeContract(write(root, 'bad-extension.json', { ...api, extensionOperations })), /extensionOperations/);
  }
});

test('explicit delivery profiles require all five operations and complete transport metadata', (t) => {
  const root = tmp(t); const file = write(root, 'order.json', bd);
  const mutations = [
    (profile) => { delete profile.transport.operations.page; },
    (profile) => { profile.transport.operations.update.method = 'GUESS'; },
    (profile) => { profile.transport.operations.remove.path = '../remove'; },
    (profile) => { delete profile.transport.responseEnvelope.successCode; },
    (profile) => { delete profile.transport.responseEnvelope.dataField; },
    (profile) => { delete profile.transport.pagination.requestSize; },
    (profile) => { profile.transport.pagination.maxSize = 1; },
    (profile) => { delete profile.transport.pagination.responseRecords; },
  ];
  for (const mutate of mutations) {
    const profile = fullProfile(); mutate(profile);
    assert.throws(() => consumeContract(file, { deliveryProfile: profile }), /delivery profile/);
  }
});

test('standalone page keeps UI intentions and browser flows without inventing transport facts', async (t) => {
  const root = tmp(t);
  const spec = write(root, 'page-spec.json', { page: '订单', mode: 'LIST', dir: 'src/views/orders/list',
    query: [{ name: 'orderNo', label: '订单号', type: 'input' }], columns: [{ name: 'orderNo', label: '订单号' }],
    toolbar: [{ label: '新增', action: 'openModal', color: 'primary' }],
    operations: [{ label: '编辑', action: 'edit' }, { label: '删除', action: 'delete' }],
    formSections: [{ name: 'main', fields: [{ name: 'orderNo', required: true }] }],
  });
  const { summary } = consumeContract(spec);
  assert.equal(summary.operationSource, 'page-intent'); assert.equal(summary.apiFactsStatus, 'unresolved');
  assert.equal(summary.route, '/orders/list');
  assert.deepEqual(summary.operations.map((operation) => operation.key), ['page', 'create', 'update', 'remove']);
  assert.ok(summary.operations.every((operation) => !operation.method && !operation.externalPath));
  const { generateTestCaseMatrix } = await import('../lib/contract-consumer.js');
  const cases = generateTestCaseMatrix(summary); assert.equal(cases.length, 9);
  assert.equal(cases.filter((item) => item.type === 'ui').length, 4); assert.ok(cases.every((item) => !item.method));
  const { generateFineGrainedCases } = await import('../lib/case-fine-gen.js');
  assert.equal(generateFineGrainedCases(summary).length, 4); assert.ok(generateFineGrainedCases(summary).every((item) => !item.autoExec));
  const { generatePlaywrightScript } = await import('../lib/playwright-generator.js');
  const browser = generatePlaywrightScript(spec);
  assert.ok(browser.includes('const PAGE_PATH = "/orders/list"')); assert.ok(browser.includes('新增数据完整闭环'));
  assert.ok(browser.includes('查询条件可输入')); assert.ok(!browser.includes('request.fetch('));
  const { generateJmeterScript } = await import('../lib/jmeter-generator.js');
  assert.throws(() => generateJmeterScript(spec), /API 事实未决/);
  const { runApiTests } = await import('../lib/api-executor.js');
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('transport must not run'); };
  try { const result = await runApiTests({ contractPath: spec, baseUrl: 'http://localhost:9' }); assert.match(result.error, /API 事实未决/); assert.equal(calls, 0); }
  finally { globalThis.fetch = originalFetch; }
  const { generateE2eScaffold } = await import('../lib/e2e-generator.js');
  const out = path.join(root, 'e2e'); const generated = generateE2eScaffold(spec, { outputDir: out });
  const round2 = fs.readFileSync(path.join(out, 'tests/round2-write.spec.js'), 'utf8');
  assert.ok(generated.warnings.some((warning) => warning.includes('API 事实未决')));
  assert.ok(round2.includes('test.describe.skip(') && round2.includes('API 事实未决'));
  assert.ok(round2.includes('机') || round2.includes('orderNo'));
  assert.ok(!round2.includes('/api/queryPage') && !round2.includes('/api/deleteById'));
  assert.ok(fs.existsSync(path.join(out, 'tests/round1-readonly.spec.js')) && fs.existsSync(path.join(out, 'tests/ui-contract.spec.js')));
});

test('API scripts use only declared methods and paths and never invent a missing create endpoint', async (t) => {
  const root = tmp(t); const input = { ...api, operations: { page: { method: 'GET', externalPath: '/service/search' } } };
  const file = write(root, 'api.json', input);
  const { generatePlaywrightScript } = await import('../lib/playwright-generator.js');
  const script = generatePlaywrightScript(file);
  assert.ok(script.includes('/service/search')); assert.ok(script.includes('"method":"GET"'));
  assert.ok(!script.includes('/queryPage') && !script.includes('/save') && !script.includes('新增数据成功'));
});
