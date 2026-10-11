/** Real CLI/MCP receipts must agree with actual rules and smoke samples, including zero work. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {audit} from '../lib/test-audit.js';import {runGate} from '../lib/gate.js';import {smokeEvidence} from '../lib/gate-evidence.js';
import {createInstallPlan,applyInstallPlan} from '../lib/cli/install-state.js';import {PKG_ROOT,PKG} from '../lib/cli/context.js';import {HANDLERS} from '../mcp/tools/handlers.js';
const good=`import {test,expect} from '@playwright/test';\ntest.beforeEach(()=>{});test.afterEach(()=>{});test('should display',async({page})=>{await expect(page.locator('table')).toBeVisible();});`;
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wl-gate-evidence-')));const reports=root+'.reports';t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(reports,{recursive:true,force:true});});applyInstallPlan(createInstallPlan(root,{filesDir:path.join(PKG_ROOT,'files'),version:PKG.version}));fs.mkdirSync(path.join(root,'empty'));return{root,reports,cli:args=>spawnSync(process.execPath,[path.join(PKG_ROOT,'bin/wl-skills-test.js'),...args],{cwd:root,encoding:'utf8'})};}

test('空目录/普通业务代码：audit 与 CLI/MCP/gate 均不制造通过，同 runId 状态保持未验证',async t=>{
 const f=fixture(t);const empty=path.join(f.root,'empty');const ordinary=path.join(f.root,'order.ts');fs.writeFileSync(ordinary,'export const order=1;');
 for(const target of [empty,ordinary]){const result=audit(target);assert.equal(result.pass,null);assert.equal(result.validationStatus,'unverified');assert.deepEqual(result.executedChecks,[]);assert.equal((await runGate({auditDir:target})).pass,false);}
 const planned=f.cli(['task','检查测试质量门','--files','empty','--run-id','empty-gate','--json']);assert.equal(planned.status,0,planned.stderr);
 const rejected=f.cli(['gate','--audit-dir','empty','--run-id','empty-gate','--reports-dir',f.reports]);assert.equal(rejected.status,1);assert.ok(!rejected.stdout.includes('允许上线'));assert.ok(rejected.stderr.includes('未验证'));
 const status=JSON.parse(f.cli(['status','--run-id','empty-gate','--json']).stdout);assert.equal(status.validationStatus,'unverified');assert.notEqual(status.executionStatus,'completed');
 const plainAudit=f.cli(['audit','--target','empty','--run-id','empty-audit','--reports-dir',f.reports]);assert.equal(plainAudit.status,1);assert.ok(plainAudit.stdout.includes('审计未验证'));assert.ok(!plainAudit.stdout.includes('审计通过'));
 const mcp=HANDLERS.wls_test_audit({root:f.root,target:empty,runId:'mcp-empty',reportsDir:f.reports});assert.equal(mcp.pass,null);assert.equal(mcp.execution.validationStatus,'unverified');
 const ci=spawnSync(process.execPath,[path.join(PKG_ROOT,'scripts/quality-gate.js'),'--audit-dir',empty],{cwd:f.root,encoding:'utf8'});assert.equal(ci.status,1);assert.ok(!ci.stdout.includes('允许上线'));
});

test('真实规则与充分报告可通过，原 CLI 与同 runId status 保留 checkedFiles 证据',async t=>{
 const f=fixture(t);const file=path.join(f.root,'order.spec.js');fs.writeFileSync(file,good);assert.equal(audit(file).pass,true);
 const plan=f.cli(['task','检查测试质量门','--files','order.spec.js','--run-id','good-gate','--json']);assert.equal(plan.status,0,plan.stderr);
 const run=f.cli(['gate','--audit-dir','order.spec.js','--run-id','good-gate','--reports-dir',f.reports]);assert.equal(run.status,0,run.stderr);
 const status=JSON.parse(f.cli(['status','--run-id','good-gate','--json']).stdout);assert.equal(status.executionStatus,'completed');assert.equal(status.validationStatus,'passed');assert.deepEqual(status.scopeGaps,[]);assert.ok(status.records.some(r=>r.kind==='tool-finished'&&r.checkedFiles.some(checked=>checked.path==='order.spec.js')));
 const smoke=path.join(f.root,'smoke.json');fs.writeFileSync(smoke,JSON.stringify({summary:{total:2,passed:2,failed:0,errors:0,skipped:0,passRate:100,pass:true},results:[{status:'pass'},{status:'pass'}]}));assert.equal((await runGate({smokeResult:smoke})).pass,true);
});

test('烟测：仅比率/零样本/全跳过/计数冲突/明细冲突/失败高比率/清理未完成/partial 都不能通过',()=>{
 const valid={total:2,passed:2,failed:0,errors:0,skipped:0,passRate:100};
 for(const summary of [{passRate:100},{...valid,total:0,passed:0},{...valid,passed:0,skipped:2},{...valid,total:1},{...valid,passRate:99}])assert.ok(smokeEvidence({summary}).error,JSON.stringify(summary));
 for(const extra of [{pass:'true'},{assertions:{total:0,failed:0}},{assertions:{total:1,failed:-1}},{cleanup:{created:0,cleaned:1}}])assert.ok(smokeEvidence({summary:{...valid,...extra}}).error);
 assert.ok(smokeEvidence({summary:valid,results:[]}).error);
 assert.ok(smokeEvidence({summary:valid,results:[{status:'pass'},{status:'fail'}]}).error);
 for(const value of [{summary:{total:100,passed:99,failed:1,errors:0,skipped:0,passRate:99}},{summary:{...valid,pass:false}},{summary:{...valid,assertions:{total:2,failed:1}}},{summary:{...valid,cleanup:{created:1,cleaned:0}}},{summary:valid,execution:{validationStatus:'partial'}},{summary:{...valid,cleanup:{created:1,cleaned:1,verified:false}}}])assert.equal(smokeEvidence(value).pass,false,JSON.stringify(value));
 assert.equal(smokeEvidence({...valid}).pass,true,'支持带充分计数的旧顶层格式');
});

test('审计隐式遍历不跟随兄弟项目符号链接或目录环；跳过范围如实未验证',async t=>{
 const f=fixture(t);const outside=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wl-audit-neighbor-')));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 const target=path.join(f.root,'empty');fs.writeFileSync(path.join(target,'valid.spec.js'),good);fs.writeFileSync(path.join(outside,'neighbor.spec.js'),good+'\nconst token="outside-not-authorized";');
 fs.symlinkSync(outside,path.join(target,'neighbor'));fs.symlinkSync(target,path.join(target,'loop'));
 const started=Date.now();const result=audit(target);assert.ok(Date.now()-started<1000);assert.equal(result.pass,null);assert.equal(result.validationStatus,'unverified');assert.equal(result.skippedEntries.filter(entry=>entry.reason==='symbolic-link-not-followed').length,2);
 assert.ok(result.executedChecks.length>0);assert.ok(result.executedChecks.every(check=>check.evidencePaths.every(file=>!file.includes('neighbor')&&!file.includes('/loop/'))));assert.equal((await runGate({auditDir:target})).pass,false);
});
