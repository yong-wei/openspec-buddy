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
assert.deepEqual(empty.history, []);

const state = {
  ...empty,
  lanes: [
    {
      id: 'issue-1',
      issue: '1',
      stage: 'waiting_review',
      reviewRetryCount: 0,
      probeState: 'waiting',
      requestState: 'present-current-head',
      actionableState: 'unknown',
      threadState: 'unknown',
      restFreshAt: '2026-06-30T00:00:00.000Z',
      threadsFreshAt: '',
      threadsHead: '',
    },
    { id: 'issue-2', issue: '2', stage: 'done', reviewRetryCount: 0 },
    { id: 'issue-3', issue: '3', pr: '30', branch: 'change-3', stage: 'blocked', blockedReason: 'EOF', reviewRetryCount: 0 },
    { id: 'issue-4', issue: '4', pr: '40', branch: 'change-4', stage: 'retryable_blocked', blockedReason: 'timeout', retryableSince: '2026-06-27T00:00:00.000Z', retryAttempts: 2, reviewRetryCount: 0 },
    { id: 'cleared-blocked', stage: 'blocked', blockedReason: 'operator cleared', reviewRetryCount: 0 },
  ],
};
laneState.writeLaneState(state, { cwd: repoDir });
const read = laneState.readLaneState({ cwd: repoDir, maxLanes: 2 });
assert.equal(fs.readdirSync(stateDir).some((name) => name.endsWith('.tmp')), false);
assert.equal(read.lanes.find((lane) => lane.id === 'issue-1').probeState, 'waiting');
assert.equal(read.lanes.find((lane) => lane.id === 'issue-1').requestState, 'present-current-head');
assert.equal(read.lanes.find((lane) => lane.id === 'issue-1').restFreshAt, '2026-06-30T00:00:00.000Z');
assert.deepEqual(laneState.activeLaneIssues(read), ['1', '3', '4']);
assert.deepEqual(laneState.selectorExcludedIssues(read), ['1', '3', '4']);
assert.equal(laneState.reservedLaneCount(read), 3);
assert.equal(laneState.laneReservesCapacity(read.lanes.find((lane) => lane.id === 'issue-3')), true);
assert.equal(laneState.laneReservesCapacity(read.lanes.find((lane) => lane.id === 'issue-4')), true);
assert.equal(laneState.laneReservesCapacity(read.lanes.find((lane) => lane.id === 'cleared-blocked')), false);
assert.equal(laneState.laneNeedsReconciliation(read.lanes.find((lane) => lane.id === 'issue-3')), true);
assert.equal(laneState.laneNeedsReconciliation(read.lanes.find((lane) => lane.id === 'issue-4')), true);
assert.equal(laneState.laneBlocksGoalCompletion(read.lanes.find((lane) => lane.id === 'issue-3')), true);
assert.equal(laneState.laneBlocksGoalCompletion(read.lanes.find((lane) => lane.id === 'issue-4')), true);
assert.equal(read.lanes.find((lane) => lane.id === 'issue-4').retryableSince, '2026-06-27T00:00:00.000Z');
assert.equal(read.lanes.find((lane) => lane.id === 'issue-4').retryAttempts, 2);
const pruned = laneState.pruneDoneLanes(read);
assert.equal(pruned.lanes.length, 4);
assert.equal(pruned.history.length, 1);
assert.equal(pruned.history[0].issue, '2');
assert.deepEqual(laneState.selectorExcludedIssues(pruned), ['1', '3', '4']);
assert.throws(() => laneState.normalizeLane({ id: 'bad', stage: 'retryable_blocked', retryAttempts: -1 }), /invalid retryAttempts/);

const lock = laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' });
assert.throws(() => laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' }), /lane-driver-already-running/);
lock.release();

const danglingOwnerFile = `${laneState.laneLockDir(repoDir)}.owner-missing.json`;
fs.symlinkSync(danglingOwnerFile, laneState.laneLockDir(repoDir));
const danglingSymlinkRecovered = laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' });
danglingSymlinkRecovered.release();

const originalStatSync = fs.statSync;
const lostRaceOwnerFile = `${laneState.laneLockDir(repoDir)}.owner-lost-race.json`;
const competingOwnerFile = `${laneState.laneLockDir(repoDir)}.owner-competing.json`;
fs.writeFileSync(competingOwnerFile, JSON.stringify({
  pid: process.pid,
  startedAt: new Date().toISOString(),
}));
fs.symlinkSync(lostRaceOwnerFile, laneState.laneLockDir(repoDir));
fs.statSync = (target, ...args) => {
  if (target === laneState.laneLockDir(repoDir)) {
    fs.unlinkSync(target);
    fs.symlinkSync(competingOwnerFile, target);
    const error = new Error('ENOENT');
    error.code = 'ENOENT';
    throw error;
  }
  return originalStatSync(target, ...args);
};
try {
  assert.throws(
    () => laneState.acquireLaneLock({ cwd: repoDir, staleSeconds: '7200' }),
    /lane-driver-already-running/,
  );
} finally {
  fs.statSync = originalStatSync;
}
assert.equal(fs.readlinkSync(laneState.laneLockDir(repoDir)), competingOwnerFile);
fs.unlinkSync(laneState.laneLockDir(repoDir));
fs.rmSync(competingOwnerFile, { force: true });

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
