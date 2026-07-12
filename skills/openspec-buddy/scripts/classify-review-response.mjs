#!/usr/bin/env node

const unavailablePatterns = [
  /reached your Codex usage limits for code reviews/i,
  /add credits .*?(?:enable them for|continue using).*?code reviews/i,
  /code review (?:could not|can't|cannot) be (?:completed|started)/i,
  /temporarily unavailable/i,
];

const actionablePatterns = [
  /\bP[0-2]\b/i,
  /requested changes/i,
];

const clearPattern = /no actionable findings|no significant issues|no major problems|no major issues|did(?:n't| not) find any major issues|no findings|nothing actionable|没有重大问题|未发现重大问题|无重大问题|没有发现重大问题/i;
const pendingPattern = /review (?:is )?(?:queued|in progress|started)/i;

export function classifyReviewResponse(body = '') {
  const text = String(body);
  if (unavailablePatterns.some((pattern) => pattern.test(text))) return 'unavailable';
  if (actionablePatterns.some((pattern) => pattern.test(text))) return 'actionable';
  if (clearPattern.test(text)) return 'clear';
  if (pendingPattern.test(text)) return 'pending';
  return 'unknown';
}

export function eventTime(entry) {
  const value = entry?.createdAt
    || entry?.created_at
    || entry?.submittedAt
    || entry?.submitted_at
    || entry?.updatedAt
    || entry?.updated_at
    || '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function authorLogin(entry) {
  const value = entry?.author ?? entry?.user;
  if (typeof value === 'string') return value;
  return value?.login || value?.name || '';
}

function normalizeReviewerLogin(login) {
  return String(login || '').trim().toLowerCase().replace(/\[bot\]$/i, '');
}

function isConfiguredReviewer(entry, reviewer) {
  const normalizedLogin = normalizeReviewerLogin(authorLogin(entry));
  const normalizedReviewer = normalizeReviewerLogin(reviewer);
  if (!normalizedLogin || !normalizedReviewer) return false;
  if (normalizedReviewer.includes('chatgpt-codex-connector')) {
    return normalizedLogin.includes('chatgpt-codex-connector');
  }
  return normalizedLogin === normalizedReviewer;
}

function reviewCommitOid(review) {
  return review?.commit?.oid
    || review?.commit?.sha
    || review?.commit_id
    || review?.commitId
    || '';
}

function eventId(entry) {
  return entry?.id || entry?.node_id || entry?.databaseId || '';
}

function isRequest(entry, reviewRequest) {
  const body = String(entry?.body || '');
  const configured = String(reviewRequest || '').trim();
  return configured ? body.includes(configured) : /@codex\s+review\b/i.test(body);
}

function classifyReviewerEvent(entry, { headOid = '' } = {}) {
  let outcome = classifyReviewResponse(entry?.body || '');
  const state = String(entry?.state || '').toUpperCase();
  if (outcome === 'unknown' || outcome === 'pending') {
    if (['REQUEST_CHANGES', 'CHANGES_REQUESTED'].includes(state)) outcome = 'actionable';
    else if (state === 'APPROVED') outcome = 'clear';
  }
  const commitOid = reviewCommitOid(entry);
  if (outcome === 'clear' && commitOid && headOid && commitOid !== headOid) outcome = 'unknown';
  return outcome;
}

export function latestReviewCycle({
  comments = [],
  reviews = [],
  reviewer = 'chatgpt-codex-connector',
  reviewRequest = '',
  headOid = '',
  headCommitTime = '',
} = {}) {
  const normalizedComments = Array.isArray(comments) ? comments : [];
  const normalizedReviews = Array.isArray(reviews) ? reviews : [];
  const headTime = eventTime({ createdAt: headCommitTime });
  const requests = normalizedComments
    .filter((entry) => isRequest(entry, reviewRequest))
    .filter((entry) => {
      const time = eventTime(entry);
      return time !== null && (headTime === null || time >= headTime);
    })
    .sort((left, right) => (eventTime(left) ?? 0) - (eventTime(right) ?? 0));
  const request = requests.at(-1) || null;
  if (!request) return { request: null, response: null, outcome: 'unknown', source: '' };

  const requestTime = eventTime(request);
  const responseEvents = [
    ...normalizedComments
      .filter((entry) => !isRequest(entry, reviewRequest))
      .filter((entry) => isConfiguredReviewer(entry, reviewer))
      .map((entry, index) => ({ entry, source: 'top-level-comment', index })),
    ...normalizedReviews
      .filter((entry) => isConfiguredReviewer(entry, reviewer))
      .map((entry, index) => ({ entry, source: 'review', index })),
  ]
    .filter(({ entry }) => {
      const time = eventTime(entry);
      return time !== null && requestTime !== null && time >= requestTime;
    })
    .sort((left, right) => {
      const timeDifference = (eventTime(left.entry) ?? 0) - (eventTime(right.entry) ?? 0);
      return timeDifference || left.index - right.index;
    });

  const latest = responseEvents.at(-1);
  if (!latest) return { request, response: null, outcome: 'pending', source: '' };
  return {
    request,
    response: {
      ...latest.entry,
      id: eventId(latest.entry),
    },
    outcome: classifyReviewerEvent(latest.entry, { headOid }),
    source: latest.source,
  };
}

