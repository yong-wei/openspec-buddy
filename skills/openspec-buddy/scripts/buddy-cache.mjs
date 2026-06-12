#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const [, , command, ...args] = process.argv;

function usage() {
  process.stderr.write(`Usage:
  buddy-cache.mjs ensure <repo-root> [cache-dir]
  buddy-cache.mjs path <repo-root> <object-type> <key> [cache-dir]
  buddy-cache.mjs stale <file> <ttl-seconds> [repo] [object-type] [key]
  buddy-cache.mjs get <file>
  buddy-cache.mjs data <file> [repo] [object-type] [key]
  buddy-cache.mjs set <file> <source> <repo> <object-type> <key> [updated-at]
  buddy-cache.mjs merge <file> <source> <repo> <object-type> <key> [updated-at]
  buddy-cache.mjs invalidate <file>
`);
}

function defaultCacheDir(repoRoot) {
  return path.join(repoRoot, 'openspec', '.buddy-cache');
}

function resolveCacheDir(repoRoot, explicitCacheDir = '') {
  const value = explicitCacheDir || process.env.OPENSPEC_BUDDY_CACHE_DIR || process.env.OPENSPEC_BUDDY_GH_CACHE_DIR;
  return path.resolve(value || defaultCacheDir(repoRoot));
}

function ensureCacheLayout(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const subdir of ['issues', 'prs', 'relationships', 'locks']) {
    fs.mkdirSync(path.join(cacheDir, subdir), { recursive: true });
  }
}

function ensureExclude(repoRoot) {
  const gitDir = path.join(repoRoot, '.git');
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) {
    return;
  }

  const infoDir = path.join(gitDir, 'info');
  const excludeFile = path.join(infoDir, 'exclude');
  fs.mkdirSync(infoDir, { recursive: true });

  const rule = 'openspec/.buddy-cache/';
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
  const lines = current.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(rule)) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(excludeFile, `${prefix}${rule}\n`);
  }
}

