import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PKG, PKG_ROOT } from '../lib/cli/context.js';
const cli = path.join(PKG_ROOT, 'bin/wl-skills-test.js');
const cases = [
  ['这个项目还没接自动化测试，先检测形态和接口描述来源，给我接入方案', 'matched', ['test-onboarding']],
  ['把采购需求拆成可以逐条执行的测试用例，给出前置条件和具体预期', 'matched', ['test-case-generator']],
  ['评审这份用例表，检查边界遗漏、无效步骤和不可验证的预期', 'matched', ['test-case-reviewer']],
  ['全量回归太久了，从现有用例选一套最小但稳定的冒烟集合', 'matched', ['smoke-test-selector']],
  ['执行已经选好的冒烟集合，把每条通过失败和证据列清楚', 'matched', ['smoke-test-executor']],
  ['把这些页面URL和已确认的操作步骤生成Playwright可运行脚本', 'matched', ['test-script-generator']],
  ['给所有模块统一一套自动化执行规则，明确数据隔离、断言和清理要求', 'matched', ['universal-test-rules']],
  ['对比两轮执行结果和缺陷表，找出漏测和反复出现的问题并提出改进', 'matched', ['test-quality-analyzer']],
  ['按确认的接口和授权负载预算生成JMeter脚本，参数和断言都补齐', 'matched', ['perf-script-generator']],
  ['分析这次JTL和监控CSV，指出响应时间拐点和可能瓶颈', 'matched', ['perf-report-analyzer']],
  ['不要生成测试用例，只评审这份用例表', 'matched', ['test-case-reviewer']],
  ['先生成测试用例，然后执行冒烟集合', 'ambiguous', []],
  ['编写测试用例并评审测试用例', 'ambiguous', []],
  ['生成性能测试方案', 'matched', ['perf-plan-generator']],
  ['根据测试计划生成脚本', 'gap', []],
  ['根据用例生成脚本并执行冒烟', 'ambiguous', []],
  ['根据已确认的设计方案生成接口测试用例', 'matched', ['test-case-generator']],
  ['不要根据测试计划生成脚本，只评审这份用例表', 'matched', ['test-case-reviewer']],
  ['根据测试计划不要生成脚本，只评审现有用例表', 'matched', ['test-case-reviewer']],
  ['设计mypLaywrightHelper', 'needs-context', []],
  [`编写${'的'.repeat(48)}用例`, 'gap', []],
];
for (const [task, status, selected] of cases) test(`动作与职责对象组合保留明确工作流：${task}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-workflow-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, devDependencies: { [PKG.name]: PKG.version } }));
    const input = path.join(root, 'request.json');
    fs.writeFileSync(input, JSON.stringify({ operation: 'route', projectRoot: root, task }));
    const result = spawnSync(process.execPath, [cli, 'protocol', 'request', '--input-file', input, '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const envelope = JSON.parse(result.stdout);
    const decision = envelope.result;
    assert.equal(decision.status, status, JSON.stringify(decision.candidates));
    assert.deepEqual(decision.selectedSkills, selected);
    assert.deepEqual(decision.skillDetails.map(item => item.id), selected);
    assert.ok(decision.skillDetails.every(item => /[\u3400-\u9fff]/u.test(item.name)));
    assert.equal(decision.action.businessWritesAuthorized, false);
    assert.equal(decision.notice.executionStatus, 'not-executed');
    assert.equal(fs.existsSync(path.join(root, '.wl-skills/state/test/runs')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
