import { readFileSync } from 'node:fs';
import { createPlan, verifySource } from './release-plan.mjs';

console.log(`[release-gate] START app=SoLo-CallMe commit=${process.env.SOURCE_COMMIT ?? 'local'}`);
try {
  const packageFile = JSON.parse(readFileSync('package.json'));
  if (packageFile.scripts?.['release:readiness:jenkins'] !== 'node scripts/ci/release-readiness-gate.mjs') throw new Error('SOURCE_CONFIG: missing readiness alias');
  const pipeline = readFileSync('Jenkinsfile.release', 'utf8');
  const gate = pipeline.indexOf("stage('Release Readiness Gate')");
  for (const stage of ['GitHub release', 'Build container']) if (gate < 0 || pipeline.indexOf(`stage('${stage}')`) <= gate) throw new Error('SOURCE_CONFIG: gate ordering');
  if (!pipeline.includes("booleanParam(name: 'PUBLISH', defaultValue: false")) throw new Error('SOURCE_CONFIG: publication must default off');
  createPlan({tag: process.env.RELEASE_TAG, sha: process.env.SOURCE_COMMIT, event: process.env.SOURCE_EVENT, publish: process.env.PUBLISH === 'true'});
  verifySource(process.env.RELEASE_SOURCE_DIR || '.');
  console.log('[release-gate] PASS check=release-source-and-publication-contract');
  console.log('[release-gate] SUMMARY result=PASS classification=READY checks=1');
} catch (error) {
  console.error(`[release-gate] FAIL class=SOURCE_CONFIG check=release-source message=${error.message}`);
  console.error('[release-gate] SUMMARY result=FAIL classification=SOURCE_CONFIG');
  process.exitCode = 1;
}
