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
    if [[ "\${2:-}" == "HEAD" ]]; then printf 'head-1\\n'; exit 0; fi
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
    exit 0
    ;;
  switch)
    echo "switch \${2:-}" >> ${JSON.stringify(logFile)}
    exit 0
    ;;
  ls-remote)
    if [[ "\${4:-}" == "change-675" ]]; then printf 'head-1\\trefs/heads/change-675\\n'; exit 0; fi
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
if [[ "\${1:-}" == "pr" && "\${2:-}" == "view" ]]; then printf '%s\\n' '{"number":707,"state":"OPEN","headRefName":"change-675","headRefOid":"head-1"}'; exit 0; fi
echo "unexpected gh invocation: $*" >&2
exit 99
`);
  makeExecutable(path.join(coreDir, 'verify-bound-worktree.sh'), `#!/bin/bash\necho "verify-bound $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'select-next-change.sh'), `#!/bin/bash
set -euo pipefail
echo "select excludes=$(cat "\${OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE:?}")" >> ${JSON.stringify(logFile)}
printf '%s\\n' '{"selected":{"number":676,"title":"Next","change_id":"change-676","claim_branch":"change-676"}}'
`);
  makeExecutable(path.join(coreDir, 'claim-issue.sh'), `#!/bin/bash\necho "claim $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'find-issue-pr.sh'), `#!/bin/bash\necho "find-pr $*" >> ${JSON.stringify(logFile)}\nprintf '{"issue":%s,"pr":null,"reason":"no PR"}\\n' "$1"\n`);
  makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/bin/bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-claim-worktree.sh'), `#!/bin/bash\necho "verify-claim $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-current-head-review-request.sh'), `#!/bin/bash\necho "verify-request $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'probe-review-state.sh'), `#!/bin/bash
set -euo pipefail
echo "probe $*" >> ${JSON.stringify(logFile)}
if [[ "\${PROBE_RETRY_EXPIRED:-0}" == "1" ]]; then
  printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig","requestState":"present-current-head","state":"waiting","requestAgeSeconds":901,"retryDue":false,"retryExpired":true}'
  exit 0
fi
printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig","requestState":"present-current-head","state":"waiting","requestAgeSeconds":60,"retryDue":false}'
`);
  makeExecutable(path.join(coreDir, 'check-review-clear-once.sh'), `#!/bin/bash\necho "check $*" >> ${JSON.stringify(logFile)}\n`);
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
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: implementing/);
  assert.equal(fs.existsSync(envInfo.logFile), false);
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
  assert.match(log, /probe 707/);
  assert.doesNotMatch(log, /check 707/);
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
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, lastRequestState: 'present-current-head' },
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
