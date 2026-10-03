import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = 'SoLoVisionLLC/SoLo-CallMe';
export const image = 'ghcr.io/solovisionllc/solo-callme';

// Matches metadata-action v5's semver {{version}}, {{major}}.{{minor}}, raw latest.
// Invalid v* tags still receive raw latest; prereleases never receive major.minor.
export function imageTags(tag) {
  if (tag.length > 256) return ['latest'];
  const m = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag.replaceAll('/', '-'));
  if (!m || m.slice(1, 4).some(n => !Number.isSafeInteger(Number(n))) || m[4]?.split('.').some(n => /^0[0-9]+$/.test(n))) return ['latest'];
  const version = `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ''}`;
  return [...new Set([version, ...m[4] ? [] : [`${m[1]}.${m[2]}`], 'latest'])];
}

export function releaseBody(tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : `refs/tags/${tag}`;
  return `## solo-callme ${version}\n\n### Install\n\`\`\`bash\n# Clone and run locally\ngit clone https://github.com/SoLoVisionLLC/SoLo-CallMe.git\ncd SoLo-CallMe/server && bun install && bun run src/index.ts\n\n# Or connect to hosted server\nclaude mcp add -s user --transport http solo-callme https://callme.sololink.cloud/mcp\n\`\`\`\n\nSee [CHANGELOG.md](https://github.com/SoLoVisionLLC/SoLo-CallMe/blob/main/CHANGELOG.md) for details.\n`;
}

export function createPlan({tag, sha, event, publish = false}) {
  if (!tag || tag.startsWith('-') || /[\x00-\x20\x7f~^:?*\[\\]/.test(tag) || tag.includes('..') || tag.includes('@{') || tag.endsWith('.') || tag.endsWith('/') || tag.endsWith('.lock')) throw new Error('SOURCE_CONFIG: invalid source tag');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('SOURCE_CONFIG: exact commit required');
  if (!['validation', 'push', 'release_published'].includes(event)) throw new Error('SOURCE_CONFIG: unsupported event');
  if (event === 'push' && !tag.startsWith('v')) throw new Error('SOURCE_CONFIG: push tag must match v*');
  if (publish && event === 'validation') throw new Error('SOURCE_CONFIG: validation cannot publish');
  return {repository, image, tag, sha, event, publish, tags: imageTags(tag), body: releaseBody(tag)};
}

export function verifySource(source) {
  const root = resolve(source);
  for (const path of ['Dockerfile', 'package.json', 'server/package.json', 'server/src/index-sse.ts']) if (!existsSync(resolve(root, path))) throw new Error(`SOURCE_CONFIG: missing ${path}`);
  if (!['server/bun.lock', 'server/bun.lockb'].some(p => existsSync(resolve(root, p)))) throw new Error('SOURCE_CONFIG: missing Bun lockfile');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json')));
  const server = JSON.parse(readFileSync(resolve(root, 'server/package.json')));
  if (pkg.version !== server.version) throw new Error('SOURCE_CONFIG: package version mismatch');
  if (!readFileSync(resolve(root, 'Dockerfile'), 'utf8').includes('bun install --frozen-lockfile --production')) throw new Error('SOURCE_CONFIG: Docker dependency install contract');
  return {version: pkg.version};
}

export function ociLabels(plan, repo, created) {
  return {
    'org.opencontainers.image.title': repo.name || '',
    'org.opencontainers.image.description': repo.description || '',
    'org.opencontainers.image.url': repo.html_url || '',
    'org.opencontainers.image.source': repo.html_url || '',
    'org.opencontainers.image.version': plan.tags[0],
    'org.opencontainers.image.created': created,
    'org.opencontainers.image.revision': plan.sha,
    'org.opencontainers.image.licenses': repo.license?.spdx_id || '',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = createPlan({tag: process.env.RELEASE_TAG, sha: process.env.SOURCE_COMMIT, event: process.env.SOURCE_EVENT, publish: process.env.PUBLISH === 'true'});
  mkdirSync('.jenkins-release', {recursive:true});
  writeFileSync('.jenkins-release/plan.json', JSON.stringify(plan, null, 2) + '\n');
  writeFileSync('.jenkins-release/release-body.md', plan.body);
  console.log(JSON.stringify({tag: plan.tag, commit: plan.sha, event: plan.event, publish: plan.publish, tags: plan.tags}));
}
