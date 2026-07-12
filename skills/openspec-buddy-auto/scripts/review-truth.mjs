#!/usr/bin/env node

export const reviewProbeStates = new Set([
  'waiting',
  'changed',
  'review_returned',
  'head_changed',
  'request_missing',
  'retry_due',
  'retry_expired',
  'unknown',
]);

export const reviewRequestStates = new Set([
  'present-current-head',
  'missing-current-head',
  'present-old-head',
  'unknown',
  '',
]);

export const threadStates = new Set([
  'unknown',
  'clear',
  'unresolved',
  'actionable',
]);

export const responseOutcomes = new Set([
  'unknown',
  'pending',
  'clear',
  'actionable',
  'unavailable',
]);

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function normalizeReviewTruth(input = {}) {
  const probeState = reviewProbeStates.has(String(input.probeState || ''))
    ? String(input.probeState || '')
    : 'unknown';
  const requestState = reviewRequestStates.has(String(input.requestState || ''))
    ? String(input.requestState || '')
    : 'unknown';
  const threadState = threadStates.has(String(input.threadState || ''))
    ? String(input.threadState || '')
    : 'unknown';
  const actionableState = threadStates.has(String(input.actionableState || ''))
    ? String(input.actionableState || '')
    : threadState;
  const responseOutcome = responseOutcomes.has(String(input.responseOutcome || ''))
    ? String(input.responseOutcome || '')
    : 'unknown';
  return {
    pr: String(input.pr || ''),
    head: String(input.head || ''),
    probeState: probeState || 'unknown',
    requestState: requestState || 'unknown',
    actionableState: actionableState || 'unknown',
    threadState: threadState || 'unknown',
    restFreshAt: String(input.restFreshAt || ''),
    threadsFreshAt: String(input.threadsFreshAt || ''),
    threadsHead: String(input.threadsHead || ''),
    signature: String(input.signature || ''),
    responseOutcome,
    reviewRequestId: String(input.reviewRequestId || ''),
    reviewResponseId: String(input.reviewResponseId || ''),
    reviewResponseAt: String(input.reviewResponseAt || ''),
    reviewResponseUrl: String(input.reviewResponseUrl || ''),
  };
}

export function classifyProbe(probe = {}, { previousHead = '', previousSignature = '', clock } = {}) {
  const head = String(probe.head || probe.headRefOid || '');
  const signature = String(probe.signature || '');
  let probeState = String(probe.state || probe.probeState || '').trim();
  const requestState = String(probe.requestState || '').trim() || 'unknown';

  if (head && previousHead && head !== String(previousHead)) {
    probeState = 'head_changed';
  } else if (!probeState) {
    probeState = signature && previousSignature && signature !== String(previousSignature)
      ? 'changed'
      : 'waiting';
  } else if (probeState === 'request_missing') {
    probeState = 'request_missing';
  } else if (probeState === 'waiting' && requestState === 'missing-current-head') {
    probeState = 'request_missing';
  }

  if (probe.retryExpired === true && probeState === 'waiting') probeState = 'retry_expired';
  else if (probe.retryDue === true && probeState === 'waiting') probeState = 'retry_due';

  return normalizeReviewTruth({
    pr: probe.pr,
    head,
    signature,
    probeState,
    requestState,
    responseOutcome: probe.responseOutcome,
    reviewRequestId: probe.reviewRequestId,
    reviewResponseId: probe.reviewResponseId,
    reviewResponseAt: probe.reviewResponseAt,
    reviewResponseUrl: probe.reviewResponseUrl,
    restFreshAt: nowIso(clock),
  });
}

