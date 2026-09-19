const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { test } = require("node:test");

const sourceRoot = resolve(__dirname, "../..");
const git = (cwd, ...args) => execFileSync("git", args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "solo-release-branch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const seed = join(directory, "seed");
  const remote = join(directory, "origin.git");
  const checkout = join(directory, "checkout");
  const hooks = join(directory, "hooks");
  mkdirSync(hooks);
  mkdirSync(seed);
  git(seed, "init", "-b", "main");
  const configure = (repo) => {
    for (const [key, value] of Object.entries({
      "user.name": "Release test", "user.email": "release@example.invalid",
      "commit.gpgsign": "false", "tag.gpgsign": "false", "core.hooksPath": hooks,
      "pull.rebase": "true", "rebase.autoStash": "true", "merge.autoStash": "true",
    })) git(repo, "config", key, value);
  };
  configure(seed);
  cpSync(join(sourceRoot, "scripts/lib/release-branch.cjs"), join(seed, "release-branch.cjs"));
  // This subprocess exercises the real bootstrap and Git without any publish code.
  writeFileSync(join(seed, "release.cjs"), [
    'const { startReleaseOnMain } = require("./release-branch.cjs");',
    'startReleaseOnMain(__dirname, "release.cjs", { skip: process.argv.includes("--dry-run"), allowDirtyOnMain: process.argv.includes("--allow-dirty") });',
    'console.log("CURRENT_VERSION=" + require("./package.json").version);',
    'console.log("ARGS=" + JSON.stringify(process.argv.slice(2)));',
    'process.exit(process.argv.includes("--fail-release") ? 23 : 0);',
  ].join("\n"));
  const version = (repo, value) => writeFileSync(join(repo, "package.json"), JSON.stringify({version:value}) + "\n");
  const commit = (repo, message) => {
    git(repo, "add", ".");
    git(repo, "commit", "-m", message);
    return git(repo, "rev-parse", "HEAD");
  };
  version(seed, "0.1.5");
  commit(seed, "Initial fixture");
  git(directory, "clone", "--bare", seed, remote);
  git(seed, "remote", "add", "origin", remote);
  git(directory, "clone", remote, checkout);
  configure(checkout);
  const advance = () => {
    version(seed, "0.2.0");
    const sha = commit(seed, "Advance main");
    git(seed, "push", "origin", "main");
    return sha;
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, ["release.cjs", ...args], {
      cwd: checkout, encoding: "utf8", timeout: 20_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { directory, seed, remote, checkout, version, commit, advance, run };
}

test("switches, pulls, reloads main code and version, preserves arguments and feature commits", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  f.version(f.checkout, "8.0.0");
  const feature = f.commit(f.checkout, "Unmerged feature");
  const script = join(f.seed, "release.cjs");
  writeFileSync(script, readFileSync(script, "utf8").replace('console.log("CURRENT_VERSION=', 'console.log("UPDATED_ENTRYPOINT");\nconsole.log("CURRENT_VERSION='));
  const main = f.advance();
  const result = f.run("minor", "--no-push", "--detach");
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /UPDATED_ENTRYPOINT/);
  assert.match(result.output, /CURRENT_VERSION=0\.2\.0/);
  assert.match(result.output, /ARGS=\["minor","--no-push","--detach"\]/);
  assert.equal(git(f.checkout, "branch", "--show-current"), "main");
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), main);
  assert.equal(git(f.checkout, "rev-parse", "codex/feature"), feature);
  assert.equal(git(f.checkout, "status", "--porcelain"), "");
  assert.equal(git(f.checkout, "tag", "--list"), "");
});

test("pulls when already on main and propagates release failure", (t) => {
  const f = fixture(t);
  const main = f.advance();
  const result = f.run("--fail-release");
  assert.equal(result.status, 23, result.output);
  assert.match(result.output, /CURRENT_VERSION=0\.2\.0/);
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), main);
});

