import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export function builderFor(buildTag) {
  if (!buildTag) throw new Error('SOURCE_CONFIG: BUILD_TAG is required for scoped builder ownership');
  return 'callme-' + createHash('sha256').update(buildTag).digest('hex').slice(0,16);
}

export function recordBuilder(root, buildTag) {
  const area = resolve(root, '.jenkins-release');
  mkdirSync(area, {recursive:true,mode:0o700});
  const builder = builderFor(buildTag);
  // Must persist before docker create, including partial-create and kill windows.
  writeFileSync(join(area,'builder-owner.json'),JSON.stringify({buildTag,builder})+'\n',{mode:0o600});
  return builder;
}

export function cleanupBuilder(root, env = process.env, run = spawnSync) {
  const area = resolve(root, '.jenkins-release');
  const receipt = join(area,'builder-owner.json');
  if (!existsSync(receipt)) return false;
  const owner = JSON.parse(readFileSync(receipt,'utf8'));
  const expected = builderFor(env.BUILD_TAG);
  if (owner.buildTag !== env.BUILD_TAG || owner.builder !== expected) throw new Error('SOURCE_CONFIG: refusing foreign builder cleanup');
  const cleanEnv = {...env,DOCKER_CONFIG:join(area,'docker-config')};
  delete cleanEnv.GH_TOKEN;
  delete cleanEnv.GHCR_PASSWORD;
  delete cleanEnv.GHCR_USERNAME;
  const result = run('docker',['buildx','rm','--force',expected],{env:cleanEnv,encoding:'utf8',stdio:'pipe'});
  if (result.error || result.status !== 0) throw new Error(`AGENT: exact builder cleanup failed builder=${expected}; retry cleanup with the same BUILD_TAG`);
  rmSync(join(area,'docker-config'),{recursive:true,force:true});
  rmSync(receipt);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cleanupBuilder(process.cwd());
