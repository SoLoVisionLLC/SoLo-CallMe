const { execFileSync, spawnSync } = require("node:child_process");

function prepareReleaseBranch(root, { allowDirtyOnMain = false } = {}) {
  const productionBranch = "main";
  const git = (...args) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  const check = (...args) => {
    try {
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      throw error;
    }
  };
  const assertClean = () => {
    if (git("status", "--porcelain")) {
      throw new Error("Release requires a clean working tree. Commit or stash your changes, then rerun the release command.");
    }
  };
  const dirty = git("status", "--porcelain");
  if (dirty && !allowDirtyOnMain) assertClean();
  const originalBranch = git("branch", "--show-current");
  if (!originalBranch) throw new Error("Release cannot switch from a detached HEAD. Switch to a named branch first.");
  if (dirty && originalBranch !== productionBranch) {
    throw new Error("Commit or stash changes before switching branches for release. Dirty-worktree exceptions apply only to synchronized main.");
  }
  const originalHead = git("rev-parse", "HEAD");
  const remoteRef = `refs/remotes/origin/${productionBranch}`;
  const fetchRefspec = `refs/heads/${productionBranch}:${remoteRef}`;

  console.log(`[release] Fetching origin/${productionBranch}.`);
  try {
    git("fetch", "origin", fetchRefspec);
  } catch {
    throw new Error(`Could not fetch origin/${productionBranch}. Check your connection and Git access, then retry.`);
  }
  const localBranchExists = check("show-ref", "--verify", "--quiet", `refs/heads/${productionBranch}`);
  if (localBranchExists && !check("merge-base", "--is-ancestor", `refs/heads/${productionBranch}`, remoteRef)) {
    throw new Error(`${productionBranch} has local commits that are not on origin/${productionBranch}. Reconcile them before releasing; nothing was reset or rebased.`);
  }

  if (dirty) {
    if (originalHead !== git("rev-parse", remoteRef)) {
      throw new Error("Commit or stash changes before pulling main for release. Pending work was left untouched.");
    }
    // Existing release recovery rules still validate the pending paths. Never pull over them.
    console.log("[release] main already matches origin/main; preserving pending work for the existing release checks.");
    return false;
  }

  if (originalBranch !== productionBranch) {
    console.log(`[release] Switching from ${originalBranch} to ${productionBranch}. Unmerged feature work stays on ${originalBranch}.`);
    try {
      if (localBranchExists) git("switch", productionBranch);
      else git("switch", "--create", productionBranch, "--track", `origin/${productionBranch}`);
    } catch {
      throw new Error(`Could not switch to ${productionBranch}. Check the Git error above, including whether another worktree has it open, then retry.`);
    }
  }

  console.log(`[release] Pulling origin/${productionBranch} (fast-forward only).`);
  try {
    // Explicit options override user settings that could rebase or stash local work.
    git("-c", "merge.autoStash=false", "-c", "rebase.autoStash=false", "pull", "--ff-only", "--no-rebase", "origin", fetchRefspec);
  } catch {
    throw new Error(`Could not fast-forward ${productionBranch}. Resolve the Git error above, then retry; release metadata was not created.`);
  }
  assertClean();
  if (git("branch", "--show-current") !== productionBranch || git("rev-parse", "HEAD") !== git("rev-parse", remoteRef)) {
    throw new Error(`Local ${productionBranch} must exactly match origin/${productionBranch} before releasing.`);
  }
  return originalBranch !== productionBranch || originalHead !== git("rev-parse", "HEAD");
}

function startReleaseOnMain(root, entrypoint, options = {}) {
  if (options.skip) return;
  try {
    if (!prepareReleaseBranch(root, options)) return;
    // Imports, version reads, and release policy must come from the freshly pulled code.
    const result = spawnSync(process.execPath, [entrypoint, ...process.argv.slice(2)], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Release stopped by ${result.signal}.`);
    process.exit(result.status ?? 1);
  } catch (error) {
    console.error(`[release] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { prepareReleaseBranch, startReleaseOnMain };
