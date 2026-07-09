import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const helper = path.join(repoRoot, 'skills/openspec-buddy/scripts/review-request-state.mjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-request-state-'));

function writeJson(name, value) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
}

function state({ pr, commits, comments }) {
  return execFileSync(process.execPath, [
    helper,
    '@codex review',
    writeJson('pr.json', pr),
    writeJson('commits.json', commits),
    writeJson('comments.json', comments),
  ], { encoding: 'utf8' });
}

function stateJson({ pr, commits, comments }) {
  return JSON.parse(execFileSync(process.execPath, [
    helper,
    '--json',
    '@codex review',
    writeJson('pr-json.json', pr),
    writeJson('commits-json.json', commits),
    writeJson('comments-json.json', comments),
  ], { encoding: 'utf8' }));
}

try {
  assert.equal(state({
    pr: { head: { sha: 'head-2' } },
    commits: [{ sha: 'head-1', commit: { committer: { date: '2026-01-01T00:02:00Z' } } }],
    comments: [],
  }), 'unknown-head');

  assert.equal(state({
    pr: { head: { sha: 'head-2' } },
    commits: [{ sha: 'head-2', commit: {} }],
    comments: [],
  }), 'unknown-head');

  assert.equal(state({
    pr: { head: { sha: 'head-1' } },
    commits: [{ sha: 'head-1', commit: { committer: { date: '2026-01-01T00:02:00Z' } } }],
    comments: [{ body: '@codex review', created_at: '2026-01-01T00:03:00Z' }],
  }), 'present-current-head');

  assert.equal(state({
    pr: { head: { sha: 'head-1' } },
    commits: [{ sha: 'head-1', commit: { committer: { date: '2026-01-01T00:02:00Z' } } }],
    comments: [{ body: '@codex review', created_at: '2026-01-01T00:01:00Z' }],
  }), 'missing-current-head');

  assert.deepEqual(stateJson({
    pr: { head: { sha: 'head-1' } },
    commits: [{ sha: 'head-1', commit: { committer: { date: '2026-01-01T00:02:00Z' } } }],
    comments: [
      { body: '@codex review', created_at: '2026-01-01T00:01:00Z' },
      { body: '@codex review', created_at: '2026-01-01T00:03:00Z' },
    ],
  }), { state: 'present-current-head', requestedAt: '2026-01-01T00:03:00Z' });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('review-request-state tests passed');
