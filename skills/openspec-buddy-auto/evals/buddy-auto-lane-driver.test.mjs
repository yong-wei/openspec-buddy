#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const helper = path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-lanes-'));

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function makeEnv(name) {
  const root = path.join(tmp, name);
  const binDir = path.join(root, 'bin');
  const coreDir = path.join(root, 'core');
  const repoDir = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  const logFile = path.join(root, 'commands.log');
  makeExecutable(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "-C" ]]; then shift 2; fi
case "\${1:-}" in
  rev-parse)
    if [[ "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
    if [[ "\${2:-}" == "HEAD" ]]; then
      if [[ -n "\${REVIEW_FIX_NEW_HEAD:-}" && "\${CURRENT_BRANCH:-dev1}" == "change-675" ]]; then printf '%s\\n' "\${REVIEW_FIX_NEW_HEAD}"; exit 0; fi
      if [[ "\${CURRENT_BRANCH:-dev1}" == "change-676" ]]; then printf 'head-2\\n'; else printf 'head-1\\n'; fi
      exit 0
    fi
    ;;
  config)
    if [[ "\${2:-}" == "--worktree" ]]; then
      case "\${3:-}" in
        buddy.worktreeAlias) printf 'dev1\\n'; exit 0 ;;
        buddy.boundBranch) printf 'dev1\\n'; exit 0 ;;
        buddy.boundBase) printf 'origin/integration\\n'; exit 0 ;;
      esac
    fi
    ;;
  branch)
    if [[ "\${2:-}" == "--show-current" ]]; then printf '%s\\n' "\${CURRENT_BRANCH:-dev1}"; exit 0; fi
    ;;
  status)
    if [[ "\${BUDDY_FAKE_DIRTY:-0}" == "1" && "\${2:-}" == "--porcelain" ]]; then printf ' M dirty.txt\\n'; exit 0; fi
    exit 0
    ;;
  switch)
    echo "switch \${2:-}" >> ${JSON.stringify(logFile)}
    exit 0
    ;;
  ls-remote)
    if [[ "\${4:-}" == "change-675" ]]; then printf 'head-1\\trefs/heads/change-675\\n'; exit 0; fi
    if [[ "\${4:-}" == "change-676" ]]; then printf 'head-2\\trefs/heads/change-676\\n'; exit 0; fi
    exit 0
    ;;
  remote)
    if [[ "\${2:-}" == "get-url" ]]; then printf 'https://github.com/opt-de/major.git\\n'; exit 0; fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
`);
  makeExecutable(path.join(binDir, 'gh'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "api" && "\${2:-}" == */issues/*/comments* ]]; then printf '[]\\n'; exit 0; fi
if [[ "\${1:-}" == "pr" && "\${2:-}" == "view" ]]; then
  if [[ " $* " == *" --jq .headRefOid "* ]]; then
    case "\${3:-}" in
      708) printf 'head-2\\n'; exit 0 ;;
      *) printf '%s\\n' "\${REVIEW_FIX_NEW_HEAD:-head-1}"; exit 0 ;;
    esac
  fi
  case "\${3:-}" in
    708) printf '%s\\n' '{"number":708,"state":"OPEN","headRefName":"change-676","headRefOid":"head-2"}'; exit 0 ;;
    *) printf '{"number":707,"state":"OPEN","headRefName":"change-675","headRefOid":"%s"}\\n' "\${REVIEW_FIX_NEW_HEAD:-head-1}"; exit 0 ;;
  esac
fi
echo "unexpected gh invocation: $*" >&2
exit 99
`);
  makeExecutable(path.join(coreDir, 'verify-bound-worktree.sh'), `#!/bin/bash\necho "verify-bound $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'select-next-change.sh'), `#!/bin/bash
set -euo pipefail
echo "select excludes=$(cat "\${OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE:?}")" >> ${JSON.stringify(logFile)}
if [[ "\${SELECT_LOCAL_ONLY:-0}" == "1" ]]; then
  printf '%s\\n' '{"selected":{"change_id":"local-change","local_only":true,"no_issue":true,"number":null}}'
  exit 0
fi
if [[ "\${SELECT_NONE:-0}" == "1" ]]; then
  printf '%s\\n' '{"selected":null,"reason":"No executable OpenSpec Buddy issue."}'
  exit 0
fi
printf '%s\\n' '{"selected":{"number":676,"title":"Next","change_id":"change-676","claim_branch":"change-676"}}'
`);
  makeExecutable(path.join(coreDir, 'claim-issue.sh'), `#!/bin/bash\necho "claim $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'find-issue-pr.sh'), `#!/bin/bash
set -euo pipefail
echo "find-pr $*" >> ${JSON.stringify(logFile)}
if [[ "\${FIND_PR_FOR_676:-0}" == "1" && "\${1:-}" == "676" ]]; then
  printf '%s\\n' '{"issue":"676","pr":"708","head":"head-2","headRefOid":"head-2","headRefName":"change-676","url":"https://github.test/pull/708","reason":"exact PR"}'
  exit 0
fi
printf '{"issue":%s,"pr":null,"reason":"no PR"}\\n' "$1"
`);
  makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/bin/bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-claim-worktree.sh'), `#!/bin/bash\necho "verify-claim $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-current-head-review-request.sh'), `#!/bin/bash\necho "verify-request $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'probe-review-state.sh'), `#!/bin/bash
set -euo pipefail
echo "probe $* skip=\${OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD:-0}" >> ${JSON.stringify(logFile)}
if [[ "\${PROBE_RETRY_EXPIRED:-0}" == "1" ]]; then
  printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig","requestState":"present-current-head","state":"waiting","requestAgeSeconds":901,"retryDue":false,"retryExpired":true}'
  exit 0
fi
printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig","requestState":"present-current-head","state":"waiting","requestAgeSeconds":60,"retryDue":false}'
`);
  makeExecutable(path.join(coreDir, 'check-review-clear-once.sh'), `#!/bin/bash
echo "check $*" >> ${JSON.stringify(logFile)}
case "\${CHECK_REVIEW_STATUS:-0}" in
  0) exit 0 ;;
  1) exit 1 ;;
  3) exit 3 ;;
  *) exit "\${CHECK_REVIEW_STATUS}" ;;
