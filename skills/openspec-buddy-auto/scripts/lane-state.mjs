#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const allowedLaneStages = new Set([
  'claiming',
  'implementing',
  'pr_opened',
  'review_requested',
  'waiting_review',
  'review_returned',
  'review_fix',
  'merge_ready',
  'achieving',
  'done',
  'blocked',
  'retryable_blocked',
]);

export const blockedLikeStages = new Set(['blocked', 'retryable_blocked']);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

export function gitRoot(cwd = process.cwd()) {
  return run('git', ['rev-parse', '--show-toplevel'], { cwd }) || cwd;
}

function worktreeConfig(key, cwd = process.cwd()) {
  return run('git', ['config', '--worktree', key], { cwd });
}

export function normalizeMaxLanes(value = process.env.OPENSPEC_BUDDY_AUTO_LANES || '2') {
  const maxLanes = Number(value || 2);
  if (!Number.isInteger(maxLanes) || maxLanes < 1 || maxLanes > 3) {
    throw new Error('OPENSPEC_BUDDY_AUTO_LANES must be an integer from 1 to 3.');
  }
  return maxLanes;
}

export function worktreeInfo(cwd = process.cwd()) {
  const root = fs.realpathSync(gitRoot(cwd));
  const alias = worktreeConfig('buddy.worktreeAlias', cwd);
  const boundBranch = worktreeConfig('buddy.boundBranch', cwd);
  const boundBase = worktreeConfig('buddy.boundBase', cwd);
  const pathHash = crypto.createHash('sha256').update(root).digest('hex').slice(0, 16);
  return {
    path: root,
    alias,
    pathHash,
    boundBranch,
    boundBase,
  };
}

export function worktreeKey(info = worktreeInfo()) {
  const value = info.alias || info.pathHash || info.path;
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '-');
}

export function laneStateDir(cwd = process.cwd()) {
  if (process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR) {
    return process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
  }
  return path.join(gitRoot(cwd), 'openspec/.buddy-cache/auto-lanes');
}

export function laneStatePath(cwd = process.cwd()) {
  const info = worktreeInfo(cwd);
  return path.join(laneStateDir(cwd), `${worktreeKey(info)}.json`);
}

export function laneLockDir(cwd = process.cwd()) {
  const info = worktreeInfo(cwd);
  return path.join(laneStateDir(cwd), `${worktreeKey(info)}.lock.d`);
}

