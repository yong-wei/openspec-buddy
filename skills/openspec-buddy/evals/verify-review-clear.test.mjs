import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(__dirname, '../scripts/verify-review-clear.mjs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-review-clear-'));
const reviewer = 'chatgpt-codex-connector';
const reviewRequest = '@codex review 中文回复，即使没有重大问题也必须给出显式回复';

function writeJson(name, value) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runVerify({ pr, reviewComments = [], threads = { reviewThreads: [] } }) {
  const prFile = writeJson(`pr-${Math.random()}.json`, pr);
  const commentsFile = writeJson(`comments-${Math.random()}.json`, reviewComments);
  const threadsFile = writeJson(`threads-${Math.random()}.json`, threads);

  return spawnSync(process.execPath, [helper, prFile, commentsFile, threadsFile, reviewer], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENSPEC_BUDDY_PR_REVIEW_REQUEST: reviewRequest,
    },
  });
}

function basePr(review, overrides = {}) {
  return {
    number: 162,
    headRefOid: 'abc123',
    commits: [{ oid: 'abc123', committedDate: '2026-01-01T00:00:00Z' }],
    comments: [{ author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:01:00Z' }],
    reviews: [{ submittedAt: '2026-01-01T00:02:00Z', ...review }],
    ...overrides,
  };
}

try {
  const p1Review = runVerify({
    pr: basePr({
      author: { login: reviewer },
      state: 'COMMENTED',
      body: '[P1] First correctness issue\n\n[P1] Second correctness issue',
      commit: { oid: 'abc123' },
    }),
  });
  assert.notEqual(p1Review.status, 0);
  assert.match(p1Review.stderr, /P1/);

  const p2Review = runVerify({
    pr: basePr({
      author: { login: reviewer },
      state: 'COMMENTED',
      body: '[P2] Please verify whether this edge case is real before merging.',
      commit: { oid: 'abc123' },
    }),
  });
  assert.notEqual(p2Review.status, 0);
  assert.match(p2Review.stderr, /P2/);

  const unresolvedThread = runVerify({
    pr: basePr({
      author: { login: reviewer },
      state: 'COMMENTED',
      body: 'No actionable findings.',
      commit: { oid: 'abc123' },
    }),
    threads: {
      reviewThreads: [
        {
          isResolved: false,
          path: 'src/app.ts',
          line: 42,
          comments: [{ author: { login: reviewer }, body: '[P2] Verify this branch.' }],
        },
      ],
    },
  });
  assert.notEqual(unresolvedThread.status, 0);
  assert.match(unresolvedThread.stderr, /unresolved review thread/);

  const cleanReview = runVerify({
    pr: basePr({
      author: { login: reviewer },
      state: 'COMMENTED',
      body: 'No actionable findings.',
      commit: { oid: 'abc123' },
    }),
  });
  assert.equal(cleanReview.status, 0, cleanReview.stderr || cleanReview.stdout);
  assert.match(cleanReview.stdout, /Clearance source: latest review state COMMENTED/);

  const cleanBotReview = runVerify({
    pr: basePr({
      author: { login: `${reviewer}[bot]` },
      state: 'COMMENTED',
      body: 'No actionable findings.',
      commit: { oid: 'abc123' },
    }),
  });
  assert.equal(cleanBotReview.status, 0, cleanBotReview.stderr || cleanBotReview.stdout);
  assert.match(cleanBotReview.stdout, /Clearance source: latest review state COMMENTED/);

  const cleanChineseBotReview = runVerify({
    pr: basePr({
      author: { login: `${reviewer}[bot]` },
      state: 'COMMENTED',
      body: '没有重大问题。',
      commit: { oid: 'abc123' },
    }),
  });
  assert.equal(cleanChineseBotReview.status, 0, cleanChineseBotReview.stderr || cleanChineseBotReview.stdout);
  assert.match(cleanChineseBotReview.stdout, /Clearance source: latest review state COMMENTED/);

  const staleReviewWithUnrequestedClearComment = runVerify({
    pr: basePr(
      {
        author: { login: reviewer },
        state: 'COMMENTED',
        body: '[P2] Please verify this edge case.',
        commit: { oid: 'old456' },
        submittedAt: '2026-01-01T00:01:00Z',
      },
      {
        commits: [{ oid: 'abc123', committedDate: '2026-01-01T00:02:00Z' }],
        comments: [
          {
            author: { login: reviewer },
            body: 'No major issues.',
            createdAt: '2026-01-01T00:05:00Z',
            url: 'https://example.test/pr/162#issuecomment-clear',
          },
        ],
      },
    ),
  });
  assert.notEqual(staleReviewWithUnrequestedClearComment.status, 0);
  assert.match(staleReviewWithUnrequestedClearComment.stderr, /no '@codex review/);

  const staleReviewWithHeadRequestedClearComment = runVerify({
    pr: basePr(
      {
        author: { login: reviewer },
        state: 'COMMENTED',
        body: '[P2] Please verify this edge case.',
        commit: { oid: 'old456' },
        submittedAt: '2026-01-01T00:01:00Z',
      },
      {
        commits: [{ oid: 'abc123', committedDate: '2026-01-01T00:02:00Z' }],
        comments: [
          {
            author: { login: 'YW' },
            body: reviewRequest,
            createdAt: '2026-01-01T00:03:00Z',
            url: 'https://example.test/pr/162#issuecomment-request',
          },
          {
            author: { login: reviewer },
            body: 'No major issues after reviewing the latest commit.',
            createdAt: '2026-01-01T00:05:00Z',
            url: 'https://example.test/pr/162#issuecomment-clear',
          },
        ],
      },
    ),
  });
  assert.equal(
    staleReviewWithHeadRequestedClearComment.status,
    0,
    staleReviewWithHeadRequestedClearComment.stderr || staleReviewWithHeadRequestedClearComment.stdout,
  );
  assert.match(staleReviewWithHeadRequestedClearComment.stdout, /top-level PR comment/);
  assert.match(staleReviewWithHeadRequestedClearComment.stdout, /issuecomment-clear/);
  assert.match(staleReviewWithHeadRequestedClearComment.stdout, /No major issues after reviewing the latest commit/);

  const staleBotReviewWithHeadRequestedBotClearComment = runVerify({
    pr: basePr(
      {
        author: { login: `${reviewer}[bot]` },
        state: 'COMMENTED',
        body: '[P2] Please verify this edge case.',
        commit: { oid: 'old456' },
        submittedAt: '2026-01-01T00:01:00Z',
      },
      {
        commits: [{ oid: 'abc123', committedDate: '2026-01-01T00:02:00Z' }],
        comments: [
          {
            author: { login: 'YW' },
            body: reviewRequest,
            createdAt: '2026-01-01T00:03:00Z',
            url: 'https://example.test/pr/162#issuecomment-request',
          },
          {
            author: { login: `${reviewer}[bot]` },
            body: "Didn't find any major issues.",
            createdAt: '2026-01-01T00:05:00Z',
            url: 'https://example.test/pr/162#issuecomment-bot-clear',
          },
        ],
      },
    ),
  });
  assert.equal(
    staleBotReviewWithHeadRequestedBotClearComment.status,
    0,
    staleBotReviewWithHeadRequestedBotClearComment.stderr || staleBotReviewWithHeadRequestedBotClearComment.stdout,
  );
  assert.match(staleBotReviewWithHeadRequestedBotClearComment.stdout, /top-level PR comment/);
  assert.match(staleBotReviewWithHeadRequestedBotClearComment.stdout, /issuecomment-bot-clear/);

  const quotaComment = 'You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.\nTo continue using code reviews, add credits to your account.';
  const quotaOnly = runVerify({
    pr: basePr({}, {
      reviews: [],
      comments: [
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:03:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: quotaComment, createdAt: '2026-01-01T00:04:00Z' },
      ],
    }),
  });
  assert.notEqual(quotaOnly.status, 0);
  assert.match(quotaOnly.stderr, /review_outcome: unavailable/);
  assert.match(quotaOnly.stderr, /Review response is unavailable/);
  assert.doesNotMatch(quotaOnly.stdout, /Review clearance verified/);

  const oldClearThenQuota = runVerify({
    pr: basePr({}, {
      reviews: [],
      comments: [
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:03:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: "Didn't find any major issues.", createdAt: '2026-01-01T00:04:00Z' },
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:05:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: quotaComment, createdAt: '2026-01-01T00:06:00Z' },
      ],
    }),
  });
  assert.notEqual(oldClearThenQuota.status, 0);
  assert.match(oldClearThenQuota.stderr, /review_outcome: unavailable/);

  const quotaThenCurrentHeadClear = runVerify({
    pr: basePr({}, {
      reviews: [],
      comments: [
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:03:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: quotaComment, createdAt: '2026-01-01T00:04:00Z' },
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:05:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: "Didn't find any major issues.", createdAt: '2026-01-01T00:06:00Z' },
      ],
    }),
  });
  assert.equal(
    quotaThenCurrentHeadClear.status,
    0,
    quotaThenCurrentHeadClear.stderr || quotaThenCurrentHeadClear.stdout,
  );
  assert.match(quotaThenCurrentHeadClear.stdout, /Review clearance verified/);

  const clearThenUnknown = runVerify({
    pr: basePr({}, {
      reviews: [],
      comments: [
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:03:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: "Didn't find any major issues.", createdAt: '2026-01-01T00:04:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: 'Review is still being analyzed.', createdAt: '2026-01-01T00:05:00Z' },
      ],
    }),
  });
  assert.notEqual(clearThenUnknown.status, 0);
  assert.match(clearThenUnknown.stderr, /review_outcome: unknown/);
  assert.doesNotMatch(clearThenUnknown.stdout, /Review clearance verified/);

  const clearBeforeHeadChange = runVerify({
    pr: basePr({}, {
      headRefOid: 'head-2',
      commits: [{ oid: 'head-2', committedDate: '2026-01-01T00:05:00Z' }],
      reviews: [],
      comments: [
        { author: { login: 'YW' }, body: reviewRequest, createdAt: '2026-01-01T00:03:00Z' },
        { author: { login: `${reviewer}[bot]` }, body: "Didn't find any major issues.", createdAt: '2026-01-01T00:04:00Z' },
      ],
    }),
  });
  assert.notEqual(clearBeforeHeadChange.status, 0);
  assert.doesNotMatch(clearBeforeHeadChange.stdout, /Review clearance verified/);

  console.log('verify-review-clear tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