esac
`);
  makeExecutable(path.join(coreDir, 'request-pr-review.sh'), `#!/bin/bash\necho "request $*" >> ${JSON.stringify(logFile)}\n`);
  return { root, binDir, coreDir, repoDir, stateDir, logFile };
}

function run(envInfo, extraEnv = {}, args = ['--poll-once']) {
  return spawnSync(process.execPath, [helper, ...args], {
    cwd: envInfo.repoDir,
    env: {
      ...process.env,
      PATH: `${envInfo.binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: envInfo.coreDir,
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: envInfo.stateDir,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

{
  const envInfo = makeEnv('invalid-max');
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_LANES: '4' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /1 to 3/);
}

{
  const envInfo = makeEnv('claim-next');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /issue: 676/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /select excludes=\[\"675\"\]/);
  assert.match(log, /claim 676/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.ok(state.lanes.some((lane) => lane.issue === '676' && lane.stage === 'implementing'));
}

{
  const envInfo = makeEnv('local-only-selection-handoff');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    SELECT_LOCAL_ONLY: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: local-only$/m);
  assert.match(result.stdout, /change: local-change/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /select excludes=\[\]/);
  assert.doesNotMatch(log, /claim /);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.length, 0);
}

{
  const envInfo = makeEnv('done-lanes-do-not-block-no-available');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'done', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: no-available-changes$/m);
}

{
  const envInfo = makeEnv('blocked-lanes-block-no-available');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'blocked', blockedReason: 'needs human', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /^stage: blocked-lanes$/m);
  assert.match(result.stdout, /issue: 675/);
  assert.match(result.stdout, /blocked_reason: needs human/);
  assert.doesNotMatch(result.stdout, /^DONE/m);
}

{
  const envInfo = makeEnv('blocked-lane-does-not-stop-waiting-lane');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'blocked', blockedReason: 'needs human', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    SELECT_NONE: '1',
    CURRENT_BRANCH: 'dev1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  assert.doesNotMatch(result.stdout, /^stage: blocked-lanes$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707 skip=1/);
}

{
  const envInfo = makeEnv('implementing-lane-advances-to-review-yield');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const first = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(first.status, 0, first.stderr);
  const second = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^HANDOFF/m);
  assert.match(second.stdout, /^stage: review-yield$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /find-pr 676/);
  assert.match(log, /mark-review 676 708/);
  assert.match(log, /verify-claim --issue 676 --pr 708/);
  assert.match(log, /verify-request 708/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.equal(lane.head, 'head-2');
}

{
  const envInfo = makeEnv('dirty-foreground-lane-does-not-park');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
    BUDDY_FAKE_DIRTY: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /worktree is dirty/);
  assert.doesNotMatch(result.stdout, /^HANDOFF/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'implementing');
  assert.equal(lane.pr, '');
}

{
  const envInfo = makeEnv('foreground-lane-requires-own-branch');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /Switch to lane branch change-676/);
  assert.equal(fs.existsSync(envInfo.logFile), false);
}

{
  const envInfo = makeEnv('claim-next-review-yield');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-yield$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.equal(lane.head, 'head-2');
  assert.equal(lane.branch, 'change-676');
  assert.match(lane.reviewRequestedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('claim-next-review-yield-dirty-blocks');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
    BUDDY_FAKE_DIRTY: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /worktree is dirty/);
  assert.doesNotMatch(result.stdout, /^HANDOFF/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.some((lane) => lane.issue === '676'), false);
}

{
  const envInfo = makeEnv('review-yield-missing-pr-head-blocks');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const fakeState = path.join(envInfo.root, 'bad-driver-state.json');
  fs.writeFileSync(fakeState, JSON.stringify({
    issue: '676',
    change: 'change-676',
    stages: {
      issue_pr_bound: { issue: '676', headRefName: 'change-676' },
      review_requested: { at: '2026-06-27T00:00:00.000Z' },
    },
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-review-yield-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
console.log('DONE');
console.log('stage: review-yield');
console.log('state_file: ${fakeState}');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /without PR\/head receipt/);
  assert.doesNotMatch(result.stdout, /^HANDOFF/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.some((lane) => lane.issue === '676'), false);
}

{
  const envInfo = makeEnv('implementing-blocks-claim');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: implement-or-open-pr$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /find-pr 675/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
}

{
  const envInfo = makeEnv('poll-once');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '1', CURRENT_BRANCH: 'change-675' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /No lane changed/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707 skip=1/);
  assert.doesNotMatch(log, /check 707/);
}

{
  const envInfo = makeEnv('review-fix-reparks-after-single-driver');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'old-head', stage: 'review_fix', reviewRetryCount: 0 },
    ],
  }));
  const fakeState = path.join(envInfo.root, 'review-fix-driver-state.json');
  fs.writeFileSync(fakeState, JSON.stringify({
    issue: '675',
    pr: '707',
    change: 'change-675',
    head: 'head-new',
    stages: {
      issue_pr_bound: { issue: '675', pr: '707', head: 'head-new', headRefName: 'change-675' },
      review_requested: { at: '2026-06-27T00:00:00.000Z', head: 'head-new' },
    },
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-review-fix-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(envInfo.logFile)}, 'review-fix-context=' + (process.env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT || '') + '\\n');
fs.appendFileSync(${JSON.stringify(envInfo.logFile)}, 'driver-env issue=' + (process.env.OPENSPEC_BUDDY_AUTO_ISSUE || '') + ' pr=' + (process.env.OPENSPEC_BUDDY_AUTO_PR || '') + ' head=' + (process.env.OPENSPEC_BUDDY_AUTO_HEAD || '') + ' targetIssue=' + (process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '') + ' targetPr=' + (process.env.OPENSPEC_BUDDY_AUTO_TARGET_PR || '') + '\\n');
console.log('DONE');
console.log('stage: review-yield');
console.log('state_file: ${fakeState}');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    REVIEW_FIX_NEW_HEAD: 'head-new',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-yield$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /review-fix-context=1/);
  assert.match(log, /driver-env issue=675 pr=707 head=head-new targetIssue= targetPr=/);
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  assert.match(log, /verify-request 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].head, 'head-new');
}

{
  const envInfo = makeEnv('merge-ready-handoff-without-fake-done');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'merge_ready', reviewRetryCount: 0 },
    ],
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-should-not-run-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
throw new Error('merge_ready should hand off instead of running fake single driver');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge_ready$/m);
  assert.match(result.stdout, /Continue merge gates through buddy-auto-driver/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
}

{
  const envInfo = makeEnv('pooled-two-waiting');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'waiting_review', reviewRetryCount: 0, lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'dev1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707/);
  assert.match(log, /probe 708/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.deepEqual(state.lanes.map((lane) => lane.stage), ['waiting_review', 'waiting_review']);
}

{
  const envInfo = makeEnv('retry-expired');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      {
        id: 'issue-675',
        issue: '675',
        change: 'change-675',
        branch: 'change-675',
        pr: '707',
        head: 'head-1',
        stage: 'waiting_review',
        reviewRetryCount: 1,
        reviewRequestedAt: '2000-01-01T00:00:00.000Z',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '1',
    CURRENT_BRANCH: 'change-675',
    PROBE_RETRY_EXPIRED: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /retry window expired/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
}

console.log('buddy-auto-lane-driver tests passed');
