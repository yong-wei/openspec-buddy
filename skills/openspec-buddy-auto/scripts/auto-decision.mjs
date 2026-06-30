#!/usr/bin/env node
import { laneReviewTruth, threadCacheFreshForHead } from './review-truth.mjs';

export const laneActions = new Set([
  'keep-waiting',
  'deep-check-review',
  'request-current-head-review',
  'enter-review-fix',
  'enter-merge-ready',
  'complete-post-merge',
  'block',
]);

function interruptMatchesLane(interrupt = {}, lane = {}) {
  if (!interrupt) return false;
  if (interrupt.pr && lane.pr && String(interrupt.pr) !== String(lane.pr)) return false;
  if (interrupt.issue && lane.issue && String(interrupt.issue) !== String(lane.issue)) return false;
  return Boolean(interrupt.stage || interrupt.blockedCode || interrupt.type);
}

export function decideLaneAction({ lane = {}, reviewTruth = null, controllerInterrupt = null } = {}) {
  const truth = reviewTruth || laneReviewTruth(lane);

  if (lane.stage === 'merge_ready') return { action: 'enter-merge-ready', reason: 'lane is merge_ready' };
  if (lane.stage === 'achieving') return { action: 'complete-post-merge', reason: 'lane is achieving' };
  if (lane.stage === 'review_returned' || lane.stage === 'review_fix') {
    return { action: 'enter-review-fix', reason: `lane stage is ${lane.stage}` };
  }
  if (lane.stage === 'blocked') return { action: 'block', reason: lane.blockedReason || 'lane is blocked' };
  if (lane.stage === 'retryable_blocked') return { action: 'deep-check-review', reason: 'retryable lane needs truth refresh' };

  if (truth.actionableState === 'actionable' || truth.threadState === 'actionable' || truth.threadState === 'unresolved') {
    return { action: 'enter-review-fix', reason: 'review thread truth is actionable' };
  }

  if (truth.threadState === 'clear' && threadCacheFreshForHead(truth, lane.head || truth.head)) {
    if (truth.requestState === 'missing-current-head' || truth.probeState === 'request_missing') {
      return { action: 'request-current-head-review', reason: 'same-head clear thread truth allows review request recovery' };
    }
    return { action: 'enter-merge-ready', reason: 'same-head thread truth is clear' };
  }

  if (interruptMatchesLane(controllerInterrupt, lane)) {
    const stage = String(controllerInterrupt.stage || '');
    if (stage === 'waiting_review' || stage === 'request_missing' || controllerInterrupt.blockedCode === 'request_missing') {
      if (truth.probeState === 'waiting' && truth.requestState === 'present-current-head') {
        return { action: 'keep-waiting', reason: 'stale request_missing interrupt superseded by fresh current-head request' };
      }
      return { action: 'deep-check-review', reason: 'request_missing interrupt needs thread truth before recovery' };
    }
  }

  if (truth.probeState === 'request_missing' || truth.requestState === 'missing-current-head') {
    return { action: 'deep-check-review', reason: 'missing current-head review request needs same-head thread truth' };
  }
  if (truth.probeState === 'changed' || truth.probeState === 'review_returned' || truth.probeState === 'head_changed') {
    return { action: 'deep-check-review', reason: `probe state ${truth.probeState} requires deep review check` };
  }
  if (truth.probeState === 'retry_due' || truth.probeState === 'retry_expired') {
    return { action: 'request-current-head-review', reason: `probe state ${truth.probeState} permits bounded retry` };
  }
  if (truth.probeState === 'waiting' && truth.requestState === 'present-current-head') {
    return { action: 'keep-waiting', reason: 'current-head request is present and signature is unchanged' };
  }
  if (lane.stage === 'waiting_review') {
    return { action: 'deep-check-review', reason: 'waiting lane lacks enough current-head truth' };
  }
  return { action: 'block', reason: `no decision rule for lane stage ${lane.stage || 'unknown'}` };
}
