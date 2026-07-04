#!/usr/bin/env node

import fs from 'node:fs';

const [reviewRequest, prFile, commitsFile, commentsFile, reviewsFile, reviewerArg] = process.argv.slice(2);

if (!prFile || !commitsFile || !commentsFile || !reviewsFile) {
  process.stderr.write('Usage: current-head-clear-comment-candidate.mjs <review-request> <pr-json> <commits-json> <issue-comments-json> <reviews-json> [reviewer-login]\n');
  process.exit(2);
}

const reviewer = reviewerArg || process.env.OPENSPEC_BUDDY_PR_REVIEW_AUTHOR || 'chatgpt-codex-connector';
const configuredReviewRequest = String(reviewRequest || process.env.OPENSPEC_BUDDY_PR_REVIEW_REQUEST || '').trim();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

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

function entryTime(entry) {
  const value = entry?.createdAt || entry?.created_at || entry?.submittedAt || entry?.submitted_at || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isExplicitlyClear(text) {
  return /no actionable findings|no significant issues|no major problems|no major issues|did(?:n't| not) find any major issues|no findings|nothing actionable|没有重大问题|未发现重大问题|无重大问题|没有发现重大问题/i.test(String(text || ''));
}

function isClearReview(review) {
  const state = String(review?.state || '').toUpperCase();
  return state === 'APPROVED' || isExplicitlyClear(review?.body || '');
}

function isReviewRequest(text) {
  const body = String(text || '');
  if (configuredReviewRequest) return body.includes(configuredReviewRequest);
  return /@codex\s+review\b/i.test(body);
}

function reviewCommitOid(review) {
  return review?.commit?.oid || review?.commit?.OID || review?.commit_id || review?.commitId || '';
}

function latestHeadCommitTime(pr, commits) {
  const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || pr.head?.sha || '';
  const headCommit = commits.find((commit) => commit?.oid === headOid || commit?.sha === headOid) || commits.at(-1);
  const value = headCommit?.committedDate
    || headCommit?.committed_at
    || headCommit?.authoredDate
    || headCommit?.authored_at
    || headCommit?.commit?.committer?.date
    || headCommit?.commit?.author?.date
    || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

const pr = readJson(prFile);
const commits = array(readJson(commitsFile));
const comments = array(readJson(commentsFile));
const reviews = array(readJson(reviewsFile));
const headCommitTime = latestHeadCommitTime(pr, commits);
const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || pr.head?.sha || '';

const headReviewRequests = comments
  .filter((comment) => isReviewRequest(comment?.body || ''))
  .filter((comment) => {
    const createdAt = entryTime(comment);
    return headCommitTime !== null && createdAt !== null && createdAt >= headCommitTime;
  })
  .sort((left, right) => (entryTime(left) ?? 0) - (entryTime(right) ?? 0));
const latestRequest = headReviewRequests.at(-1);

const clearComments = comments
  .filter((comment) => isConfiguredReviewer(comment))
  .filter((comment) => isExplicitlyClear(comment?.body || ''))
  .filter((comment) => {
    const createdAt = entryTime(comment);
    const requestCreatedAt = entryTime(latestRequest);
    return latestRequest
      && headCommitTime !== null
      && createdAt !== null
      && requestCreatedAt !== null
      && createdAt >= headCommitTime
      && createdAt >= requestCreatedAt;
  })
  .sort((left, right) => (entryTime(left) ?? 0) - (entryTime(right) ?? 0));
const latestClear = clearComments.at(-1);
const latestClearReview = reviews
  .filter((review) => isConfiguredReviewer(review))
  .filter((review) => isClearReview(review))
  .filter((review) => {
    const commitOid = reviewCommitOid(review);
    const submittedAt = entryTime(review);
    const requestCreatedAt = entryTime(latestRequest);
    return latestRequest
      && headOid
      && commitOid
      && commitOid === headOid
      && submittedAt !== null
      && requestCreatedAt !== null
      && submittedAt >= requestCreatedAt;
  })
  .sort((left, right) => (entryTime(left) ?? 0) - (entryTime(right) ?? 0))
  .at(-1);

process.stdout.write(`${JSON.stringify({
  hasCandidate: Boolean(latestClear || latestClearReview),
  source: latestClear ? 'top-level-comment' : latestClearReview ? 'review' : '',
  headCommitTime: headCommitTime ? new Date(headCommitTime).toISOString() : '',
  requestCreatedAt: latestRequest?.createdAt || latestRequest?.created_at || '',
  clearCreatedAt: latestClear?.createdAt || latestClear?.created_at || '',
  clearUrl: latestClear?.url || latestClear?.html_url || '',
})}\n`);