test("creates a missing local main with its upstream", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  git(f.checkout, "branch", "-d", "main");
  f.advance();
  const result = f.run();
  assert.equal(result.status, 0, result.output);
  assert.equal(git(f.checkout, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/main");
});

for (const state of ["modified", "staged", "untracked"]) {
  test("preserves " + state + " changes without switching or fetching", (t) => {
    const f = fixture(t);
    git(f.checkout, "switch", "-c", "codex/feature");
    const head = git(f.checkout, "rev-parse", "HEAD");
    if (state === "untracked") writeFileSync(join(f.checkout, "notes.txt"), "Keep me");
    else f.version(f.checkout, "9.0.0");
    if (state === "staged") git(f.checkout, "add", "package.json");
    const status = git(f.checkout, "status", "--porcelain");
    f.advance();
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.output, /clean working tree/);
    assert.doesNotMatch(result.output, /CURRENT_VERSION/);
    assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
    assert.equal(git(f.checkout, "status", "--porcelain"), status);
    assert.equal(git(f.checkout, "rev-parse", "origin/main"), head);
  });
}

for (const diverged of [false, true]) {
  test("preserves local-only main commits, diverged=" + diverged, (t) => {
    const f = fixture(t);
    f.version(f.checkout, "9.0.0");
    const head = f.commit(f.checkout, "Local main");
    git(f.checkout, "switch", "-c", "codex/feature");
    if (diverged) f.advance();
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.output, /main has local commits/);
    assert.equal(git(f.checkout, "rev-parse", "main"), head);
    assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
  });
}

test("does not steal main from another worktree", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  git(f.checkout, "worktree", "add", join(f.directory, "main-tree"), "main");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.output, /Could not switch to main/);
  assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
});

test("stops if origin is unavailable", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  git(f.checkout, "remote", "set-url", "origin", join(f.directory, "missing.git"));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.output, /Could not fetch origin\/main/);
  assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
});

test("preserves detached HEAD", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "--detach");
  const head = git(f.checkout, "rev-parse", "HEAD");
  assert.match(f.run().output, /detached HEAD/);
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), head);
});

test("dry runs skip Git mutations and network access", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  git(f.checkout, "remote", "set-url", "origin", join(f.directory, "missing.git"));
  f.version(f.checkout, "7.0.0");
  const status = git(f.checkout, "status", "--porcelain");
  assert.equal(f.run("--dry-run").status, 0);
  assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
  assert.equal(git(f.checkout, "status", "--porcelain"), status);
});

test("explicit pending-work compatibility applies only to synchronized main", (t) => {
  const f = fixture(t);
  f.version(f.checkout, "7.0.0");
  const status = git(f.checkout, "status", "--porcelain");
  assert.equal(f.run("--allow-dirty").status, 0);
  assert.equal(git(f.checkout, "status", "--porcelain"), status);
  const head = git(f.checkout, "rev-parse", "HEAD");
  f.advance();
  const result = f.run("--allow-dirty");
  assert.equal(result.status, 1);
  assert.match(result.output, /Commit or stash changes before pulling/);
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), head);
  assert.equal(git(f.checkout, "status", "--porcelain"), status);
});

test("pending-work compatibility never carries work across branches", (t) => {
  const f = fixture(t);
  git(f.checkout, "switch", "-c", "codex/feature");
  f.version(f.checkout, "7.0.0");
  const result = f.run("--allow-dirty");
  assert.equal(result.status, 1);
  assert.match(result.output, /Commit or stash changes before switching/);
  assert.equal(git(f.checkout, "branch", "--show-current"), "codex/feature");
});

test("the real release entrypoint prepares main before reading release inputs", () => {
  const source = readFileSync(join(sourceRoot, "scripts/release.js"), "utf8");
  const call = source.indexOf("startReleaseOnMain(");
  const inputs = source.indexOf("const rootPkg = readPackageJson(rootPkgPath);");
  assert.ok(call >= 0 && inputs > call, "branch preparation must precede release inputs");
  assert.ok(source.includes("scripts/release.js"), "restart must use this entrypoint");
});
