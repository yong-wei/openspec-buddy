#!/usr/bin/env node

import fs from 'node:fs';

const [prFile, reviewCommentsFile, reviewThreadsFile, reviewerArg] = process.argv.slice(2);

if (!prFile || !reviewCommentsFile || !reviewThreadsFile) {
  process.stderr.write('Usage: verify-review-clear.mjs <pr-json> <review-comments-json> <review-threads-json> [reviewer-login]\n');
  process.exit(2);
}

const reviewer = reviewerArg || process.env.OPENSPEC_BUDDY_PR_REVIEW_AUTHOR || 'chatgpt-codex-connector';
const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
const reviewCommentsInput = JSON.parse(fs.readFileSync(reviewCommentsFile, 'utf8'));
const reviewThreadsInput = JSON.parse(fs.readFileSync(reviewThreadsFile, 'utf8'));
const errors = [];

function authorLogin(entry) {
  const value = entry?.author ?? entry?.user;
  if (typeof value === 'string') return value;
  return value?.login || value?.name || '';
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
  return /no actionable findings|no significant issues|no major problems|no major issues|did(?:n't| not) find any major issues|no findings|nothing actionable/i.test(String(text || ''));
}

function issueLabel(thread) {
  const path = thread.path || 'unknown path';
  const line = thread.line || thread.startLine || thread.originalLine || '';
  return line ? `${path}:${line}` : path;
}

const reviews = normalizeReviews(pr);
const reviewerReviews = reviews.filter((review) => authorLogin(review) === reviewer);
reviewerReviews.sort((left, right) => {
  const leftTime = submittedTime(left);
  const rightTime = submittedTime(right);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
  return left.__index - right.__index;
});

const headCommitTime = latestHeadCommitTime(pr);
const reviewerClearComments = normalizeIssueComments(pr)
  .filter((comment) => authorLogin(comment) === reviewer)
  .filter((comment) => isExplicitlyClear(comment?.body || ''))
  .filter((comment) => {
    const commentCreatedAt = entryTime(comment);
    return headCommitTime === null || (commentCreatedAt !== null && commentCreatedAt >= headCommitTime);
  });
const latestReviewerClearComment = reviewerClearComments.sort((left, right) => {
  const leftTime = entryTime(left) ?? 0;
  const rightTime = entryTime(right) ?? 0;
  return leftTime - rightTime;
}).at(-1);

const latestReview = reviewerReviews.at(-1);
if (!latestReview) {
  if (!latestReviewerClearComment) {
    errors.push(`No review found from ${reviewer}.`);
  }
} else {
  const state = String(latestReview.state || '').toUpperCase();
  const body = String(latestReview.body || '');
  const markers = priorityMarkers(body);
  const commitOid = reviewCommitOid(latestReview);
  const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || '';

  if (headOid && commitOid && commitOid !== headOid) {
    if (!latestReviewerClearComment) {
      errors.push(`Latest review from ${reviewer} targets ${commitOid}, not current head ${headOid}.`);
    }
  }
  if (['REQUEST_CHANGES', 'CHANGES_REQUESTED'].includes(state)) {
    errors.push(`Latest review from ${reviewer} requested changes.`);
  }
  if (markers.length > 0) {
    errors.push(`Latest review from ${reviewer} contains ${markers.join('/')} findings; verify and address them before merge.`);
  }
  if (state === 'COMMENTED' && !isExplicitlyClear(body)) {
    if (!latestReviewerClearComment) {
      errors.push(`Latest COMMENTED review from ${reviewer} is not an explicit no-actionable-findings review.`);
    }
  }
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
    if (authorLogin(comment) !== reviewer) continue;
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

process.stdout.write(`Review clearance verified for PR #${pr.number || 'unknown'} using reviewer ${reviewer}.\n`);
