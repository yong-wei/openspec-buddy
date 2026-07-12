#!/usr/bin/env node

import fs from 'node:fs';
import { latestReviewCycle } from './classify-review-response.mjs';

const [prFile, reviewCommentsFile, reviewThreadsFile, reviewerArg] = process.argv.slice(2);

if (!prFile || !reviewCommentsFile || !reviewThreadsFile) {
  process.stderr.write('Usage: verify-review-clear.mjs <pr-json> <review-comments-json> <review-threads-json> [reviewer-login]\n');
  process.exit(2);
}

const reviewer = reviewerArg || process.env.OPENSPEC_BUDDY_PR_REVIEW_AUTHOR || 'chatgpt-codex-connector';
const configuredReviewRequest = String(process.env.OPENSPEC_BUDDY_PR_REVIEW_REQUEST || '').trim();
const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
const reviewCommentsInput = JSON.parse(fs.readFileSync(reviewCommentsFile, 'utf8'));
const reviewThreadsInput = JSON.parse(fs.readFileSync(reviewThreadsFile, 'utf8'));
const errors = [];
let topLevelClearUsed = false;

function authorLogin(entry) {
  const value = entry?.author ?? entry?.user;
  if (typeof value === 'string') return value;
  return value?.login || value?.name || '';
}

function normalizeReviewerLogin(login) {
  return String(login || '').trim().toLowerCase().replace(/\[bot\]$/i, '');
}

function isConfiguredReviewer(entry) {
  const normalizedLogin = normalizeReviewerLogin(authorLogin(entry));
  const normalizedReviewer = normalizeReviewerLogin(reviewer);
  if (!normalizedLogin || !normalizedReviewer) return false;

  const codexConnector = 'chatgpt-codex-connector';
  if (normalizedReviewer.includes(codexConnector)) {
    return normalizedLogin.includes(codexConnector);
  }

  return normalizedLogin === normalizedReviewer;
}

function normalizeReviews(input) {
  const reviews = Array.isArray(input?.reviews) ? input.reviews : input?.reviews?.nodes || [];
  return reviews.map((review, index) => ({ ...review, __index: index }));
}

function normalizeReviewComments(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.comments)) return input.comments;
  if (Array.isArray(input?.comments?.nodes)) return input.comments.nodes;
  if (Array.isArray(input?.nodes)) return input.nodes;
  return [];
}

function normalizeThreadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes || [];
}

function normalizeReviewThreads(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.reviewThreads)) return input.reviewThreads;
  if (Array.isArray(input?.reviewThreads?.nodes)) return input.reviewThreads.nodes;
  return input?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
}

function normalizeIssueComments(input) {
  if (Array.isArray(input?.comments)) return input.comments;
  if (Array.isArray(input?.comments?.nodes)) return input.comments.nodes;
  return [];
}

function reviewCommitOid(review) {
  return review?.commit?.oid || review?.commit?.OID || review?.commit_id || review?.commitId || '';
}

