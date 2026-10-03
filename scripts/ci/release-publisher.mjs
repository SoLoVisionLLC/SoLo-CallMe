import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPlan, ociLabels, repository, verifySource } from './release-plan.mjs';
import { builderFor, recordBuilder, cleanupBuilder } from './release-cleanup.mjs';

const area = resolve('.jenkins-release');
const source = resolve('source');
const stored = JSON.parse(readFileSync(join(area, 'plan.json')));
const plan = createPlan({tag:process.env.RELEASE_TAG, sha:process.env.SOURCE_COMMIT, event:process.env.SOURCE_EVENT, publish:process.env.PUBLISH === 'true'});
if (JSON.stringify(plan) !== JSON.stringify(stored)) throw new Error('SOURCE_CONFIG: plan changed');
verifySource(source);
const safeEnv = {...process.env};
delete safeEnv.GH_TOKEN;
delete safeEnv.GHCR_PASSWORD;
delete safeEnv.GHCR_USERNAME;
function command(program, args, options = {}) {
  const result = spawnSync(program, args, {env:safeEnv, encoding:'utf8', stdio:'inherit', ...options});
  if (result.error || result.status !== 0) throw new Error(`TOOLCHAIN: ${program} failed (exit=${result.status})`);
  return result.stdout?.trim();
}
if (command('git', ['-C',source,'rev-parse','HEAD'], {stdio:'pipe'}) !== plan.sha) throw new Error('SOURCE_CONFIG: source SHA changed');
function publicationIntent() {
  if (!plan.publish || process.env.PUBLISH !== 'true' || plan.event === 'validation') throw new Error('SOURCE_CONFIG: publication disabled');
}
async function api(path, method = 'GET', body) {
  if (!process.env.GH_TOKEN) throw new Error('CREDENTIAL: GitHub token missing');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    method, redirect:'error', signal:AbortSignal.timeout(30000),
    headers:{Accept:'application/vnd.github+json', Authorization:`Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version':'2022-11-28', 'Content-Type':'application/json'},
    body:body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404) return {missing:true};
  if (!response.ok) throw new Error(`TRANSPORT: GitHub ${method} ${path.split('?')[0]} failed (HTTP ${response.status})`);
  return response.json();
}

const action = process.argv[2];
if (action === 'metadata') {
  publicationIntent();
  const repo = await api('');
  if (repo.missing || repo.full_name !== repository) throw new Error('CREDENTIAL: repository metadata unavailable');
  writeFileSync(join(area,'labels.json'), JSON.stringify(ociLabels(plan,repo,new Date().toISOString()),null,2)+'\n');
} else if (action === 'github') {
  publicationIntent();
  if (plan.event !== 'push') throw new Error('SOURCE_CONFIG: only push creates or updates release');
  const base = {tag_name:plan.tag, name:plan.tag, body:plan.body, generate_release_notes:true};
  let complete = false;
  for (let attempt=0; attempt<3 && !complete; attempt++) {
    const existing = await api(`/releases/tags/${encodeURIComponent(plan.tag)}`);
    try {
      const result = existing.missing
        ? await api('/releases','POST',base)
        : await api(`/releases/${existing.id}`,'PATCH',{...base,target_commitish:existing.target_commitish,draft:existing.draft,prerelease:existing.prerelease});
      if (result.missing) throw new Error('TRANSPORT: release endpoint returned 404');
      writeFileSync(join(area,'release-receipt.json'),JSON.stringify({id:result.id,tag:result.tag_name,url:result.html_url,sha:plan.sha})+'\n');
      complete = true;
    } catch(error) {
      if (!existing.missing || attempt===2) throw error;
    }
  }
} else if (action === 'container') {
  const builder = builderFor(process.env.BUILD_TAG);
  const config = join(area,'docker-config');
  mkdirSync(config,{recursive:true,mode:0o700});
  safeEnv.DOCKER_CONFIG = config;
  try {
    if (plan.publish) {
      publicationIntent();
      if (!process.env.GHCR_USERNAME || !process.env.GHCR_PASSWORD) throw new Error('CREDENTIAL: GHCR username/password missing');
      writeFileSync(join(config,'config.json'),JSON.stringify({auths:{'ghcr.io':{auth:Buffer.from(`${process.env.GHCR_USERNAME}:${process.env.GHCR_PASSWORD}`).toString('base64')}}}),{mode:0o600});
    }
    recordBuilder(process.cwd(), process.env.BUILD_TAG);
    command('docker',['buildx','create','--driver','docker-container','--name',builder]);
    command('docker',['buildx','inspect',builder,'--bootstrap']);
    const labels = plan.publish
      ? JSON.parse(readFileSync(join(area,'labels.json')))
      : ociLabels(plan,{name:'SoLo-CallMe',html_url:`https://github.com/${repository}`},new Date().toISOString());
    const args = ['buildx','build','--builder',builder,'--metadata-file',join(area,'build-metadata.json')];
    for (const tag of plan.tags) args.push('--tag',`${plan.image}:${tag}`);
    for (const [key,value] of Object.entries(labels)) args.push('--label',`${key}=${value}`);
    // Jenkins has no Actions cache runtime token. A local BuildKit cache preserves
    // cache behavior without granting another remote publication destination.
    const cache = join(area,'build-cache');
    if (existsSync(join(cache,'index.json'))) args.push('--cache-from',`type=local,src=${cache}`);
    args.push('--cache-to',`type=local,dest=${join(area,'build-cache-next')},mode=max`);
    if (plan.publish) args.push('--push');
    else args.push('--output',`type=oci,dest=${join(area,'validation-image.oci.tar')}`);
    args.push(source);
    command('docker',args);
  } finally {
    // Jenkins post invokes the same scoped cleanup if this process is killed.
    cleanupBuilder(process.cwd(), process.env);
  }
} else throw new Error('SOURCE_CONFIG: unsupported publisher action');