function bucketFor(objectType, key) {
  switch (objectType) {
    case 'meta':
      return path.join('meta.json');
    case 'signal-state':
      return path.join('signal-state.json');
    case 'signal-payload':
      return path.join('signal-payload.json');
    case 'repo':
      return path.join('repo.json');
    case 'project':
      return path.join('project.json');
    case 'issue':
      return path.join('issues', `${key}.json`);
    case 'pr':
      return path.join('prs', `${key}.json`);
    case 'relationship':
      return path.join('relationships', `${key}.json`);
    case 'lock':
      return path.join('locks', `${key}.lock`);
    default:
      throw new Error(`Unknown cache object type: ${objectType}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempFile, file);
}

function mergeData(baseValue, patchValue) {
  if (Array.isArray(baseValue) && Array.isArray(patchValue)) {
    return patchValue;
  }
  if (
    baseValue &&
    typeof baseValue === 'object' &&
    !Array.isArray(baseValue) &&
    patchValue &&
    typeof patchValue === 'object' &&
    !Array.isArray(patchValue)
  ) {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(patchValue)) {
      merged[key] = key in baseValue ? mergeData(baseValue[key], value) : value;
    }
    return merged;
  }
  return patchValue;
}

function buildEntry(source, repo, objectType, key, data, updatedAt = '') {
  const entry = {
    fetchedAt: new Date().toISOString(),
    source,
    repo,
    objectType,
    key,
    data,
  };
  if (updatedAt) {
    entry.updatedAt = updatedAt;
  }
  return entry;
}

function cacheMatches(entry, expectedRepo = '', expectedObjectType = '', expectedKey = '') {
  if (expectedRepo && entry.repo !== expectedRepo) return false;
  if (expectedObjectType && entry.objectType !== expectedObjectType) return false;
  if (expectedKey && String(entry.key) !== String(expectedKey)) return false;
  return true;
}

function main() {
  switch (command) {
    case 'ensure': {
      const [repoRoot, explicitCacheDir = ''] = args;
      if (!repoRoot) {
        usage();
        process.exit(2);
      }
      const cacheDir = resolveCacheDir(repoRoot, explicitCacheDir);
      ensureCacheLayout(cacheDir);
      ensureExclude(repoRoot);

      const metaFile = path.join(cacheDir, 'meta.json');
      if (!fs.existsSync(metaFile)) {
        writeJsonFileAtomic(metaFile, {
          fetchedAt: new Date().toISOString(),
          source: 'local',
          repo: repoRoot,
          objectType: 'meta',
          key: 'layout',
          data: { version: 1 },
        });
      }

      process.stdout.write(`${cacheDir}\n`);
      return;
    }
    case 'path': {
      const [repoRoot, objectType, key = '', explicitCacheDir = ''] = args;
      if (!repoRoot || !objectType) {
        usage();
        process.exit(2);
      }
      const cacheDir = resolveCacheDir(repoRoot, explicitCacheDir);
      process.stdout.write(`${path.join(cacheDir, bucketFor(objectType, key))}\n`);
      return;
    }
    case 'stale': {
      const [file, ttlArg, expectedRepo = '', expectedObjectType = '', expectedKey = ''] = args;
      if (!file || ttlArg === undefined) {
        usage();
        process.exit(2);
      }
      if (process.env.OPENSPEC_BUDDY_CACHE_REFRESH === '1') {
        process.stdout.write('true\n');
        return;
      }
      if (!fs.existsSync(file)) {
        process.stdout.write('true\n');
        return;
      }
      const ttlSeconds = Number(ttlArg);
      const entry = readJson(file);
      if (!cacheMatches(entry, expectedRepo, expectedObjectType, expectedKey)) {
        process.stdout.write('true\n');
        return;
      }
      const fetchedAt = Date.parse(entry.fetchedAt || '');
      if (!Number.isFinite(fetchedAt) || !Number.isFinite(ttlSeconds)) {
        process.stdout.write('true\n');
        return;
      }
      const stale = Date.now() - fetchedAt >= ttlSeconds * 1000;
      process.stdout.write(stale ? 'true\n' : 'false\n');
      return;
    }
    case 'get': {
      const [file] = args;
      if (!file) {
        usage();
        process.exit(2);
      }
      process.stdout.write(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}\n');
      return;
    }
    case 'data': {
      const [file, expectedRepo = '', expectedObjectType = '', expectedKey = ''] = args;
      if (!file) {
        usage();
        process.exit(2);
      }
      const entry = readJson(file);
      if (!cacheMatches(entry, expectedRepo, expectedObjectType, expectedKey)) {
        process.stderr.write('Cache entry identity mismatch.\n');
        process.exit(1);
      }
      process.stdout.write(`${JSON.stringify(entry.data ?? {}, null, 2)}\n`);
      return;
    }
    case 'set': {
      const [file, source, repo, objectType, key, updatedAt = ''] = args;
      if (!file || !source || !repo || !objectType || !key) {
        usage();
        process.exit(2);
      }
      const raw = fs.readFileSync(0, 'utf8').trim();
      const data = raw ? JSON.parse(raw) : {};
      const entry = buildEntry(source, repo, objectType, key, data, updatedAt);
      writeJsonFileAtomic(file, entry);
      process.stdout.write(`${file}\n`);
      return;
    }
    case 'merge': {
      const [file, source, repo, objectType, key, updatedAt = ''] = args;
      if (!file || !source || !repo || !objectType || !key) {
        usage();
        process.exit(2);
      }
      const raw = fs.readFileSync(0, 'utf8').trim();
      const patch = raw ? JSON.parse(raw) : {};
      let existingData = {};
      if (fs.existsSync(file)) {
        existingData = readJson(file).data ?? {};
      }
      const entry = buildEntry(source, repo, objectType, key, mergeData(existingData, patch), updatedAt);
      writeJsonFileAtomic(file, entry);
      process.stdout.write(`${file}\n`);
      return;
    }
    case 'invalidate': {
      const [file] = args;
      if (!file) {
        usage();
        process.exit(2);
      }
      fs.rmSync(file, { force: true });
      return;
    }
    default:
      usage();
      process.exit(2);
  }
}

main();
