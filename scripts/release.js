#!/usr/bin/env node

/**
 * Release script for solo-callme
 *
 * Bumps version in both root and server package.json files,
 * commits the changes, creates a git tag, and pushes to GitHub.
 *
 * Usage: node scripts/release.js [patch|minor|major]
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { startReleaseOnMain } from './lib/release-branch.cjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function readPackageJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePackageJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function exec(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    return execSync(cmd, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options
    });
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

function main() {
  const bumpType = process.argv[2] || 'patch';

  if (!['patch', 'minor', 'major'].includes(bumpType)) {
    console.error('Usage: node scripts/release.js [patch|minor|major]');
    process.exit(1);
  }

  startReleaseOnMain(rootDir, 'scripts/release.js');

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --', { cwd: rootDir });
  } catch {
    console.error('Error: You have uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  // Read current versions
  const rootPkgPath = join(rootDir, 'package.json');
  const serverPkgPath = join(rootDir, 'server', 'package.json');

  const rootPkg = readPackageJson(rootPkgPath);
  const serverPkg = readPackageJson(serverPkgPath);

  const currentVersion = serverPkg.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\nBumping version: ${currentVersion} -> ${newVersion} (${bumpType})\n`);

  // Update both package.json files
  rootPkg.version = newVersion;
  serverPkg.version = newVersion;

  writePackageJson(rootPkgPath, rootPkg);
  console.log(`Updated ${rootPkgPath}`);

  writePackageJson(serverPkgPath, serverPkg);
  console.log(`Updated ${serverPkgPath}`);

  // Git operations
  console.log('\nCommitting changes...');
  exec('git add package.json server/package.json');
  exec(`git commit -m "chore: bump version to ${newVersion}"`);

  console.log('\nCreating tag...');
  exec(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

  console.log('\nPushing to GitHub...');
  exec('git push');
  exec('git push --tags');

  console.log(`\n✓ Released v${newVersion}`);
  console.log(`\nGitHub Actions will now:`);
  console.log(`  1. Publish solo-callme@${newVersion} to npm`);
  console.log(`  2. Create GitHub Release v${newVersion}`);
  console.log(`  3. Build and push Docker image`);
}

main();
