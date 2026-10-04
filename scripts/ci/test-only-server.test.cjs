const test = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');
const source = readFileSync(join(__dirname, 'test-only-server.sh'), 'utf8');
for (const scenario of ['success', 'install-noop', 'install-fail', 'build-noop', 'build-fail']) {
  test(`actual shell runner: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'callme-ci-runner-'));
    try {
      mkdirSync(join(root, 'server', '.ci-test-build'), {recursive:true});
      writeFileSync(join(root, 'server', '.ci-test-build', 'index.js'), 'stale output');
      writeFileSync(join(root, 'runner.sh'), source);
      const fixture = `
id() { printf '1000\\n'; }
bun() {
  case "$*" in *--no-env-file*--config=*) ;; *) return 71;; esac
  case "$1" in
    install)
      case "$SCENARIO" in install-fail) return 72;; install-noop) return 0;; esac
      mkdir -p node_modules/@modelcontextprotocol/sdk
      printf '{}' > node_modules/@modelcontextprotocol/sdk/package.json;;
    run) return 1;;
    build)
      case "$SCENARIO" in build-fail) return 73;; build-noop) return 0;; esac
      printf 'compiled' > .ci-test-build/index.js;;
    *) return 74;;
  esac
}
. ./runner.sh
`;
      const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
      const result = spawnSync(bash, ['-c',fixture], {cwd:root, env:{...process.env,SCENARIO:scenario},encoding:'utf8',timeout:10000});
      assert.ifError(result.error);
      assert.equal(result.status === 0, scenario === 'success', result.stdout + result.stderr);
      if (scenario === 'install-noop') assert.match(result.stderr, /SDK installation missing/);
      if (scenario === 'build-noop') assert.match(result.stderr, /nonempty index.js missing/);
      if (scenario === 'success') assert.match(result.stdout, /ADVISORY/);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
}