function submittedTime(review) {
  const value = review?.submittedAt || review?.submitted_at || review?.createdAt || review?.created_at || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function entryTime(entry) {
  const value = entry?.createdAt || entry?.created_at || entry?.submittedAt || entry?.submitted_at || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function latestHeadCommitTime(input) {
  const commits = Array.isArray(input?.commits) ? input.commits : input?.commits?.nodes || [];
  const headOid = input.headRefOid || input.headOid || input.head?.oid || '';
  const headCommit = commits.find((commit) => commit?.oid === headOid) || commits.at(-1);
  const value = headCommit?.committedDate || headCommit?.committed_at || headCommit?.authoredDate || headCommit?.authored_at || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function priorityMarkers(text) {
  return Array.from(new Set(String(text || '').match(/\bP[0-2]\b/gi) || [])).map((value) => value.toUpperCase());
}

function isExplicitlyClear(text) {
  return /no actionable findings|no significant issues|no major problems|no major issues|did(?:n't| not) find any major issues|no findings|nothing actionable|没有重大问题|未发现重大问题|无重大问题|没有发现重大问题/i.test(String(text || ''));
}

function isReviewRequest(text) {
  const body = String(text || '');
  if (configuredReviewRequest) return body.includes(configuredReviewRequest);
  return /@codex\s+review\b/i.test(body);
}

function excerpt(text, maxLength = 240) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function issueLabel(thread) {
  const path = thread.path || 'unknown path';
  const line = thread.line || thread.startLine || thread.originalLine || '';
  return line ? `${path}:${line}` : path;
}

const reviews = normalizeReviews(pr);
const reviewerReviews = reviews.filter((review) => isConfiguredReviewer(review));
reviewerReviews.sort((left, right) => {
  const leftTime = submittedTime(left);
  const rightTime = submittedTime(right);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  return left.__index - right.__index;
});

const headCommitTime = latestHeadCommitTime(pr);
const issueComments = normalizeIssueComments(pr);
const headReviewRequests = issueComments
  .filter((comment) => isReviewRequest(comment?.body || ''))
  .filter((comment) => {
    const commentCreatedAt = entryTime(comment);
    return headCommitTime !== null && commentCreatedAt !== null && commentCreatedAt >= headCommitTime;
  })
  .sort((left, right) => {
    const leftTime = entryTime(left) ?? 0;
    const rightTime = entryTime(right) ?? 0;
    return leftTime - rightTime;
  });
const latestHeadReviewRequest = headReviewRequests.at(-1);

const topLevelClearCandidates = issueComments
  .filter((comment) => isConfiguredReviewer(comment))
  .filter((comment) => isExplicitlyClear(comment?.body || ''))
  .filter((comment) => {
    const commentCreatedAt = entryTime(comment);
    return headCommitTime !== null && commentCreatedAt !== null && commentCreatedAt >= headCommitTime;
  });
function topLevelClearBlocker() {
  if (topLevelClearCandidates.length === 0) return '';
  if (headCommitTime === null) {
    return 'A top-level clear comment exists, but the current head commit time is unavailable, so the comment cannot prove freshness.';
  }
  if (!latestHeadReviewRequest) {
    const requestHint = configuredReviewRequest || '@codex review';
    return `A top-level clear comment exists, but no '${requestHint}' review request comment after the current head commit was found.`;
  }
  return 'A top-level clear comment exists, but it is older than the latest review request for the current head commit.';
}

const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || '';
const cycle = latestReviewCycle({
  comments: issueComments,
  reviews: reviewerReviews,
  reviewer,
  reviewRequest: configuredReviewRequest,
  headOid,
  headCommitTime: headCommitTime === null ? '' : new Date(headCommitTime).toISOString(),
});
const latestReview = cycle.source === 'review' ? cycle.response : null;

if (cycle.outcome !== 'clear') {
  errors.push(`review_outcome: ${cycle.outcome}`);
  if (cycle.request?.id || cycle.request?.node_id) errors.push(`review_request_id: ${cycle.request.id || cycle.request.node_id}`);
  if (cycle.response?.id || cycle.response?.node_id) errors.push(`review_response_id: ${cycle.response.id || cycle.response.node_id}`);
  const responseAt = cycle.response?.createdAt
    || cycle.response?.created_at
    || cycle.response?.submittedAt
    || cycle.response?.submitted_at
    || '';
  const responseUrl = cycle.response?.url || cycle.response?.html_url || '';
  if (responseAt) errors.push(`review_response_at: ${responseAt}`);
  if (responseUrl) errors.push(`review_response_url: ${responseUrl}`);
  if (cycle.outcome === 'unavailable') {
    errors.push(`Review response is unavailable from ${reviewer}; Codex review capacity or service is unavailable.`);
  } else if (!cycle.request) {
    errors.push(topLevelClearBlocker() || `No '${configuredReviewRequest || '@codex review'}' review request comment after the current head commit was found.`);
  } else if (!cycle.response) {
    errors.push(`No review response from ${reviewer} was found after the latest current-head review request.`);
  } else if (cycle.outcome === 'actionable') {
    const state = String(cycle.response.state || '').toUpperCase();
    const markers = priorityMarkers(cycle.response.body || '');
    if (['REQUEST_CHANGES', 'CHANGES_REQUESTED'].includes(state)) {
      errors.push(`Latest review from ${reviewer} requested changes.`);
    }
    if (markers.length > 0) {
      errors.push(`Latest review from ${reviewer} contains ${markers.join('/')} findings; verify and address them before merge.`);
    }
    if (!['REQUEST_CHANGES', 'CHANGES_REQUESTED'].includes(state) && markers.length === 0) {
      errors.push(`Latest review response from ${reviewer} contains actionable feedback.`);
    }
  } else {
    errors.push(`Latest review response from ${reviewer} is not an explicit no-actionable-findings response.`);
  }
} else if (cycle.source === 'top-level-comment') {
  topLevelClearUsed = true;
}

const reviewThreads = normalizeReviewThreads(reviewThreadsInput);
for (const thread of reviewThreads) {
  if (thread?.isResolved === false) {
    const comments = normalizeThreadComments(thread);
    const bodies = comments.map((comment) => comment?.body || '').join('\n');
    const markers = priorityMarkers(bodies);
    const markerText = markers.length > 0 ? ` (${markers.join('/')} present)` : '';
    errors.push(`Found unresolved review thread at ${issueLabel(thread)}${markerText}; resolve it with evidence before merge.`);
  }
}

const reviewComments = normalizeReviewComments(reviewCommentsInput);
const hasThreadData = reviewThreads.length > 0 || JSON.stringify(reviewThreadsInput).includes('reviewThreads');
if (!hasThreadData) {
  for (const comment of reviewComments) {
    if (!isConfiguredReviewer(comment)) continue;
    const markers = priorityMarkers(comment?.body || '');
    const commentCommit = comment?.commit_id || comment?.commitId || '';
    const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || '';
    if (markers.length > 0 && (!headOid || !commentCommit || commentCommit === headOid)) {
      errors.push(`Review comment from ${reviewer} contains ${markers.join('/')} findings and no reviewThreads resolution data was available.`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`Review clearance verification failed:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}

const lines = [`Review clearance verified for PR #${pr.number || 'unknown'} using reviewer ${reviewer}.`];
if (topLevelClearUsed && cycle.response) {
  lines.push('Clearance source: top-level PR comment after a current-head review request.');
  lines.push(`Review request createdAt: ${cycle.request?.createdAt || cycle.request?.created_at || 'unknown'}`);
  if (cycle.request?.url || cycle.request?.html_url) lines.push(`Review request url: ${cycle.request.url || cycle.request.html_url}`);
  lines.push(`Clear comment createdAt: ${cycle.response.createdAt || cycle.response.created_at || 'unknown'}`);
  if (cycle.response.url || cycle.response.html_url) lines.push(`Clear comment url: ${cycle.response.url || cycle.response.html_url}`);
  lines.push(`Clear comment excerpt: ${excerpt(cycle.response.body)}`);
  lines.push('Human gate: use this returned clear comment as the judgment record that the script matched a no-major-issues review cycle.');
} else if (latestReview) {
  lines.push(`Clearance source: latest review state ${String(latestReview.state || 'UNKNOWN').toUpperCase()} from the latest current-head request cycle.`);
  lines.push(`Latest review commit: ${reviewCommitOid(latestReview) || 'unknown'}`);
  const latestSubmittedAt = latestReview.submittedAt || latestReview.submitted_at || latestReview.createdAt || latestReview.created_at || 'unknown';
  lines.push(`Latest review submittedAt: ${latestSubmittedAt}`);
}
process.stdout.write(`${lines.join('\n')}\n`);
