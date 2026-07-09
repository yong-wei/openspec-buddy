#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  gitRoot,
  laneReservesCapacity,
  laneStatePath,
  normalizeLaneState,
  normalizeMaxLanes,
  worktreeInfo,
  worktreeKey,
} from './lane-state.mjs';

export function controllerStateDir(cwd = process.cwd()) {
  if (process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR) {
    return process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR;
  }
  return path.join(gitRoot(cwd), 'openspec/.buddy-cache/auto-controller');
}

export function controllerStatePath(cwd = process.cwd()) {
  const info = worktreeInfo(cwd);
  return path.join(controllerStateDir(cwd), `${worktreeKey(info)}.json`);
}

function emptyControllerState({ cwd = process.cwd() } = {}) {
  return {
    version: 1,
    worktree: worktreeInfo(cwd),
    mode: '',
    goal: false,
    maxLanes: 1,
    target: { issue: '', pr: '', change: '' },
    reviewFix: { pending: false, head: '', pr: '', evidence: '' },
    interrupt: null,
    updatedAt: '',
  };
}

function normalizeMode(value) {
  const mode = String(value || '').toLowerCase();
  if (!mode) return '';
  if (mode === 'single' || mode === 'multi') return mode;
  throw new Error('OPENSPEC_BUDDY_AUTO_MODE must be single or multi.');
}

function normalizeState(state, { cwd = process.cwd() } = {}) {
  return {
    version: 1,
    worktree: state.worktree || worktreeInfo(cwd),
    mode: normalizeMode(state.mode),
    goal: Boolean(state.goal),
    maxLanes: normalizeMaxLanes(String(state.maxLanes || 1)),
    target: {
      issue: String(state.target?.issue || ''),
      pr: String(state.target?.pr || ''),
      change: String(state.target?.change || ''),
    },
    reviewFix: {
      pending: Boolean(state.reviewFix?.pending),
      head: String(state.reviewFix?.head || ''),
      pr: String(state.reviewFix?.pr || ''),
      evidence: String(state.reviewFix?.evidence || ''),
    },
    interrupt: state.interrupt || null,
    updatedAt: String(state.updatedAt || ''),
  };
}

export function readControllerState({ cwd = process.cwd() } = {}) {
  const file = controllerStatePath(cwd);
  if (!fs.existsSync(file)) return emptyControllerState({ cwd });
  return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')), { cwd });
}

export function writeControllerState(state, { cwd = process.cwd() } = {}) {
  ensureBuddyCacheExcluded(cwd);
  const file = controllerStatePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
  }, { cwd });
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

function ensureBuddyCacheExcluded(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return;
  const commonDir = result.stdout.trim();
  if (!commonDir) return;
  const excludeFile = path.isAbsolute(commonDir)
    ? path.join(commonDir, 'info/exclude')
    : path.join(cwd, commonDir, 'info/exclude');
  try {
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    if (!existing.split(/\r?\n/).some((line) => line.trim() === 'openspec/.buddy-cache/')) {
      fs.appendFileSync(excludeFile, `${existing.endsWith('\n') || !existing ? '' : '\n'}openspec/.buddy-cache/\n`);
    }
  } catch {
    // Cache exclusion is a safety optimization; do not fail controller state writes.
  }
}

function legacyLaneState({ cwd = process.cwd() } = {}) {
  const file = laneStatePath(cwd);
  if (!fs.existsSync(file)) return { exists: false, active: false, maxLanes: 1, malformed: false };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const state = normalizeLaneState(raw, { cwd, maxLanes: raw.maxLanes || 2 });
    const active = state.lanes.some((lane) => laneReservesCapacity(lane));
    return { exists: true, active, maxLanes: state.maxLanes, malformed: false };
  } catch (error) {
    return { exists: true, active: false, maxLanes: 1, malformed: true, reason: error.message };
  }
}

