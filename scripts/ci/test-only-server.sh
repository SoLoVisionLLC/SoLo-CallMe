#!/bin/sh
set -eu
# Called in a disposable non-root Bun container through env -i. No host home
# is mounted; no credentials or .env files are consumed. Do not execute index.ts.
test "$(id -u)" != 0 || { echo 'TOOLCHAIN: non-root container required' >&2; exit 1; }
task_cache="$PWD/.ci-test-cache"
mkdir -p "$task_cache/tmp" "$task_cache/bun" "$task_cache/config"
: > "$task_cache/empty.npmrc"
: > "$task_cache/empty.bunfig.toml"
export TMPDIR="$task_cache/tmp"
export XDG_CONFIG_HOME="$task_cache/config"
export NPM_CONFIG_USERCONFIG="$task_cache/empty.npmrc"
export NPM_CONFIG_GLOBALCONFIG="$task_cache/empty.npmrc"
cd server
bun install --no-env-file --config="$task_cache/empty.bunfig.toml" --ignore-scripts --cache-dir="$task_cache/bun"
test -s node_modules/@modelcontextprotocol/sdk/package.json || { echo 'DEPENDENCIES: SDK installation missing' >&2; exit 1; }
# Original Actions typecheck was advisory and has no configured tsc script.
if ! bun run --no-env-file --config="$task_cache/empty.bunfig.toml" tsc --noEmit; then
  echo 'ADVISORY: original tsc check failed; compilation below remains mandatory.'
fi
mkdir -p .ci-test-build
rm -f .ci-test-build/index.js
bun build --no-env-file --config="$task_cache/empty.bunfig.toml" src/index.ts --target=bun --outdir .ci-test-build
test -s .ci-test-build/index.js || { echo 'COMPILE: nonempty index.js missing' >&2; exit 1; }