function pidAlive(pid) {
  const number = Number(pid);
  if (!Number.isInteger(number) || number <= 0) return false;
  try {
    process.kill(number, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLaneLock({ cwd = process.cwd(), staleSeconds = process.env.OPENSPEC_BUDDY_AUTO_LANE_LOCK_STALE_SECONDS || '7200' } = {}) {
  const lockDir = laneLockDir(cwd);
  const ownerCandidate = `${lockDir}.owner-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
  const staleMs = Number(staleSeconds) * 1000;
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    throw new Error('OPENSPEC_BUDDY_AUTO_LANE_LOCK_STALE_SECONDS must be a non-negative integer.');
  }
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  const owner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    host: os.hostname(),
  };

  function claimFreshLock() {
    fs.rmSync(ownerCandidate, { force: true });
    fs.writeFileSync(ownerCandidate, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.symlinkSync(ownerCandidate, lockDir);
      return { lockDir, release: () => releaseLaneLock(lockDir, ownerCandidate) };
    } catch (error) {
      fs.rmSync(ownerCandidate, { force: true });
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
      return null;
    }
  }

  const claimed = claimFreshLock();
  if (claimed) return claimed;

  const lockIsSymlink = fs.lstatSync(lockDir).isSymbolicLink();
  const ownerFile = lockIsSymlink ? fs.readlinkSync(lockDir) : path.join(lockDir, 'owner.json');
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  } catch {
    existing = {};
  }
  const detail = existing.pid ? `pid ${existing.pid}` : 'unknown owner';
  const lockStat = fs.statSync(lockDir);
  const lockAgeMs = Date.now() - lockStat.mtimeMs;
  if (!existing.pid || !existing.startedAt) {
    if (lockAgeMs > staleMs) {
      const staleDir = `${lockDir}.stale-${process.pid}-${Date.now()}`;
      try {
        if (lockIsSymlink) {
          fs.unlinkSync(lockDir);
        } else {
          fs.renameSync(lockDir, staleDir);
        }
      } catch {
        const error = new Error(`lane-driver-already-running (${detail})`);
        error.code = 'LANE_LOCKED';
        throw error;
      }
      const recovered = claimFreshLock();
      if (!lockIsSymlink) fs.rmSync(staleDir, { recursive: true, force: true });
      if (recovered) return recovered;
    }
    const error = new Error(`lane-driver-already-running (${detail})`);
    error.code = 'LANE_LOCKED';
    throw error;
  }
  const startedAt = Date.parse(existing.startedAt || '');
  const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
  if (!pidAlive(existing.pid) && ageMs > staleMs) {
    const staleDir = `${lockDir}.stale-${process.pid}-${Date.now()}`;
    try {
      if (lockIsSymlink) {
        fs.unlinkSync(lockDir);
      } else {
        fs.renameSync(lockDir, staleDir);
      }
    } catch (renameError) {
      const error = new Error(`lane-driver-already-running (${detail})`);
      error.code = 'LANE_LOCKED';
      throw error;
    }
    const recovered = claimFreshLock();
    if (!lockIsSymlink) fs.rmSync(staleDir, { recursive: true, force: true });
    if (recovered) return recovered;
    const error = new Error(`lane-driver-already-running (${detail})`);
    error.code = 'LANE_LOCKED';
    throw error;
  }

  const error = new Error(`lane-driver-already-running (${detail})`);
  error.code = 'LANE_LOCKED';
  throw error;
}

export function releaseLaneLock(lockDir, ownerFile = '') {
  if (!lockDir) return;
  fs.rmSync(lockDir, { recursive: true, force: true });
  if (ownerFile) fs.rmSync(ownerFile, { force: true });
}

export function emptyLaneState({ cwd = process.cwd(), maxLanes = normalizeMaxLanes() } = {}) {
  return {
    version: 1,
    worktree: worktreeInfo(cwd),
    maxLanes,
    lanes: [],
  };
}

export function normalizeLane(lane) {
  const normalized = {
    id: String(lane.id || (lane.issue ? `issue-${lane.issue}` : lane.pr ? `pr-${lane.pr}` : '')),
    issue: String(lane.issue || ''),
    change: String(lane.change || ''),
    branch: String(lane.branch || ''),
    pr: String(lane.pr || ''),
    head: String(lane.head || ''),
    stage: String(lane.stage || ''),
    claimId: String(lane.claimId || ''),
    reviewRequestedAt: String(lane.reviewRequestedAt || ''),
    reviewRetryCount: Number(lane.reviewRetryCount || 0),
    lastProbeAt: String(lane.lastProbeAt || ''),
    lastSignature: String(lane.lastSignature || ''),
    lastRequestState: String(lane.lastRequestState || ''),
    lastResult: String(lane.lastResult || ''),
    blockedReason: String(lane.blockedReason || ''),
    retryableSince: String(lane.retryableSince || ''),
    retryAttempts: Number(lane.retryAttempts || 0),
    updatedAt: String(lane.updatedAt || ''),
  };
  if (!normalized.id) throw new Error('Lane is missing id.');
  if (!allowedLaneStages.has(normalized.stage)) {
    throw new Error(`Lane ${normalized.id} has invalid stage: ${normalized.stage}`);
  }
  if (!Number.isInteger(normalized.reviewRetryCount) || normalized.reviewRetryCount < 0) {
    throw new Error(`Lane ${normalized.id} has invalid reviewRetryCount.`);
  }
  if (!Number.isInteger(normalized.retryAttempts) || normalized.retryAttempts < 0) {
    throw new Error(`Lane ${normalized.id} has invalid retryAttempts.`);
  }
  return normalized;
}

export function normalizeLaneState(state, { cwd = process.cwd(), maxLanes = normalizeMaxLanes() } = {}) {
  const lanes = (state.lanes || []).map(normalizeLane);
  return {
    version: 1,
    worktree: state.worktree || worktreeInfo(cwd),
    maxLanes: normalizeMaxLanes(String(state.maxLanes || maxLanes)),
    lanes,
  };
}

export function readLaneState({ cwd = process.cwd(), maxLanes = normalizeMaxLanes() } = {}) {
  const file = laneStatePath(cwd);
  if (!fs.existsSync(file)) return emptyLaneState({ cwd, maxLanes });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normalizeLaneState(raw, { cwd, maxLanes });
}

export function writeLaneState(state, { cwd = process.cwd() } = {}) {
  const file = laneStatePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalizeLaneState(state, { cwd, maxLanes: state.maxLanes }), null, 2)}\n`);
}

export function activeLaneIssues(state) {
  return selectorExcludedIssues(state);
}

export function laneReservesCapacity(lane) {
  if (!lane || lane.stage === 'done') return false;
  if (blockedLikeStages.has(lane.stage)) {
    return Boolean(lane.issue || lane.pr || lane.branch || lane.claimId);
  }
  return true;
}

export function reservedLaneCount(state) {
  return state.lanes.filter(laneReservesCapacity).length;
}

export function selectorExcludedIssues(state) {
  return state.lanes
    .filter((lane) => lane.stage !== 'done')
    .map((lane) => String(lane.issue || ''))
    .filter(Boolean);
}

export function laneNeedsReconciliation(lane) {
  if (!lane || lane.stage === 'done') return false;
  return lane.stage === 'retryable_blocked'
    || (lane.stage === 'blocked' && Boolean(lane.issue || lane.pr || lane.branch || lane.claimId));
}

export function laneBlocksGoalCompletion(lane) {
  return laneReservesCapacity(lane) && blockedLikeStages.has(lane.stage);
}

export function pruneDoneLanes(state) {
  return {
    ...state,
    lanes: state.lanes.filter((lane) => lane.stage !== 'done'),
  };
}

function main() {
  const command = process.argv[2] || '';
  if (command === '--help' || command === '-h' || !command) {
    console.log('Usage: lane-state.mjs <info|lock-check|read>');
    return;
  }
  if (command === 'info') {
    console.log(JSON.stringify({ statePath: laneStatePath(), lockDir: laneLockDir(), worktree: worktreeInfo() }, null, 2));
    return;
  }
  if (command === 'read') {
    console.log(JSON.stringify(readLaneState(), null, 2));
    return;
  }
  if (command === 'lock-check') {
    const lock = acquireLaneLock();
    lock.release();
    console.log('ok');
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === currentFile) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === 'LANE_LOCKED' ? 75 : 1);
  }
}
