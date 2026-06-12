#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const commitHelper = path.join(repoRoot, 'skills/openspec-buddy/scripts/cache-signal-commit.mjs');
const readHelper = path.join(repoRoot, 'skills/openspec-buddy/scripts/cache-signal-read.mjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-signal-test-'));

function writeJson(name, value) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

{
  const scopesFile = writeJson('scopes.json', ['issue:10', 'ready-scan', 'issue:10']);
  const payload = runNode(commitHelper, ['next', 'owner/repo', 'claim', scopesFile, '-']);
  assert.equal(payload.sequence, 1);
  assert.equal(payload.generation, 1);
  assert.deepEqual(payload.event.scopes, ['issue:10', 'ready-scan']);
  assert.equal(payload.recentEvents.length, 1);
}

{
  const previous = {
    sequence: 40,
    recentEvents: Array.from({ length: 32 }, (_, index) => ({
      sequence: index + 9,
      kind: 'set-status',
      scopes: [`issue:${index + 1}`],
    })),
  };
  const previousFile = writeJson('previous.json', previous);
  const scopesFile = writeJson('trim-scopes.json', ['issue:99']);
  const payload = runNode(commitHelper, ['next', 'owner/repo', 'claim', scopesFile, previousFile]);
  assert.equal(payload.sequence, 41);
  assert.equal(payload.recentEvents.length, 32);
  assert.equal(payload.recentEvents[0].sequence, 10);
  assert.equal(payload.recentEvents.at(-1).sequence, 41);
}

{
  const stateFile = writeJson('state.json', {
    fetchedAt: '2026-06-12T00:00:00Z',
    source: 'signal',
    repo: 'owner/repo',
    objectType: 'signal-state',
    key: 'state',
    data: { sequence: 40, tipSha: 'old-tip' },
  });
  const payloadFile = writeJson('payload.json', {
    sequence: 42,
    generation: 42,
    recentEvents: [
      { sequence: 41, kind: 'claim', scopes: ['issue:11', 'ready-scan'] },
      { sequence: 42, kind: 'set-status', scopes: ['issue:12', 'project'] },
    ],
  });
  const delta = runNode(readHelper, ['scopes', stateFile, payloadFile]);
  assert.equal(delta.conservative, false);
  assert.deepEqual(delta.scopes, ['issue:11', 'ready-scan', 'issue:12', 'project']);
}

{
  const stateFile = writeJson('gap-state.json', {
    fetchedAt: '2026-06-12T00:00:00Z',
    source: 'signal',
    repo: 'owner/repo',
    objectType: 'signal-state',
    key: 'state',
    data: { sequence: 5, tipSha: 'old-tip' },
  });
  const payloadFile = writeJson('gap-payload.json', {
    sequence: 42,
    generation: 42,
    recentEvents: [
      { sequence: 40, kind: 'claim', scopes: ['issue:40'] },
      { sequence: 41, kind: 'link-parent', scopes: ['relationship:issue:39'] },
      { sequence: 42, kind: 'set-status', scopes: ['issue:42', 'project'] },
    ],
  });
  const delta = runNode(readHelper, ['scopes', stateFile, payloadFile]);
  assert.equal(delta.conservative, true);
  assert.deepEqual(delta.scopes, ['ready-scan', 'issue:40', 'relationship:issue:39', 'issue:42', 'project']);
}

{
  const payloadFile = writeJson('state-payload.json', { sequence: 7, generation: 9 });
  const state = runNode(readHelper, ['state', 'owner/repo', 'refs/openspec-buddy/cache-signal', 'abc123', payloadFile]);
  assert.equal(state.repo, 'owner/repo');
  assert.equal(state.ref, 'refs/openspec-buddy/cache-signal');
  assert.equal(state.tipSha, 'abc123');
  assert.equal(state.sequence, 7);
  assert.equal(state.generation, 9);
  assert.ok(state.appliedAt);
}
