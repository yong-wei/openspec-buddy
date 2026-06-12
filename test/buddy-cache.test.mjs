import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-cache-'));
fs.mkdirSync(path.join(repoRoot, '.git', 'info'), { recursive: true });

const helper = path.resolve('skills/openspec-buddy/scripts/buddy-cache.mjs');

const cacheDir = execFileSync('node', [helper, 'ensure', repoRoot], { encoding: 'utf8' }).trim();
assert.equal(cacheDir, path.join(repoRoot, 'openspec', '.buddy-cache'));
for (const name of ['issues', 'prs', 'relationships', 'locks']) {
  assert.equal(fs.existsSync(path.join(cacheDir, name)), true);
}

const excludeFile = path.join(repoRoot, '.git', 'info', 'exclude');
assert.match(fs.readFileSync(excludeFile, 'utf8'), /openspec\/\.buddy-cache\//);

const issuePath = execFileSync('node', [helper, 'path', repoRoot, 'issue', '123'], { encoding: 'utf8' }).trim();
assert.equal(issuePath, path.join(cacheDir, 'issues', '123.json'));

execFileSync('node', [helper, 'set', issuePath, 'rest', 'owner/repo', 'issue', '123', '2026-06-12T00:00:00Z'], {
  input: JSON.stringify({ number: 123, title: 'Demo issue' }),
});

const cachedEntry = JSON.parse(execFileSync('node', [helper, 'get', issuePath], { encoding: 'utf8' }));
assert.equal(cachedEntry.objectType, 'issue');
assert.equal(cachedEntry.key, '123');
assert.equal(cachedEntry.updatedAt, '2026-06-12T00:00:00Z');

const cachedData = JSON.parse(execFileSync('node', [helper, 'data', issuePath], { encoding: 'utf8' }));
assert.deepEqual(cachedData, { number: 123, title: 'Demo issue' });

assert.equal(
  execFileSync('node', [helper, 'stale', issuePath, '3600', 'other/repo', 'issue', '123'], { encoding: 'utf8' }).trim(),
  'true',
);
assert.throws(() => execFileSync('node', [helper, 'data', issuePath, 'other/repo', 'issue', '123'], { encoding: 'utf8' }));

assert.equal(execFileSync('node', [helper, 'stale', issuePath, '3600'], { encoding: 'utf8' }).trim(), 'false');

const staleEntry = { ...cachedEntry, fetchedAt: '2000-01-01T00:00:00.000Z' };
fs.writeFileSync(issuePath, `${JSON.stringify(staleEntry, null, 2)}\n`);
assert.equal(execFileSync('node', [helper, 'stale', issuePath, '60'], { encoding: 'utf8' }).trim(), 'true');

execFileSync('node', [helper, 'invalidate', issuePath], { encoding: 'utf8' });
assert.equal(fs.existsSync(issuePath), false);

fs.rmSync(repoRoot, { recursive: true, force: true });
