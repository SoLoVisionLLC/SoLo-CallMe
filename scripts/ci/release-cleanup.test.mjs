import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { builderFor, recordBuilder, cleanupBuilder } from './release-cleanup.mjs';

const buildTag = 'jenkins-callme-release-123';
const moduleUrl = new URL('./release-cleanup.mjs',import.meta.url).href;

test('a killed publisher leaves durable ownership for a separate Jenkins cleanup process', async()=>{
  const root=mkdtempSync(join(tmpdir(),'callme-interrupted-'));
  let child;
  try {
    // Simulate the point immediately before Docker create. This process is killed
    // without finally; no real Docker executable or daemon is used.
    const code=`import {recordBuilder} from ${JSON.stringify(moduleUrl)}; recordBuilder(${JSON.stringify(root)},${JSON.stringify(buildTag)}); console.log('receipt-persisted'); setInterval(()=>{},1000);`;
    child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
    const [ready]=await once(child.stdout,'data');
    assert.match(ready.toString(),/receipt-persisted/);
    const exited=once(child,'exit');
    child.kill('SIGKILL');
    await exited;
    const calls=[];
    assert.equal(cleanupBuilder(root,{BUILD_TAG:buildTag,GH_TOKEN:'test-token',GHCR_PASSWORD:'test-password'},(program,args,options)=>{
      calls.push({program,args});
      assert.equal(options.env.GH_TOKEN,undefined);
      assert.equal(options.env.GHCR_PASSWORD,undefined);
      return {status:0};
    }),true);
    assert.deepEqual(calls,[{program:'docker',args:['buildx','rm','--force',builderFor(buildTag)]}]);
    assert.equal(existsSync(join(root,'.jenkins-release/builder-owner.json')),false);
    assert.equal(cleanupBuilder(root,{BUILD_TAG:buildTag},()=>assert.fail('second cleanup must not call Docker')),false);
  } finally { if(child && child.exitCode===null && child.signalCode===null)child.kill('SIGKILL'); rmSync(root,{recursive:true,force:true}); }
});

test('foreign ownership never invokes Docker',()=>{
  const root=mkdtempSync(join(tmpdir(),'callme-foreign-'));
  try {
    recordBuilder(root,'jenkins-other-456');
    assert.throws(()=>cleanupBuilder(root,{BUILD_TAG:buildTag},()=>assert.fail('foreign builder must not be removed')),/foreign builder/);
    assert.equal(existsSync(join(root,'.jenkins-release/builder-owner.json')),true);
  } finally {rmSync(root,{recursive:true});}
});

test('failed daemon cleanup keeps scoped receipt and config for Jenkins retry',()=>{
  const root=mkdtempSync(join(tmpdir(),'callme-retry-'));
  try {
    recordBuilder(root,buildTag);
    const config=join(root,'.jenkins-release/docker-config');
    mkdirSync(config);writeFileSync(join(config,'config.json'),'{}');
    assert.throws(()=>cleanupBuilder(root,{BUILD_TAG:buildTag},()=>({status:1})),/exact builder cleanup failed/);
    assert.equal(existsSync(config),true);
    assert.equal(cleanupBuilder(root,{BUILD_TAG:buildTag},()=>({status:0})),true);
    assert.equal(existsSync(config),false);
  } finally {rmSync(root,{recursive:true});}
});

test('pipeline cleanup and persistent receipt precede workspace deletion and Docker create',()=>{
  const pipeline=readFileSync(new URL('../../Jenkinsfile.release',import.meta.url),'utf8');
  const post=pipeline.slice(pipeline.indexOf('  post {'));
  assert.ok(post.indexOf('node scripts/ci/release-cleanup.mjs')<post.indexOf('deleteDir()'));
  assert.match(post,/finally\s*\{/);
  const publisher=readFileSync(new URL('./release-publisher.mjs',import.meta.url),'utf8');
  assert.ok(publisher.indexOf('recordBuilder(process.cwd(), process.env.BUILD_TAG)')<publisher.indexOf("command('docker',['buildx','create'"));
  assert.doesNotMatch(publisher,/docker.*prune/);
});
