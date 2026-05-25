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
  });
}

function basePr(review) {
  return {
    number: 162,
    headRefOid: 'abc123',
    reviews: [review],
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

  console.log('verify-review-clear tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
