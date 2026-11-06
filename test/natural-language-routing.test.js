import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG, PKG_ROOT } from '../lib/cli/context.js';

const bin = path.join(PKG_ROOT, 'bin/wl-skills-test.js');
const cases = [
  ['编写测试用例', 'matched', ['test-case-generator']],
  ['生成接口测试用例', 'matched', ['test-case-generator']],
  ['编写接口测试用例', 'matched', ['test-case-generator']],
  ['为用户接口补测试用例', 'matched', ['test-case-generator']],
  ['补充接口测试用例', 'matched', ['test-case-generator']],
  ['不要编写接口测试用例，只检查代码', 'baseline', [], 'inspect'],
  ['旧任务要求“生成接口测试用例”，本次只审查代码', 'baseline', [], 'inspect'],
  ['只解释如何编写接口测试用例，不生成文件', 'matched', ['test-case-generator'], 'explain'],
  ['先列一个编写接口测试用例的计划，不改文件', 'matched', ['test-case-generator'], 'plan'],
  ['编写接口测试用例并评审测试用例', 'ambiguous', []],
  ['核对发货端到端测试断言，看看有没有恒真断言。不要运行浏览器，不修改测试脚本。', 'matched', ['universal-test-rules'], 'inspect'],
  ['Review the weak assertions in the shipment spec, without running Playwright.', 'matched', ['universal-test-rules'], 'inspect'],
  ['检查 E2E 测试断言是否真正覆盖取消订单后的状态。', 'matched', ['universal-test-rules'], 'inspect'],
  ['解释怎样检查测试断言，不调用任何工具。', 'matched', ['universal-test-rules'], 'explain'],
  ['不要检查测试断言，只评审测试用例。', 'matched', ['test-case-reviewer'], 'inspect'],
  ['分析测试报告里的执行结果，只看失败数量。', 'matched', ['test-quality-analyzer']],
  ['编写 Playwright 脚本验证退货单，断言按钮状态。', 'matched', ['test-script-generator']],
  ['检查采购页面的到货状态和筛选条件。', 'baseline', [], 'inspect'],
  ['对接口进行模糊测试', 'gap', []],
  ['写一首诗', 'not-applicable', []],
];

for (const [task, status, skills, mode] of cases) test(`公开 CLI 与协议识别自然测试请求：${task}`, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-natural-'));
  const project = path.join(temporary, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ private: true, devDependencies: { [PKG.name]: PKG.version } }));
  const run = args => {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  try {
    const request = path.join(temporary, 'request.json');
    fs.writeFileSync(request, JSON.stringify({ operation: 'route', projectRoot: project, task }));
    const envelope = run(['protocol', 'request', '--input-file', request, '--json']);
    assert.equal(envelope.ok, true);
    const direct = run(['route', '--task', task, '--root', project, '--json']);
    for (const result of [direct, envelope.result]) {
      const decision = result.decision || result;
      assert.equal(decision.status, status);
      assert.deepEqual(decision.selectedSkills, skills);
      assert.equal(decision.action.businessWritesAuthorized, false);
      if (mode) assert.equal(decision.action.mode, mode);
      if (['explain', 'plan'].includes(mode)) assert.equal(decision.action.checksAllowed, false);
      if (skills.includes('universal-test-rules')) assert.deepEqual(decision.requiredChecks, ['test-code-audit']);
    }
    assert.equal(envelope.result.integration.packageName, PKG.name);
    assert.equal(envelope.result.integration.runId, null);
    assert.deepEqual(fs.readdirSync(project), ['package.json']);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
