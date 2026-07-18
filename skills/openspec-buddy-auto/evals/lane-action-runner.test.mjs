import assert from 'node:assert/strict';
import { runLaneAction } from '../scripts/full/lane-action-runner.mjs';

function makeState() {
  return {
    lanes: [
      {
        id: 'issue-675',
        issue: '675',
        pr: '707',
        branch: 'change-675',
        head: 'head-1',
        stage: 'waiting_review',
        lastRequestState: 'present-current-head',
      },
    ],
  };
}

function makeRunner({ dirty = false, guardFail = false } = {}) {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'git' && args[0] === 'status') {
      return { status: 0, stdout: dirty ? ' M file\n' : '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'switch') return { status: 0, stdout: '', stderr: '' };
    if (String(command).endsWith('verify-claim-worktree.sh')) {
      return guardFail
        ? { status: 42, stdout: '', stderr: 'foreign claim' }
        : { status: 0, stdout: '', stderr: '' };
    }
    if (command === '/helper/request-pr-review.sh') return { status: 0, stdout: 'requested', stderr: '' };
    if (command === 'gh') {
      return {
        status: 0,
        stdout: JSON.stringify({ number: 707, state: 'OPEN', headRefOid: 'head-2', headRefName: 'change-675' }),
        stderr: '',
      };
    }
    if (command === 'git' && args[0] === 'branch') return { status: 0, stdout: 'change-675\n', stderr: '' };
    return { status: 99, stdout: '', stderr: `unexpected ${command} ${args.join(' ')}` };
  };
  return { calls, runner };
}

{
  const state = makeState();
  let wrote = false;
  const { calls, runner } = makeRunner();
  const result = runLaneAction(state, state.lanes[0], {
    command: '/helper/request-pr-review.sh',
    args: ['707'],
    patch: {
      stage: 'waiting_review',
      reviewRequestedAt: '2026-06-30T00:00:00.000Z',
      lastRequestState: 'present-current-head',
    },
  }, {
    cwd: '/repo',
    coreScriptDir: '/core',
    runSync: runner,
    writeState: () => { wrote = true; },
  });
  assert.equal(result.status, 'ok');
  assert.equal(wrote, true);
  assert.deepEqual(calls.slice(0, 4), [
    'git status --porcelain',
    'git switch change-675',
    '/core/verify-claim-worktree.sh --issue 675 --pr 707',
    '/helper/request-pr-review.sh 707',
  ]);
  assert.equal(state.lanes[0].head, 'head-2');
  assert.equal(state.lanes[0].stage, 'waiting_review');
}

{
  const state = makeState();
  let wrote = false;
  const { calls, runner } = makeRunner({ dirty: true });
  const result = runLaneAction(state, state.lanes[0], {
    command: '/helper/request-pr-review.sh',
    args: ['707'],
  }, {
    cwd: '/repo',
    coreScriptDir: '/core',
    runSync: runner,
    writeState: () => { wrote = true; },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'worktree is dirty');
  assert.equal(wrote, false);
  assert.deepEqual(calls.slice(0, 1), ['git status --porcelain']);
  assert.equal(calls.some((call) => call.includes('request-pr-review')), false);
}

{
  const state = makeState();
  let wrote = false;
  const { calls, runner } = makeRunner({ guardFail: true });
  const result = runLaneAction(state, state.lanes[0], {
    command: '/helper/request-pr-review.sh',
    args: ['707'],
  }, {
    cwd: '/repo',
    coreScriptDir: '/core',
    runSync: runner,
    writeState: () => { wrote = true; },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'foreign claim');
  assert.equal(result.issue, '675');
  assert.equal(result.pr, '707');
  assert.equal(result.branch, 'change-675');
  assert.equal(result.head, 'head-1');
  assert.equal(wrote, false);
  assert.equal(calls.some((call) => call.includes('request-pr-review')), false);
}

console.log('lane-action-runner tests passed');
