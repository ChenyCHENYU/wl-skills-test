/** Synthetic npx subprocesses test transport/statistics boundaries, never prove real browser behavior. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {PKG_ROOT} from '../lib/cli/context.js';
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'wl-pw-boundary-')));const tools=path.join(root,'tools');fs.mkdirSync(tools);fs.mkdirSync(path.join(root,'tests'));fs.writeFileSync(path.join(root,'tests/example.test.js'),'// scope snapshot fixture only');
 const program=`#!/usr/bin/env node\nconst mode=process.env.WL_PW_FIXTURE_MODE;if(process.argv.includes('--version')){console.log('1.0.0');process.exit(mode==='version-failure'?1:0);}if(mode.startsWith('json-')){const expected=mode==='json-zero'?0:mode==='json-failed'?99:2;const unexpected=mode==='json-failed'?1:0;console.log(JSON.stringify({stats:{expected,unexpected,skipped:0,flaky:0,duration:1},suites:[]}));process.exit(unexpected?1:0);}if(mode==='junit'){console.log('<testsuites tests="2" failures="0"/>');process.exit(0);}if(mode==='version-failure'){require('node:fs').writeFileSync('unexpected-start','bad');process.exit(0);}if(mode==='zero'){process.stderr.write('configuration failed');process.exit(1);}if(mode==='skipped'){console.log('2 skipped');process.exit(0);}if(mode==='failed'){console.log('99 passed 1 failed');process.exit(1);}if(mode==='timeout'){process.on('SIGTERM',()=>{});console.log('1 passed');setInterval(()=>{},1000);}else if(mode==='output-limit'){process.on('SIGTERM',()=>{});console.log('1 passed');process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000);}else{console.log('2 passed');process.exit(0);}`;
 fs.writeFileSync(path.join(tools,'npx'),program,{mode:0o755});t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(root+'.reports',{recursive:true,force:true});});return{root,env:mode=>({...process.env,PATH:tools+path.delimiter+process.env.PATH,WL_PW_FIXTURE_MODE:mode})};}

test('原 Playwright CLI：真实 subprocess 非零/零样本不 exit0；充分执行正常退出',t=>{
 const f=fixture(t);for(const [mode,expected] of [['good',0],['zero',1],['failed',1],['skipped',1],['version-failure',1]]){
  const run=spawnSync(process.execPath,[path.join(PKG_ROOT,'bin/wl-skills-test.js'),'run-playwright','--test-dir','tests','--run-id',mode,'--reports-dir',f.root+'.reports'],{cwd:f.root,env:f.env(mode),encoding:'utf8',timeout:10000});assert.equal(run.status,expected,mode+run.stdout+run.stderr);
  if(mode==='failed')assert.ok(run.stdout.includes('不通过（执行器非零退出）'));
  const result=JSON.parse(fs.readFileSync(path.join(f.root+'.reports','runs',mode,'playwright-result.json')));assert.equal(result.execution.executionStatus,mode==='good'||mode==='failed'?'completed':'failed');assert.notEqual(result.pass,mode==='good'?false:true);
  if(mode==='failed')assert.equal(result.execution.validationStatus,'failed');if(mode==='zero'||mode==='skipped'||mode==='version-failure')assert.equal(result.execution.validationStatus,'unverified');
 }
 assert.equal(fs.existsSync(path.join(f.root,'unexpected-start')),false,'失败的版本探测不能启动测试命令');
});

test('原生 JSON stdout 共用既有解析；非零/零用例不能通过，JUnit 保持未验证',t=>{
 const f=fixture(t);for(const [mode,reporter,expected] of [['json-good','json',0],['json-failed','json',1],['json-zero','json',1],['junit','junit',1]]){
  const run=spawnSync(process.execPath,[path.join(PKG_ROOT,'bin/wl-skills-test.js'),'run-playwright','--test-dir','tests','--reporter',reporter,'--run-id',mode,'--reports-dir',f.root+'.reports'],{cwd:f.root,env:f.env(mode),encoding:'utf8',timeout:10000});assert.equal(run.status,expected,mode+run.stdout+run.stderr);
  const result=JSON.parse(fs.readFileSync(path.join(f.root+'.reports','runs',mode,'playwright-result.json')));
  if(mode==='json-good'){assert.equal(result.pass,true);assert.equal(result.passed,2);assert.equal(result.format,'playwright-native');assert.equal(result.execution.validationStatus,'passed');}
  if(mode==='json-failed'){assert.equal(result.pass,false);assert.equal(result.failed,1);assert.equal(result.processExitCode,1);assert.equal(result.execution.validationStatus,'failed');}
  if(mode==='json-zero'||mode==='junit'){assert.equal(result.pass,null);assert.equal(result.execution.validationStatus,'unverified');assert.ok(result.error);}
  if(mode==='junit')assert.equal(result.errorCode,'UNSUPPORTED_REPORTER_OUTPUT');
 }
});

test('超时/输出超限有界结束并保留失败，已打印 passed 不得当通过',t=>{
 const f=fixture(t);const module=JSON.stringify(path.join(PKG_ROOT,'lib/executors.js'));
 for(const mode of ['timeout','output-limit']){
  const script=`const {runPlaywright}=await import(${module});const r=await runPlaywright({testDir:'tests',timeoutMs:150,killGraceMs:30,maxOutputBytes:${mode==='output-limit'?64:1024}});console.log(JSON.stringify(r));`;
  const start=Date.now();const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.root,env:f.env(mode),encoding:'utf8',timeout:5000});assert.equal(run.status,0,run.stderr);assert.ok(Date.now()-start<2500,'终止宽限期后必须结束');const result=JSON.parse(run.stdout);assert.equal(result.pass,false);assert.equal(result.errorCode,'PLAYWRIGHT_PROCESS_FAILED');assert.equal(result[mode==='timeout'?'timedOut':'outputTruncated'],true);assert.ok(result.error);
 }
});
