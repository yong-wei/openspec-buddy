#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyReviewTruthToLane, classifyProbe } from './review-truth.mjs';
import { writeLaneState } from './lane-state.mjs';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(autoScriptDir, '../../../openspec-buddy/scripts');

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function text(result = {}) {
  return [result.stdout || '', result.stderr || ''].join('\n').trim();
}

function currentBranch(runSync, cwd) {
  const result = runSync('git', ['branch', '--show-current'], { cwd });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function structuredBlocked(lane, reason, extra = {}) {
  return {
    status: 'blocked',
    lane: lane.id || '',
    issue: lane.issue || '',
    pr: lane.pr || '',
    branch: lane.branch || '',
    head: lane.head || '',
    reason,
    ...extra,
  };
}

function refreshPrTruth(runSync, lane, cwd) {
  if (!lane.pr) return null;
  const result = runSync('gh', ['pr', 'view', String(lane.pr), '--json', 'number,headRefOid,headRefName,state'], { cwd });
  if (result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout || '{}');
    return classifyProbe({
      pr: String(data.number || lane.pr || ''),
      head: String(data.headRefOid || lane.head || ''),
      signature: '',
      requestState: lane.lastRequestState || lane.requestState || 'unknown',
      state: 'waiting',
    }, { previousHead: lane.head || '', previousSignature: lane.lastSignature || '' });
  } catch {
    return null;
  }
}

function liveClaimGate(runSync, lane, coreScriptDir, cwd) {
  if (!lane.issue) return null;
  const helper = path.join(coreScriptDir, 'read-live-claim-truth.sh');
  if (!fs.existsSync(helper)) return null;
  const result = runSync(helper, [String(lane.issue), '--json'], { cwd });
  if (result.status !== 0) {
    return structuredBlocked(lane, text(result) || 'live claim truth probe failed', {
      currentBranch: currentBranch(runSync, cwd),
      source: 'live-claim',
    });
  }
  let truth;
  try {
    truth = JSON.parse(result.stdout || '{}');
  } catch {
    return structuredBlocked(lane, 'live claim truth probe returned invalid JSON', {
      currentBranch: currentBranch(runSync, cwd),
      source: 'live-claim',
    });
  }
  if (truth.status === 'owned' && truth.source === 'github-rest') return null;
  return structuredBlocked(lane, truth.reason || `live claim status is ${truth.status || 'invalid'}`, {
    currentBranch: currentBranch(runSync, cwd),
    source: truth.status === 'foreign' ? 'foreign-claim' : 'stale-claim',
  });
}

export function runLaneAction(state, lane, actionSpec, options = {}) {
  const cwd = options.cwd || process.cwd();
  const runSync = options.runSync || defaultRun;
  const coreScriptDir = options.coreScriptDir || process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;
  const writeState = options.writeState || ((nextState) => writeLaneState(nextState, { cwd }));
  const helper = actionSpec?.command || '';
  const helperArgs = (actionSpec?.args || []).map(String);

  const dirty = runSync('git', ['status', '--porcelain'], { cwd });
  if (dirty.status !== 0) return structuredBlocked(lane, text(dirty) || 'git status failed', { currentBranch: currentBranch(runSync, cwd) });
  if (String(dirty.stdout || '').trim()) {
    return structuredBlocked(lane, 'worktree is dirty', { currentBranch: currentBranch(runSync, cwd) });
  }

  const switched = runSync('git', ['switch', String(lane.branch || '')], { cwd });
  if (switched.status !== 0) return structuredBlocked(lane, text(switched) || 'git switch failed', { currentBranch: currentBranch(runSync, cwd) });

  const claimGate = liveClaimGate(runSync, lane, coreScriptDir, cwd);
  if (claimGate) return claimGate;

  const guardArgs = ['--issue', String(lane.issue || '')];
  if (lane.pr) guardArgs.push('--pr', String(lane.pr));
  const guard = runSync(path.join(coreScriptDir, 'verify-claim-worktree.sh'), guardArgs, { cwd });
  if (guard.status !== 0) return structuredBlocked(lane, text(guard) || 'verify-claim-worktree.sh failed', { currentBranch: currentBranch(runSync, cwd) });

  const helperResult = runSync(helper, helperArgs, { cwd, env: actionSpec.env || {} });
  if (helperResult.status !== 0) {
    return structuredBlocked(lane, text(helperResult) || `${helper} failed`, {
      currentBranch: currentBranch(runSync, cwd),
      helper,
    });
  }

  const persistedLane = state.lanes.find((candidate) => candidate.id === lane.id) || lane;
  Object.assign(persistedLane, lane, actionSpec.patch || {}, {
    updatedAt: new Date().toISOString(),
  });
  const truth = options.refreshTruth === false ? null : refreshPrTruth(runSync, persistedLane, cwd);
  if (truth) applyReviewTruthToLane(persistedLane, truth);
  writeState(state);

  return {
    status: 'ok',
    lane: persistedLane.id || '',
    issue: persistedLane.issue || '',
    pr: persistedLane.pr || '',
    branch: persistedLane.branch || '',
    head: persistedLane.head || '',
    stdout: helperResult.stdout || '',
    stderr: helperResult.stderr || '',
  };
}
