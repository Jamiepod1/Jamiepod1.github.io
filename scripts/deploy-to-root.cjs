#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const buildDir = path.join(repoRoot, 'my-app', 'build');
const manifestPath = path.join(repoRoot, '.deploy-manifest.json');

const toSafeSegments = (p) =>
  p
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

async function readManifest() {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.items)) {
      return parsed.items;
    }
    return [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeManifest(items) {
  const payload = {
    generatedAt: new Date().toISOString(),
    items,
  };
  await fs.writeFile(manifestPath, JSON.stringify(payload, null, 2));
}

async function ensureBuildFolder() {
  try {
    const stats = await fs.stat(buildDir);
    if (!stats.isDirectory()) {
      throw new Error(`Expected ${buildDir} to be a directory.`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Build folder not found. Make sure `npm run build:app` completed successfully.');
    }
    throw error;
  }
}

async function removePrevious(items) {
  if (!items.length) {
    return;
  }
  const targets = [...items].sort((a, b) => b.path.length - a.path.length);
  await Promise.all(
    targets.map(async ({ path: relPath }) => {
      const segments = toSafeSegments(relPath);
      const targetPath = path.resolve(repoRoot, ...segments);
      if (!targetPath.startsWith(repoRoot)) {
        throw new Error(`Refusing to delete path outside repo: ${relPath}`);
      }
      await fs.rm(targetPath, { recursive: true, force: true });
    })
  );
}

async function copyEntry(entryName) {
  const sourcePath = path.join(buildDir, entryName);
  const destinationPath = path.join(repoRoot, entryName);
  await fs.rm(destinationPath, { recursive: true, force: true });
  await fs.cp(sourcePath, destinationPath, { recursive: true });
}

async function copyBuildToRoot() {
  const entries = await fs.readdir(buildDir);
  for (const entry of entries) {
    await copyEntry(entry);
  }
}

async function listEntries(currentDir, relativeBase = '') {
  const items = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      items.push({ path: relPath, type: 'dir' });
      const children = await listEntries(fullPath, relPath);
      items.push(...children);
    } else if (entry.isFile()) {
      items.push({ path: relPath, type: 'file' });
    }
  }
  return items;
}

async function main() {
  await ensureBuildFolder();
  const previousItems = await readManifest();
  await removePrevious(previousItems);
  await copyBuildToRoot();
  const newItems = await listEntries(buildDir);
  await writeManifest(newItems);
  console.log('Deployed build output to repository root.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
