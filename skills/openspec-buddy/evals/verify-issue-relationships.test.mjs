import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const verifier = path.join(repoRoot, 'skills/openspec-buddy/scripts/verify-issue-relationships.mjs');

function runVerifier(input) {
  return spawnSync(process.execPath, [verifier], {
    cwd: repoRoot,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

const valid = runVerifier({
  requireParent: true,
  issues: [
    {
      number: 10,
      labels: ['type:series-parent', 'series:migration'],
      subIssues: [{ number: 11 }],
      blocking: [{ number: 12 }],
    },
    {
      number: 11,
      labels: ['type:change', 'series:migration'],
      parent: { number: 10 },
    },
    {
      number: 12,
      labels: ['type:change'],
      blockedBy: [{ number: 10 }],
    },
  ],
});
assert.equal(valid.status, 0, valid.stderr);
assert.match(valid.stdout, /Issue relationships verified\./);

const missingParentReverse = runVerifier({
  issues: [
    {
      number: 20,
      labels: ['type:series-parent', 'series:migration'],
      subIssues: [],
    },
    {
      number: 21,
      labels: ['type:change', 'series:migration'],
      parent: { number: 20 },
    },
  ],
});
assert.notEqual(missingParentReverse.status, 0);
assert.match(
  missingParentReverse.stderr,
  /#21 has parent #20, but parent subIssues is missing #21\./,
);

const missingBlockedByReverse = runVerifier({
  issues: [
    {
      number: 30,
      labels: ['type:change'],
      blockedBy: [{ number: 31 }],
    },
    {
      number: 31,
      labels: ['type:change'],
      blocking: [],
    },
  ],
});
assert.notEqual(missingBlockedByReverse.status, 0);
assert.match(
  missingBlockedByReverse.stderr,
  /#30 is blocked by #31, but reverse blocking edge is missing in input\./,
);

const missingBlockedByEndpoint = runVerifier({
  issues: [
    {
      number: 35,
      labels: ['type:change'],
      blockedBy: [{ number: 36 }],
    },
  ],
});
assert.notEqual(missingBlockedByEndpoint.status, 0);
assert.match(
  missingBlockedByEndpoint.stderr,
  /#35 is blocked by #36, but #36 is missing from verification input\./,
);

const missingBlockingReverse = runVerifier({
  issues: [
    {
      number: 40,
      labels: ['type:change'],
      blocking: [{ number: 41 }],
    },
    {
      number: 41,
      labels: ['type:change'],
      blockedBy: [],
    },
  ],
});
assert.notEqual(missingBlockingReverse.status, 0);
assert.match(
  missingBlockingReverse.stderr,
  /#40 blocks #41, but reverse blockedBy edge is missing in input\./,
);

const missingBlockingEndpoint = runVerifier({
  issues: [
    {
      number: 45,
      labels: ['type:change'],
      blocking: [{ number: 46 }],
    },
  ],
});
assert.notEqual(missingBlockingEndpoint.status, 0);
assert.match(
  missingBlockingEndpoint.stderr,
  /#45 blocks #46, but #46 is missing from verification input\./,
);

const seriesParentDependencyMismatch = runVerifier({
  issues: [
    {
      number: 50,
      labels: ['type:series-parent', 'series:migration'],
      blocking: [{ number: 51 }],
    },
    {
      number: 51,
      labels: ['type:change'],
      blockedBy: [],
    },
  ],
});
assert.notEqual(seriesParentDependencyMismatch.status, 0);
assert.match(
  seriesParentDependencyMismatch.stderr,
  /#50 blocks #51, but reverse blockedBy edge is missing in input\./,
);

console.log('verify issue relationships eval passed');
