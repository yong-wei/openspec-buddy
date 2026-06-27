#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const moduleUrl = pathToFileURL(path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/lane-state.mjs')).href;
const laneState = await import(moduleUrl);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lane-state-'));
const binDir = path.join(tmp, 'bin');
const repoDir = path.join(tmp, 'repo');
const stateDir = path.join(tmp, 'state');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(repoDir, { recursive: true });
fs.writeFileSync(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "rev-parse" && "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "--worktree" ]]; then
  case "\${3:-}" in
    buddy.worktreeAlias) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBranch) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBase) printf 'origin/integration\\n'; exit 0 ;;
  esac
fi
exit 1
`, { mode: 0o755 });

process.env.PATH = `${binDir}:${process.env.PATH}`;
process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = stateDir;

assert.equal(laneState.normalizeMaxLanes(undefined), 2);
assert.equal(laneState.normalizeMaxLanes('3'), 3);
assert.throws(() => laneState.normalizeMaxLanes('4'), /1 to 3/);

const empty = laneState.emptyLaneState({ cwd: repoDir, maxLanes: 2 });
assert.equal(empty.worktree.alias, 'dev1');
assert.equal(empty.worktree.boundBranch, 'dev1');
assert.equal(empty.maxLanes, 2);

const state = {
  ...empty,
  lanes: [
    { id: 'issue-1', issue: '1', stage: 'waiting_review', reviewRetryCount: 0 },
    { id: 'issue-2', issue: '2', stage: 'done', reviewRetryCount: 0 },
  ],
};
laneState.writeLaneState(state, { cwd: repoDir });
const read = laneState.readLaneState({ cwd: repoDir, maxLanes: 2 });
assert.deepEqual(laneState.activeLaneIssues(read), ['1']);
assert.equal(laneState.pruneDoneLanes(read).lanes.length, 1);

const lock = laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' });
assert.throws(() => laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' }), /lane-driver-already-running/);
lock.release();

const staleLockDir = laneState.laneLockDir(repoDir);
fs.mkdirSync(staleLockDir, { recursive: true });
fs.writeFileSync(path.join(staleLockDir, 'owner.json'), JSON.stringify({
  pid: 99999999,
  startedAt: '2000-01-01T00:00:00.000Z',
}));
const recovered = laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '1' });
recovered.release();

fs.mkdirSync(staleLockDir, { recursive: true });
assert.throws(
  () => laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' }),
  /lane-driver-already-running/,
);
fs.rmSync(staleLockDir, { recursive: true, force: true });

fs.mkdirSync(staleLockDir, { recursive: true });
const emptyOwnerStat = new Date(Date.now() - 5000);
fs.utimesSync(staleLockDir, emptyOwnerStat, emptyOwnerStat);
const emptyOwnerRecovered = laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '1' });
emptyOwnerRecovered.release();

console.log('lane-state tests passed');
