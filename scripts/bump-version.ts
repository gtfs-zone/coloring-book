#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type BumpType = 'major' | 'minor' | 'patch';

function bumpVersion(currentVersion: string, bumpType: BumpType): string {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${currentVersion}`);
  }

  let [major, minor, patch] = parts;

  switch (bumpType) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
      patch++;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

function main() {
  const bumpType: BumpType = (process.argv[2] as BumpType) || 'patch';

  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: bump-version.ts [major|minor|patch]');
    console.error('Default: patch');
    process.exit(1);
  }

  const packageJsonPath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  const currentVersion = packageJson.version;
  const newVersion = bumpVersion(currentVersion, bumpType);

  packageJson.version = newVersion;

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

  console.log(`Version bumped: ${currentVersion} -> ${newVersion} (${bumpType})`);
}

main();