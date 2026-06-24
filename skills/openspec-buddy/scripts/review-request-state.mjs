#!/usr/bin/env node
import fs from 'node:fs';

const [reviewRequest, prFile, commitsFile, commentsFile] = process.argv.slice(2);

if (!reviewRequest || !prFile || !commitsFile || !commentsFile) {
  process.stderr.write('Usage: review-request-state.mjs <review-request> <pr-json> <commits-json> <issue-comments-json>\n');
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
  process.stdout.write('unknown-head');
  process.exit(0);
}

const freshRequest = matchingRequests.some((comment) => {
  const createdAt = entryTime(comment);
  return createdAt !== null && createdAt >= headTime;
});

process.stdout.write(freshRequest ? 'present-current-head' : 'missing-current-head');