export function initializeControllerState(seed = {}, { cwd = process.cwd() } = {}) {
  const file = controllerStatePath(cwd);
  if (fs.existsSync(file)) {
    const existing = readControllerState({ cwd });
    if (existing.interrupt || existing.reviewFix.pending) return existing;
    const requestedMode = normalizeMode(seed.mode);
    const next = { ...existing, target: { ...existing.target } };
    let changed = false;

    if (requestedMode === 'multi' && existing.mode !== 'multi') {
      next.mode = 'multi';
      next.maxLanes = normalizeMaxLanes(String(seed.maxLanes || 2));
      changed = true;
    } else if (existing.mode === 'multi' && seed.maxLanes) {
      const requestedMax = normalizeMaxLanes(String(seed.maxLanes));
      if (requestedMax > existing.maxLanes) {
        next.maxLanes = requestedMax;
        changed = true;
      }
    }

    if (seed.goal && !existing.goal) {
      next.goal = true;
      changed = true;
    }

    if (!existing.target.issue && !existing.target.pr && !existing.target.change) {
      const seededTarget = {
        issue: String(seed.issue || ''),
        pr: String(seed.pr || ''),
        change: String(seed.change || ''),
      };
      if (seededTarget.issue || seededTarget.pr || seededTarget.change) {
        next.target = seededTarget;
        changed = true;
      }
    }

    return changed ? writeControllerState(next, { cwd }) : existing;
  }

  const legacy = legacyLaneState({ cwd });
  if (legacy.malformed) {
    const error = new Error(`legacy-lane-state: ${legacy.reason}`);
    error.code = 'LEGACY_LANE_STATE';
    throw error;
  }

  const state = emptyControllerState({ cwd });
  if (legacy.active) {
    state.mode = 'multi';
    state.goal = Boolean(seed.goal);
    state.maxLanes = legacy.maxLanes;
  } else {
    state.mode = normalizeMode(seed.mode) || 'single';
    state.goal = Boolean(seed.goal);
    state.maxLanes = state.mode === 'multi'
      ? normalizeMaxLanes(String(seed.maxLanes || 2))
      : 1;
  }
  state.target = {
    issue: String(seed.issue || ''),
    pr: String(seed.pr || ''),
    change: String(seed.change || ''),
  };
  return writeControllerState(state, { cwd });
}

export function writeInterrupt(state, interrupt, { cwd = process.cwd() } = {}) {
  return writeControllerState({
    ...state,
    interrupt: {
      type: String(interrupt.type || ''),
      stage: String(interrupt.stage || ''),
      lane: String(interrupt.lane || ''),
      issue: String(interrupt.issue || ''),
      pr: String(interrupt.pr || ''),
      branch: String(interrupt.branch || ''),
      head: String(interrupt.head || ''),
      allowedWork: String(interrupt.allowedWork || ''),
      resumeAction: String(interrupt.resumeAction || 'rerun-controller'),
      child: String(interrupt.child || ''),
      blockedCode: String(interrupt.blockedCode || ''),
      reason: String(interrupt.reason || ''),
    },
  }, { cwd });
}

export function clearInterrupt(state, { cwd = process.cwd() } = {}) {
  return writeControllerState({ ...state, interrupt: null }, { cwd });
}

export function setReviewFix(state, reviewFix, { cwd = process.cwd() } = {}) {
  return writeControllerState({
    ...state,
    reviewFix: {
      pending: Boolean(reviewFix.pending),
      head: String(reviewFix.head || ''),
      pr: String(reviewFix.pr || ''),
      evidence: String(reviewFix.evidence || ''),
    },
  }, { cwd });
}

export function resetControllerState({ cwd = process.cwd() } = {}) {
  fs.rmSync(controllerStatePath(cwd), { force: true });
}

export function resetLaneState({ cwd = process.cwd(), reason = '' } = {}) {
  if (!String(reason || '').trim()) throw new Error('--reset-lane-state requires --reason.');
  ensureBuddyCacheExcluded(cwd);
  const file = laneStatePath(cwd);
  resetControllerState({ cwd });
  if (!fs.existsSync(file)) return '';
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z.-]/g, '-');
  const backup = `${file}.${stamp}.bak`;
  fs.renameSync(file, backup);
  return backup;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === currentFile) {
  try {
    const command = process.argv[2] || '';
    if (command === 'path') console.log(controllerStatePath());
    else if (command === 'read') console.log(JSON.stringify(readControllerState(), null, 2));
    else console.log('Usage: controller-state.mjs <path|read>');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
