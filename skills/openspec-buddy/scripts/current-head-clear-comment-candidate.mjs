#!/usr/bin/env node

import fs from 'node:fs';
import { latestReviewCycle } from './classify-review-response.mjs';

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
const cycle = latestReviewCycle({
  comments,
  reviews,
  reviewer,
  reviewRequest: configuredReviewRequest,
  headOid,
  headCommitTime: headCommitTime === null ? '' : new Date(headCommitTime).toISOString(),
});
const requestCreatedAt = cycle.request?.createdAt || cycle.request?.created_at || '';
const responseCreatedAt = cycle.response?.createdAt
  || cycle.response?.created_at
  || cycle.response?.submittedAt
  || cycle.response?.submitted_at
  || '';
const responseUrl = cycle.response?.url || cycle.response?.html_url || '';

process.stdout.write(`${JSON.stringify({
  hasCandidate: cycle.outcome === 'clear',
  outcome: cycle.outcome,
  source: cycle.source,
  headOid,
  headCommitTime: headCommitTime ? new Date(headCommitTime).toISOString() : '',
  requestId: cycle.request?.id || cycle.request?.node_id || '',
  requestCreatedAt,
  responseId: cycle.response?.id || cycle.response?.node_id || '',
  responseCreatedAt,
  responseUrl,
  clearCreatedAt: cycle.outcome === 'clear' ? responseCreatedAt : '',
  clearUrl: cycle.outcome === 'clear' ? responseUrl : '',
})}\n`);
