#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readLaneState } from './lane-state.mjs';
import {
  defaultReviewTruthMaxAgeSeconds,
  laneReviewTruth,
  normalizeReviewTruth,
  threadCacheFreshForHead,
} from './review-truth.mjs';
import { writeControllerState } from './controller-state.mjs';

function defaultGitDirty(cwd = process.cwd()) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return true;
  return Boolean(String(result.stdout || '').trim());
}

function samePrHead(record = {}, lane = {}) {
  const recordPr = String(record.pr || '');
  const recordHead = String(record.head || '');
  if (recordPr && lane.pr && recordPr !== String(lane.pr)) return false;
  if (recordHead && lane.head && recordHead !== String(lane.head)) return false;
  return Boolean(lane.pr || lane.head);
}

function findLane(laneState, state) {
  const laneId = String(state.interrupt?.lane || '');
  const pr = String(state.reviewFix?.pr || state.interrupt?.pr || state.target?.pr || '');
  const issue = String(state.interrupt?.issue || state.target?.issue || '');
  const head = String(state.reviewFix?.head || state.interrupt?.head || '');
  if (!laneId && !pr && !issue && !head) return null;
  return (laneState.lanes || []).find((lane) => {
    if (laneId && String(lane.id || '') !== laneId) return false;
    if (pr && String(lane.pr || '') !== pr) return false;
    if (!pr && issue && String(lane.issue || '') !== issue) return false;
    if (head && String(lane.head || '') !== head) return false;
    return true;
  }) || null;
}

export function canClearReviewInterrupt({
  state,
  lane,
  dirty = false,
  allowCachedRestTruth = false,
  freshTruth = null,
  now = Date.now(),
  maxAgeSeconds = defaultReviewTruthMaxAgeSeconds,
  runId = '',
} = {}) {
  void allowCachedRestTruth;
  if (!state || !lane || dirty) return false;
  const persistedTruth = laneReviewTruth(lane);
  const truth = normalizeReviewTruth(freshTruth || {});
  if (
    persistedTruth.threadState === 'actionable'
    || persistedTruth.threadState === 'unresolved'
    || persistedTruth.actionableState === 'actionable'
    || truth.threadState === 'actionable'
    || truth.threadState === 'unresolved'
    || truth.actionableState === 'actionable'
  ) {
    return false;
  }
  const sameReviewFix = state.reviewFix?.pending ? samePrHead(state.reviewFix, lane) : true;
  const sameInterrupt = state.interrupt ? samePrHead(state.interrupt, lane) : true;
  if (!sameReviewFix || !sameInterrupt) return false;
  if (!freshTruth) return false;
  if (truth.pr && lane.pr && truth.pr !== String(lane.pr)) return false;
  if (threadCacheFreshForHead(truth, lane.head, {
    now,
    maxAgeSeconds,
    runId: runId || truth.runId,
  }) && truth.threadState === 'clear') return true;
  return false;
}

function interruptIsReviewWait(interrupt = {}) {
  if (!interrupt) return false;
  return ['waiting_review', 'request_missing', 'review-fix', 'review_fix'].includes(String(interrupt.stage || ''))
    || String(interrupt.blockedCode || '') === 'request_missing';
}

export function reconcileControllerState(state, {
  cwd = process.cwd(),
  laneState = null,
  dirty = defaultGitDirty(cwd),
  allowCachedRestTruth = false,
  freshTruth = null,
  now = Date.now(),
  maxAgeSeconds = defaultReviewTruthMaxAgeSeconds,
  runId = '',
  writeState = (next) => writeControllerState(next, { cwd }),
} = {}) {
  if (!state.reviewFix?.pending && !interruptIsReviewWait(state.interrupt)) {
    return { changed: false, state, reason: 'no review interrupt' };
  }
  const lanes = laneState || readLaneState({ cwd, maxLanes: state.maxLanes || 1 });
  const lane = findLane(lanes, state);
  if (!canClearReviewInterrupt({
    state,
    lane,
    dirty,
    allowCachedRestTruth,
    freshTruth,
    now,
    maxAgeSeconds,
    runId,
  })) {
    return {
      changed: false,
      state,
      lane,
      reason: freshTruth ? 'truth not sufficient' : 'fresh live review truth not supplied',
    };
  }
  const next = {
    ...state,
    reviewFix: { pending: false, head: '', pr: '', evidence: '' },
    interrupt: interruptIsReviewWait(state.interrupt) ? null : state.interrupt,
  };
  const written = writeState(next);
  return { changed: true, state: written, lane, reason: 'stale review interrupt cleared' };
}
