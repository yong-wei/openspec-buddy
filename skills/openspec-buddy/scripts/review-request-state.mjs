#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
const jsonOutput = args[0] === '--json';
if (jsonOutput) args.shift();
const [reviewRequest, prFile, commitsFile, commentsFile] = args;

if (!reviewRequest || !prFile || !commitsFile || !commentsFile) {
  process.stderr.write('Usage: review-request-state.mjs [--json] <review-request> <pr-json> <commits-json> <issue-comments-json>\n');
  process.exit(2);
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  return [];
}

function entryTime(entry) {
  const value = entry?.createdAt || entry?.created_at || entry?.committedDate || entry?.committed_at || entry?.authoredDate || entry?.authored_at || entry?.commit?.committer?.date || entry?.commit?.author?.date || '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

const pr = readJson(prFile, {});
const commits = list(readJson(commitsFile, []));
const comments = list(readJson(commentsFile, []));
const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || pr.head?.sha || '';
const headCommit = headOid ? commits.find((commit) => commit?.oid === headOid || commit?.sha === headOid) : null;
const headTime = entryTime(headCommit);
const matchingRequests = comments.filter((comment) => String(comment?.body || '').includes(reviewRequest));

if (headTime === null) {
  if (jsonOutput) process.stdout.write(`${JSON.stringify({ state: 'unknown-head', requestedAt: '' })}\n`);
  else process.stdout.write('unknown-head');
  process.exit(0);
}

const freshRequests = matchingRequests
  .map((comment) => ({ comment, time: entryTime(comment) }))
  .filter((entry) => entry.time !== null && entry.time >= headTime)
  .sort((left, right) => left.time - right.time);
const latestRequest = freshRequests.at(-1) || null;
const state = latestRequest ? 'present-current-head' : 'missing-current-head';
const requestedAt = latestRequest
  ? String(latestRequest.comment?.createdAt || latestRequest.comment?.created_at || '')
  : '';

if (jsonOutput) process.stdout.write(`${JSON.stringify({ state, requestedAt })}\n`);
else process.stdout.write(state);
