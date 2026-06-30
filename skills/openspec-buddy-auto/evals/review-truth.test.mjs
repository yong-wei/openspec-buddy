import assert from 'node:assert/strict';
import {
  applyReviewTruthToLane,
  classifyProbe,
  laneWaitingWithCurrentHead,
  mergeReviewTruth,
  threadCacheFreshForHead,
} from '../scripts/review-truth.mjs';
import { decideLaneAction } from '../scripts/auto-decision.mjs';

const clock = () => new Date('2026-06-30T00:00:00.000Z');

{
  const truth = classifyProbe({
    pr: '743',
    head: 'head-1',
    signature: 'sig-1',
    requestState: 'present-current-head',
  }, { previousHead: 'head-1', previousSignature: 'sig-1', clock });
  assert.equal(truth.probeState, 'waiting');
  assert.equal(truth.requestState, 'present-current-head');
  assert.equal(truth.restFreshAt, '2026-06-30T00:00:00.000Z');
}

{
  const truth = classifyProbe({
    pr: '743',
    head: 'head-2',
    signature: 'sig-2',
    requestState: 'present-current-head',
  }, { previousHead: 'head-1', previousSignature: 'sig-1', clock });
  assert.equal(truth.probeState, 'head_changed');
}

{
  const truth = classifyProbe({
    pr: '743',
    head: 'head-1',
    signature: 'sig-2',
    requestState: 'present-current-head',
    state: 'changed',
    retryExpired: true,
  }, { previousHead: 'head-1', previousSignature: 'sig-1', clock });
  assert.equal(truth.probeState, 'changed');
}

{
  const truth = mergeReviewTruth({
    head: 'old-head',
    threadState: 'clear',
    actionableState: 'clear',
    threadsHead: 'old-head',
    threadsFreshAt: '2026-06-30T00:00:00.000Z',
  }, {
    head: 'new-head',
    probeState: 'head_changed',
  });
  assert.equal(truth.threadState, 'unknown');
  assert.equal(truth.actionableState, 'unknown');
  assert.equal(truth.threadsFreshAt, '');
  assert.equal(threadCacheFreshForHead(truth, 'new-head'), false);
}

{
  const truth = mergeReviewTruth({
    head: 'head-1',
    probeState: 'waiting',
    requestState: 'present-current-head',
  }, {
    threadState: 'clear',
    actionableState: 'clear',
    threadsHead: 'head-1',
    threadsFreshAt: '2026-06-30T00:00:00.000Z',
  });
  assert.equal(threadCacheFreshForHead(truth, 'head-1'), true);
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  applyReviewTruthToLane(lane, {
    pr: '743',
    head: 'head-1',
    probeState: 'waiting',
    requestState: 'present-current-head',
    signature: 'sig-1',
    restFreshAt: '2026-06-30T00:00:00.000Z',
  }, { updatedAt: '2026-06-30T00:00:01.000Z' });
  assert.equal(laneWaitingWithCurrentHead(lane), true);
  assert.equal(lane.lastResult, 'waiting');
  assert.equal(lane.lastRequestState, 'present-current-head');
  assert.equal(lane.lastSignature, 'sig-1');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'waiting',
      requestState: 'present-current-head',
      signature: 'sig-1',
      restFreshAt: '2026-06-30T00:00:00.000Z',
    },
  }).action, 'keep-waiting');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'changed',
      requestState: 'present-current-head',
    },
  }).action, 'deep-check-review');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-2',
      probeState: 'head_changed',
      requestState: 'present-current-head',
    },
  }).action, 'deep-check-review');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'request_missing',
      requestState: 'missing-current-head',
    },
  }).action, 'deep-check-review');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'request_missing',
      requestState: 'missing-current-head',
      threadState: 'clear',
      actionableState: 'clear',
      threadsHead: 'head-1',
      threadsFreshAt: '2026-06-30T00:00:00.000Z',
    },
  }).action, 'request-current-head-review');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'changed',
      requestState: 'present-current-head',
      threadState: 'actionable',
      actionableState: 'actionable',
      threadsHead: 'head-1',
      threadsFreshAt: '2026-06-30T00:00:00.000Z',
    },
  }).action, 'enter-review-fix');
}

{
  const lane = { stage: 'waiting_review', pr: '743', head: 'head-1' };
  assert.equal(decideLaneAction({
    lane,
    reviewTruth: {
      pr: '743',
      head: 'head-1',
      probeState: 'review_returned',
      requestState: 'present-current-head',
      threadState: 'clear',
      actionableState: 'clear',
      threadsHead: 'head-1',
      threadsFreshAt: '2026-06-30T00:00:00.000Z',
    },
  }).action, 'enter-merge-ready');
}

{
  assert.equal(decideLaneAction({ lane: { stage: 'merge_ready' } }).action, 'enter-merge-ready');
  assert.equal(decideLaneAction({ lane: { stage: 'achieving' } }).action, 'complete-post-merge');
  assert.equal(decideLaneAction({ lane: { stage: 'blocked', blockedReason: 'needs human' } }).action, 'block');
}

console.log('review-truth tests passed');