export function mergeReviewTruth(existing = {}, patch = {}) {
  const current = normalizeReviewTruth(existing);
  const normalizedPatch = normalizeReviewTruth(patch);
  const threadPatchIsFresh = Boolean(normalizedPatch.threadsFreshAt || normalizedPatch.threadsHead || normalizedPatch.threadState !== 'unknown');
  const headChanged = Boolean(patch.head && String(patch.head) !== current.head);
  const requestChanged = Object.hasOwn(patch, 'reviewRequestId')
    && String(patch.reviewRequestId || '') !== current.reviewRequestId;
  const responseInvalidated = headChanged || requestChanged;
  const next = normalizeReviewTruth({
    ...current,
    ...patch,
    ...(!threadPatchIsFresh ? {
      threadState: current.threadState,
      actionableState: current.actionableState,
      threadsFreshAt: current.threadsFreshAt,
      threadsHead: current.threadsHead,
    } : {}),
    ...(responseInvalidated ? {
      responseOutcome: 'unknown',
      reviewRequestId: '',
      reviewResponseId: '',
      reviewResponseAt: '',
      reviewResponseUrl: '',
    } : {}),
  });
  if (next.head && current.threadsHead && current.threadsHead !== next.head && !patch.threadsHead) {
    next.threadState = 'unknown';
    next.actionableState = 'unknown';
    next.threadsFreshAt = '';
    next.threadsHead = '';
  }
  return next;
}

export function threadCacheFreshForHead(truth = {}, head = '') {
  const normalized = normalizeReviewTruth(truth);
  return Boolean(
    normalized.threadsFreshAt
    && normalized.threadsHead
    && String(normalized.threadsHead) === String(head || normalized.head || '')
    && normalized.threadState !== 'unknown'
  );
}

export function signatureHasReviewActivity(signature = '') {
  try {
    const parsed = JSON.parse(String(signature || '{}'));
    return Number(parsed.reviews || 0) > 0
      || Number(parsed.reviewComments || 0) > 0
      || Boolean(parsed.latestReviewSubmittedAt);
  } catch {
    return false;
  }
}

export function laneReviewTruth(lane = {}) {
  return normalizeReviewTruth({
    pr: lane.pr,
    head: lane.head,
    probeState: lane.probeState || lane.lastResult || '',
    requestState: lane.lastRequestState || lane.requestState || '',
    actionableState: lane.actionableState || '',
    threadState: lane.threadState || '',
    restFreshAt: lane.restFreshAt || lane.lastProbeAt || '',
    threadsFreshAt: lane.threadsFreshAt || '',
    threadsHead: lane.threadsHead || '',
    signature: lane.lastSignature || lane.signature || '',
    responseOutcome: lane.responseOutcome || '',
    reviewRequestId: lane.reviewRequestId || '',
    reviewResponseId: lane.reviewResponseId || '',
    reviewResponseAt: lane.reviewResponseAt || '',
    reviewResponseUrl: lane.reviewResponseUrl || '',
  });
}

export function applyReviewTruthToLane(lane, truth = {}, { updatedAt = nowIso() } = {}) {
  const normalized = normalizeReviewTruth(truth);
  lane.head = normalized.head || lane.head || '';
  lane.lastSignature = normalized.signature || lane.lastSignature || '';
  lane.lastRequestState = normalized.requestState || lane.lastRequestState || '';
  lane.lastResult = normalized.probeState || lane.lastResult || '';
  lane.probeState = normalized.probeState || '';
  lane.requestState = normalized.requestState || '';
  lane.actionableState = normalized.actionableState || '';
  lane.threadState = normalized.threadState || '';
  lane.restFreshAt = normalized.restFreshAt || lane.restFreshAt || '';
  lane.threadsFreshAt = normalized.threadsFreshAt || lane.threadsFreshAt || '';
  lane.threadsHead = normalized.threadsHead || lane.threadsHead || '';
  lane.responseOutcome = normalized.responseOutcome || 'unknown';
  lane.reviewRequestId = normalized.reviewRequestId || '';
  lane.reviewResponseId = normalized.reviewResponseId || '';
  lane.reviewResponseAt = normalized.reviewResponseAt || '';
  lane.reviewResponseUrl = normalized.reviewResponseUrl || '';
  lane.updatedAt = updatedAt;
  return lane;
}

export function laneWaitingWithCurrentHead(lane = {}) {
  const truth = laneReviewTruth(lane);
  return lane.stage === 'waiting_review'
    && truth.requestState === 'present-current-head'
    && truth.probeState === 'waiting'
    && Boolean(lane.head);
}
