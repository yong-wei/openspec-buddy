import assert from 'node:assert/strict';
import { classifyReviewResponse, latestReviewCycle } from '../scripts/classify-review-response.mjs';

function request(createdAt, id = `request-${createdAt}`) {
  return {
    id,
    author: { login: 'YW' },
    body: '@codex review',
    createdAt,
  };
}

function botComment(body, createdAt, id) {
  return {
    id,
    author: { login: 'chatgpt-codex-connector[bot]' },
    body,
    createdAt,
    url: `https://example.test/comments/${id}`,
  };
}

assert.equal(classifyReviewResponse(
  'You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.\nTo continue using code reviews, add credits to your account.',
), 'unavailable');
assert.equal(classifyReviewResponse("Codex Review: Didn't find any major issues."), 'clear');
assert.equal(classifyReviewResponse('[P1] Preserve the branch after a failed resume.'), 'actionable');

const cycle = latestReviewCycle({
  headOid: 'head-1',
  headCommitTime: '2026-07-11T04:00:00Z',
  reviewRequest: '@codex review',
  reviewer: 'chatgpt-codex-connector',
  comments: [
    request('2026-07-11T04:01:00Z', 'request-1'),
    botComment("Codex Review: Didn't find any major issues.", '2026-07-11T04:02:00Z', 'clear-1'),
    request('2026-07-11T04:03:00Z', 'request-2'),
    botComment(
      'You have reached your Codex usage limits for code reviews. To continue using code reviews, add credits to your account.',
      '2026-07-11T04:04:00Z',
      'quota-2',
    ),
  ],
  reviews: [],
});
assert.equal(cycle.outcome, 'unavailable');
assert.equal(cycle.request.id, 'request-2');
assert.equal(cycle.response.createdAt, '2026-07-11T04:04:00Z');
assert.equal(cycle.response.id, 'quota-2');

console.log('classify-review-response tests passed');
