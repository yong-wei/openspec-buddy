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
  if (process.env.BUDDY_TEST_TRACE) console.error(`test:${name}`);
  const root = path.join(tmp, name);
  const binDir = path.join(root, 'bin');
  const coreDir = path.join(root, 'core');
  const repoDir = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const branchFile = path.join(root, 'current-branch.txt');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  const logFile = path.join(root, 'commands.log');
  makeExecutable(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "-C" ]]; then shift 2; fi
branch_file=${JSON.stringify(branchFile)}
current_branch="\${CURRENT_BRANCH:-dev1}"
if [[ -f "$branch_file" ]]; then current_branch="$(<"$branch_file")"; fi
case "\${1:-}" in
  rev-parse)
    if [[ "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
    if [[ "\${2:-}" == "HEAD" ]]; then
      if [[ -n "\${LOCAL_HEAD_675:-}" && "$current_branch" == "change-675" ]]; then printf '%s\\n' "\${LOCAL_HEAD_675}"; exit 0; fi
      if [[ -n "\${REVIEW_FIX_NEW_HEAD:-}" && "$current_branch" == "change-675" ]]; then printf '%s\\n' "\${REVIEW_FIX_NEW_HEAD}"; exit 0; fi
      if [[ "$current_branch" == "change-676" ]]; then printf 'head-2\\n'; else printf 'head-1\\n'; fi
      exit 0
    fi
    ;;
  merge-base)
    if [[ "\${2:-}" == "--is-ancestor" ]]; then
      if [[ "\${LOCAL_HEAD_675_NOT_AHEAD:-0}" == "1" && "$current_branch" == "change-675" ]]; then exit 1; fi
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
    if [[ "\${2:-}" == "--show-current" ]]; then printf '%s\\n' "$current_branch"; exit 0; fi
    ;;
  status)
    if [[ "\${BUDDY_FAKE_DIRTY:-0}" == "1" && "\${2:-}" == "--porcelain" ]]; then printf ' M dirty.txt\\n'; exit 0; fi
    exit 0
    ;;
  switch)
    echo "switch \${2:-}" >> ${JSON.stringify(logFile)}
    if [[ "\${SWITCH_FAIL_FOR:-}" == "\${2:-}" ]]; then
      echo "switch failed for \${2:-}" >&2
      exit 42
    fi
    printf '%s\\n' "\${2:-}" > "$branch_file"
    exit 0
    ;;
  ls-remote)
    if [[ "\${4:-}" == "change-675" ]]; then printf 'head-1\\trefs/heads/change-675\\n'; exit 0; fi
    if [[ "\${4:-}" == "change-676" ]]; then printf 'head-2\\trefs/heads/change-676\\n'; exit 0; fi
    exit 0
    ;;
  remote)
    if [[ "\${2:-}" == "get-url" ]]; then printf '%s\\n' "\${GIT_REMOTE_URL:-https://github.com/opt-de/major.git}"; exit 0; fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
`);
  makeExecutable(path.join(binDir, 'gh'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "api" && "\${2:-}" == repos/*/pulls/* ]]; then
  echo "pull-rest \${2:-}" >> ${JSON.stringify(logFile)}
  pr="\${2##*/}"
  if [[ "$pr" == "708" ]]; then
    printf '{"number":708,"state":"%s","head":{"ref":"%s","sha":"%s"}}\\n' "\${PR_708_STATE:-open}" "\${PR_708_BRANCH:-change-676}" "\${PR_708_HEAD:-head-2}"
  else
    printf '{"number":707,"state":"%s","head":{"ref":"%s","sha":"%s"}}\\n' "\${PR_707_STATE:-open}" "\${PR_707_BRANCH:-change-675}" "\${PR_707_HEAD:-head-1}"
  fi
  exit 0
fi
if [[ "\${1:-}" == "api" && "\${2:-}" == */issues/*/comments* ]]; then
  if [[ "\${RETRY_MARKER_EXISTS:-0}" == "1" ]]; then
    printf '%s\\n' '[{"created_at":"2026-06-28T00:00:00Z","body":"OpenSpec Buddy review retry\\nlane_id: issue-675\\nhead: head-1\\nretry_round: 1"}]'
  else
    printf '[]\\n'
  fi
  exit 0
fi
if [[ "\${1:-}" == "pr" && "\${2:-}" == "view" ]]; then
  if [[ "\${PR_707_TRUTH_EOF_ONCE:-0}" == "1" && "\${3:-}" == "707" ]]; then
    marker=${JSON.stringify(root)}"/pr-707-truth-eof-once"
    if [[ ! -f "$marker" ]]; then
      touch "$marker"
      echo "GitHub API EOF" >&2
      exit 1
    fi
  fi
  if [[ "\${PR_707_TRUTH_EOF_ALWAYS:-0}" == "1" && "\${3:-}" == "707" ]]; then
    echo "GitHub API EOF" >&2
    exit 1
  fi
  if [[ " $* " == *" --jq .headRefOid "* ]]; then
    case "\${3:-}" in
      708) printf '%s\\n' "\${PR_708_HEAD:-head-2}"; exit 0 ;;
      *) printf '%s\\n' "\${PR_707_HEAD:-\${REVIEW_FIX_NEW_HEAD:-head-1}}"; exit 0 ;;
    esac
  fi
  case "\${3:-}" in
    708) printf '{"number":708,"state":"%s","headRefName":"%s","headRefOid":"%s","mergedAt":%s}\\n' "\${PR_708_STATE:-OPEN}" "\${PR_708_BRANCH:-change-676}" "\${PR_708_HEAD:-head-2}" "\${PR_708_MERGED_AT:-null}"; exit 0 ;;
    *) printf '{"number":707,"state":"%s","headRefName":"%s","headRefOid":"%s","mergedAt":%s}\\n' "\${PR_707_STATE:-OPEN}" "\${PR_707_BRANCH:-change-675}" "\${PR_707_HEAD:-\${REVIEW_FIX_NEW_HEAD:-head-1}}" "\${PR_707_MERGED_AT:-null}"; exit 0 ;;
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
  makeExecutable(path.join(coreDir, 'release-claim.sh'), `#!/bin/bash\necho "release $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'find-issue-pr.sh'), `#!/bin/bash
set -euo pipefail
echo "find-pr $*" >> ${JSON.stringify(logFile)}
if [[ "\${FIND_PR_FOR_676:-0}" == "1" && "\${1:-}" == "676" ]]; then
  printf '%s\\n' '{"issue":"676","pr":"708","head":"head-2","headRefOid":"head-2","headRefName":"change-676","url":"https://github.test/pull/708","reason":"exact PR"}'
  exit 0
fi
printf '{"issue":%s,"pr":null,"reason":"no PR"}\\n' "$1"
`);
  makeExecutable(path.join(coreDir, 'mark-in-progress.sh'), `#!/bin/bash\necho "mark-in-progress $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/bin/bash
echo "mark-review $*" >> ${JSON.stringify(logFile)}
if [[ "\${MARK_REVIEW_FAIL_FOR:-}" == "\${1:-}" ]]; then
  echo "mark-review failed for \${1:-}" >&2
  exit 42
fi
`);
  makeExecutable(path.join(coreDir, 'verify-claim-worktree.sh'), `#!/bin/bash
echo "verify-claim $*" >> ${JSON.stringify(logFile)}
if [[ "\${CLAIM_GUARD_FAIL:-0}" == "1" ]]; then
  echo "foreign claim" >&2
  exit 42
fi
`);
  makeExecutable(path.join(coreDir, 'verify-current-head-review-request.sh'), `#!/bin/bash\necho "verify-request $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'probe-review-state.sh'), `#!/bin/bash
set -euo pipefail
echo "probe $* skip=\${OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD:-0}" >> ${JSON.stringify(logFile)}
	if [[ "\${PROBE_EOF:-0}" == "1" || "\${PROBE_EOF_FOR:-}" == "\${1:-}" ]]; then
	  echo "GitHub API EOF" >&2
	  exit 1
	fi
if [[ "\${PROBE_AUTH_FOR:-}" == "\${1:-}" ]]; then
  echo "HTTP 401 Unauthorized" >&2
  exit 1
fi
if [[ "\${PROBE_EMPTY_FOR:-}" == "\${1:-}" ]]; then
  exit 0
fi
if [[ "\${PROBE_CHANGED_RETRY_EXPIRED_FOR:-}" == "\${1:-}" ]]; then
  printf '%s\\n' '{"pr":"707","head":"head-1","signature":"new-sig","requestState":"present-current-head","state":"changed","requestAgeSeconds":901,"retryDue":false,"retryExpired":true,"clearCandidate":false}'
  exit 0
fi
if [[ "\${PROBE_RETRY_EXPIRED:-0}" == "1" || "\${PROBE_RETRY_EXPIRED_FOR:-}" == "\${1:-}" ]]; then
  printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig","requestState":"present-current-head","state":"waiting","requestAgeSeconds":901,"retryDue":false,"retryExpired":true,"clearCandidate":false}'
  exit 0
fi
	pr="\${1:-707}"
	if [[ "$pr" == "708" ]]; then
	  printf '{"pr":"708","head":"%s","signature":"%s","requestState":"%s","state":"%s","requestAgeSeconds":60,"retryDue":false,"clearCandidate":%s}\\n' "\${PROBE_HEAD_708:-head-2}" "\${PROBE_SIGNATURE_708:-sig-708}" "\${PROBE_REQUEST_STATE_708:-present-current-head}" "\${PROBE_STATE_708:-waiting}" "\${PROBE_CLEAR_CANDIDATE_708:-false}"
	else
	  printf '{"pr":"707","head":"%s","signature":"%s","requestState":"%s","state":"%s","requestAgeSeconds":%s,"retryDue":%s,"clearCandidate":%s}\\n' "\${PROBE_HEAD_707:-head-1}" "\${PROBE_SIGNATURE_707:-sig}" "\${PROBE_REQUEST_STATE_707:-present-current-head}" "\${PROBE_STATE_707:-waiting}" "\${PROBE_AGE_707:-60}" "\${PROBE_RETRY_DUE_707:-false}" "\${PROBE_CLEAR_CANDIDATE_707:-false}"
	fi
`);
  makeExecutable(path.join(coreDir, 'check-review-clear-once.sh'), `#!/bin/bash
echo "check $*" >> ${JSON.stringify(logFile)}
if [[ -n "\${CHECK_REVIEW_STDERR:-}" ]]; then
  echo "\${CHECK_REVIEW_STDERR}" >&2
fi
case "\${CHECK_REVIEW_STATUS:-0}" in
  0) exit 0 ;;
  1) exit 1 ;;
  3) exit 3 ;;
  *) exit "\${CHECK_REVIEW_STATUS}" ;;
esac
`);
  makeExecutable(path.join(coreDir, 'request-pr-review.sh'), `#!/bin/bash\necho "request $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-achieved-truth.mjs'), `#!/bin/bash
echo "verify-achieved-truth $*" >> ${JSON.stringify(logFile)}
if [[ "\${ACHIEVED_TRUTH_NEXT_POST_MERGE:-0}" == "1" ]]; then
  marker=${JSON.stringify(root)}"/achieved-truth-post-merge-once"
  if [[ ! -f "$marker" ]]; then
    touch "$marker"
    printf '%s\\n' '{"achieved":false,"next":"mark-achieved-post-merge","reason":"needs post merge sync","archivePath":"openspec/archive/change-675"}'
    exit 0
  fi
fi
printf '%s\\n' '{"achieved":true,"reason":"terminal truth satisfied"}'
`);
  makeExecutable(path.join(coreDir, 'mark-achieved-post-merge.sh'), `#!/bin/bash
echo "mark-achieved-post-merge $*" >> ${JSON.stringify(logFile)}
`);
  const singleDriver = path.join(root, 'fake-single-driver.mjs');
  fs.writeFileSync(singleDriver, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const issue = process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || process.env.OPENSPEC_BUDDY_AUTO_ISSUE || '';
const pr = process.env.OPENSPEC_BUDDY_AUTO_PR || '';
fs.appendFileSync(${JSON.stringify(logFile)}, 'driver-env targetIssue=' + (process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '') + ' targetPr=' + (process.env.OPENSPEC_BUDDY_AUTO_TARGET_PR || '') + ' lanePr=' + (process.env.OPENSPEC_BUDDY_AUTO_PR || '') + ' head=' + (process.env.OPENSPEC_BUDDY_AUTO_HEAD || '') + ' change=' + (process.env.OPENSPEC_BUDDY_AUTO_CHANGE || '') + ' changeId=' + (process.env.OPENSPEC_BUDDY_AUTO_CHANGE_ID || '') + ' reviewFix=' + (process.env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT || '') + '\\n');
if (process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE) {
  fs.appendFileSync(${JSON.stringify(logFile)}, 'claim ' + process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE + '\\n');
}
if ((issue === '676' || pr === '708') && process.env.FIND_PR_FOR_676 === '1') {
  fs.appendFileSync(${JSON.stringify(logFile)}, 'find-pr ' + (issue || '676') + '\\n');
  fs.appendFileSync(${JSON.stringify(logFile)}, 'mark-review 676 708\\n');
  fs.writeFileSync(${JSON.stringify(branchFile)}, 'change-676\\n');
  const stateFile = path.join(${JSON.stringify(root)}, 'fake-driver-state-' + process.pid + '.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    issue: '676',
    pr: '708',
    change: 'change-676',
    head: 'head-2',
    stages: {
      issue_pr_bound: { issue: '676', pr: '708', head: 'head-2', headRefName: 'change-676' },
      mark_review_passed: { at: new Date().toISOString(), pr: process.env.DRIVER_MARK_REVIEW_PR || '708', head: 'head-2' },
      review_requested: { at: new Date().toISOString(), head: process.env.DRIVER_REVIEW_REQUEST_HEAD || 'head-2' },
    },
  }));
  console.log('DONE');
  console.log('stage: review-yield');
  console.log('state_file: ' + stateFile);
} else {
  console.log('HANDOFF');
  console.log('stage: implement-or-open-pr');
}
`, { mode: 0o755 });
  return { root, binDir, coreDir, repoDir, stateDir, logFile, singleDriver, branchFile };
}

function run(envInfo, extraEnv = {}, args = ['--poll-once']) {
  if (extraEnv.CURRENT_BRANCH) {
    fs.writeFileSync(envInfo.branchFile, `${extraEnv.CURRENT_BRANCH}\n`);
  } else {
    fs.rmSync(envInfo.branchFile, { force: true });
  }
  return spawnSync(process.execPath, [helper, ...args], {
    cwd: envInfo.repoDir,
    timeout: 20000,
    env: {
      ...process.env,
      PATH: `${envInfo.binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: envInfo.coreDir,
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: envInfo.stateDir,
      OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: envInfo.singleDriver,
      OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1',
      OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS: '10000',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function normalizedLane(overrides) {
  return {
    id: '', issue: '', change: '', branch: '', pr: '', head: '', stage: '', claimId: '',
    reviewRequestedAt: '', reviewRetryCount: 0, lastProbeAt: '', lastSignature: '',
    lastRequestState: '', lastResult: '', probeState: '', requestState: '', actionableState: '',
    threadState: '', restFreshAt: '', threadsFreshAt: '', threadsHead: '',
    reviewStatusSyncedAt: '', blockedReason: '', retryableStage: '', retryableHead: '',
    retryableSince: '', retryAttempts: 0, updatedAt: '', ...overrides,
  };
}

{
  const envInfo = makeEnv('invalid-max');
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_LANES: '4' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /1 to 3/);
}

{
  const envInfo = makeEnv('waiting-review-status-sync-before-claim');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: implement-or-open-pr$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /mark-review 675 707/);
  assert.match(log, /select excludes=\["675"\]/);
  assert.match(log, /claim 676/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '675');
  assert.match(lane.reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('waiting-review-sync-returns-bound-before-claim');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'dev1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: implement-or-open-pr$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.match(log, /mark-review 675 707/);
  assert.match(log, /switch dev1/);
  assert.ok(log.indexOf('switch dev1') > log.indexOf('mark-review 675 707'));
  assert.match(log, /select excludes=\["675"\]/);
  assert.match(log, /claim 676/);
}

{
  const envInfo = makeEnv('claim-next');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /issue: 676/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /select excludes=\[\"675\"\]/);
  assert.doesNotMatch(log, /mark-review 675 707/);
  assert.match(log, /claim 676/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.ok(state.lanes.some((lane) => lane.issue === '676' && lane.stage === 'implementing'));
}

{
  const envInfo = makeEnv('waiting-review-mark-review-failure-blocks-new-claim');
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
    CURRENT_BRANCH: 'dev1',
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '676',
    MARK_REVIEW_FAIL_FOR: '675',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /^stage: mark-review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /mark-review 675 707/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '675');
  assert.equal(lane.stage, 'blocked');
  assert.match(lane.blockedReason, /mark-review failed/);
}

{
  const envInfo = makeEnv('claim-next-clears-inherited-target-pr');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    OPENSPEC_BUDDY_AUTO_TARGET_PR: '707',
    OPENSPEC_BUDDY_AUTO_PR: '707',
    OPENSPEC_BUDDY_AUTO_HEAD: 'head-1',
    OPENSPEC_BUDDY_AUTO_CHANGE: 'change-675',
    OPENSPEC_BUDDY_AUTO_CHANGE_ID: 'change-675',
    OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT: '1',
    CURRENT_BRANCH: 'dev1',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /driver-env targetIssue=676 targetPr= lanePr= head= change= changeId= reviewFix=/);
  assert.match(log, /claim 676/);
}

{
  const envInfo = makeEnv('target-pr-rest-supports-dotted-repo-name');
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
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '676',
    OPENSPEC_BUDDY_AUTO_TARGET_PR: '708',
    GIT_REMOTE_URL: 'https://github.com/opt-de/foo.bar.git',
    FIND_PR_FOR_676: '1',
    CURRENT_BRANCH: 'dev1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /pull-rest repos\/opt-de\/foo\.bar\/pulls\/708/);
  assert.match(log, /driver-env targetIssue= targetPr= lanePr=708/);
  assert.equal((log.match(/^mark-review 676 708$/gm) || []).length, 1, log);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.match(lane.reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('target-lane-mismatched-receipt-retains-mark-review-fallback');
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
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '676',
    OPENSPEC_BUDDY_AUTO_TARGET_PR: '708',
    FIND_PR_FOR_676: '1',
    DRIVER_MARK_REVIEW_PR: '999',
    CURRENT_BRANCH: 'dev1',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/^mark-review 676 708$/gm) || []).length, 2, log);
}

{
  const envInfo = makeEnv('local-only-selection-handoff');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
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
    OPENSPEC_BUDDY_AUTO_LANES: '1',
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
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '', head: '', stage: 'blocked', blockedReason: 'needs human', reviewRetryCount: 0 },
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
  assert.match(result.stdout, /blocked_reason: no PR/);
  assert.doesNotMatch(result.stdout, /^DONE/m);
}

{
  const envInfo = makeEnv('only-blocked-full-capacity');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '', head: '', stage: 'blocked', blockedReason: 'needs human', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /^stage: blocked-lanes$/m);
  const log = fs.existsSync(envInfo.logFile) ? fs.readFileSync(envInfo.logFile, 'utf8') : '';
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim /);
}

{
  const envInfo = makeEnv('blocked-lane-does-not-stop-waiting-lane');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'blocked', blockedReason: 'needs human', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
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
  const envInfo = makeEnv('owned-blocked-lane-reserves-capacity');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'blocked', blockedReason: 'GitHub API EOF', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707 skip=1/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
}

{
  const envInfo = makeEnv('probe-eof-becomes-retryable-blocked');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_EOF: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /GitHub API EOF/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'retryable_blocked');
  assert.match(state.lanes[0].retryableSince, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(state.lanes[0].retryAttempts, 1);
}

{
  const envInfo = makeEnv('probe-empty-output-becomes-retryable-blocked');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_EMPTY_FOR: '707',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /probe-review-state.sh returned invalid JSON/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'retryable_blocked');
  assert.equal(state.lanes[0].retryAttempts, 1);
}

{
  const envInfo = makeEnv('probe-auth-failure-becomes-terminal-blocked');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_AUTH_FOR: '707',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /HTTP 401 Unauthorized/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
  assert.equal(state.lanes[0].retryAttempts || 0, 0);
}

{
  const envInfo = makeEnv('request-missing-unknown-thread-truth-deep-checks');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_STATE_707: 'request_missing',
    PROBE_REQUEST_STATE_707: 'missing-current-head',
    CHECK_REVIEW_STATUS: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /check 707/);
  assert.doesNotMatch(log, /^request 707/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
}

{
  const envInfo = makeEnv('request-missing-clear-thread-truth-requests-review');
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
        reviewRetryCount: 0,
        lastRequestState: 'present-current-head',
        threadState: 'clear',
        actionableState: 'clear',
        threadsHead: 'head-1',
        threadsFreshAt: '2026-06-30T00:00:00.000Z',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_STATE_707: 'request_missing',
    PROBE_REQUEST_STATE_707: 'missing-current-head',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  assert.match(log, /request 707 --force/);
  assert.doesNotMatch(log, /check 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].lastRequestState, 'present-current-head');
  assert.match(state.lanes[0].reviewRequestedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('waiting-review-merged-pr-becomes-merge-ready-before-probe');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'old-head', stage: 'waiting_review', reviewRetryCount: 1, lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PR_707_STATE: 'MERGED',
    PR_707_HEAD: 'merged-head',
    PR_707_MERGED_AT: '"2026-06-28T00:00:00Z"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  const log = fs.existsSync(envInfo.logFile) ? fs.readFileSync(envInfo.logFile, 'utf8') : '';
  assert.doesNotMatch(log, /probe 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
  assert.equal(state.lanes[0].head, 'merged-head');
  assert.equal(state.lanes[0].lastResult, 'pr-truth-merged');
}

{
  const envInfo = makeEnv('reconcile-waiting-review-merged-pr-becomes-merge-ready');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'old-head', stage: 'waiting_review', reviewRetryCount: 1, lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PR_707_STATE: 'MERGED',
    PR_707_HEAD: 'merged-head',
    PR_707_MERGED_AT: '"2026-06-28T00:00:00Z"',
  }, ['--reconcile']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  const log = fs.existsSync(envInfo.logFile) ? fs.readFileSync(envInfo.logFile, 'utf8') : '';
  assert.doesNotMatch(log, /probe 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
  assert.equal(state.lanes[0].head, 'merged-head');
  assert.equal(state.lanes[0].lastResult, 'pr-truth-merged');
}

{
  const envInfo = makeEnv('merge-ready-merged-pr-completes-post-merge-without-mark-review');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'merged-head', stage: 'merge_ready', reviewRetryCount: 1, lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PR_707_STATE: 'MERGED',
    PR_707_HEAD: 'merged-head',
    PR_707_MERGED_AT: '"2026-06-28T00:00:00Z"',
    ACHIEVED_TRUTH_NEXT_POST_MERGE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: lane-done$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /verify-bound --phase goal-loop-start/);
  assert.match(log, /verify-achieved-truth 675 707/);
  assert.match(log, /mark-achieved-post-merge 675 openspec\/archive\/change-675 707/);
  assert.doesNotMatch(log, /mark-review 675 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'done');
  assert.equal(state.lanes[0].lastResult, 'mark-achieved-post-merge');
}

{
  const envInfo = makeEnv('local-head-ahead-becomes-review-fix');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-fix$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'review_fix');
  assert.equal(state.lanes[0].head, 'new-local-head');
}

{
  const envInfo = makeEnv('local-head-ahead-becomes-review-fix-at-full-capacity');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-fix$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'review_fix');
  assert.equal(state.lanes[0].head, 'new-local-head');
}

{
  const envInfo = makeEnv('local-head-ahead-requires-open-pr-truth');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
    PR_707_STATE: 'CLOSED',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.doesNotMatch(result.stdout, /^stage: review-fix$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
  assert.equal(state.lanes[0].head, 'head-1');
}

{
  const envInfo = makeEnv('local-head-ahead-requires-pr-branch-match');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
    PR_707_BRANCH: 'other-branch',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.doesNotMatch(result.stdout, /^stage: review-fix$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
  assert.equal(state.lanes[0].head, 'head-1');
}

{
  const envInfo = makeEnv('local-head-ahead-requires-ancestor-proof');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'old-local-head',
    LOCAL_HEAD_675_NOT_AHEAD: '1',
    PR_707_HEAD: 'head-1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.doesNotMatch(result.stdout, /^stage: review-fix$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
  assert.equal(state.lanes[0].head, 'head-1');
}

{
  const envInfo = makeEnv('local-head-ahead-does-not-bypass-claim-guard');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'review_fix', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
    CLAIM_GUARD_FAIL: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /foreign claim/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
}

{
  const envInfo = makeEnv('retryable-blocked-local-head-ahead-does-not-bypass-claim-guard');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'retryable_blocked', blockedReason: 'GitHub API EOF', retryAttempts: 1 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
    CLAIM_GUARD_FAIL: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /foreign claim/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
}

{
  const envInfo = makeEnv('transient-pr-truth-failure-is-not-cached');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675a', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'retryable_blocked', blockedReason: 'GitHub API EOF', retryAttempts: 1 },
      { id: 'issue-675b', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'retryable_blocked', blockedReason: 'GitHub API EOF', retryAttempts: 1 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    PR_707_HEAD: 'head-1',
    PR_707_TRUTH_EOF_ONCE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'retryable_blocked');
  assert.equal(state.lanes[1].stage, 'waiting_review');
  assert.equal(state.lanes[1].blockedReason || '', '');
  assert.equal(state.lanes[1].retryAttempts || 0, 0);
}

{
  const envInfo = makeEnv('head-changed-current-head-self-heals');
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
        head: 'old-head',
        stage: 'waiting_review',
        reviewRetryCount: 1,
        lastRequestState: 'present-current-head',
        reviewRequestedAt: '2026-06-27T00:00:00.000Z',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_STATE_707: 'head_changed',
    PROBE_HEAD_707: 'new-head',
    PROBE_SIGNATURE_707: 'new-sig',
    PROBE_REQUEST_STATE_707: 'present-current-head',
    LOCAL_HEAD_675: 'new-head',
    PR_707_HEAD: 'new-head',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  assert.doesNotMatch(result.stdout, /^BLOCKED/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /check 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
  assert.equal(state.lanes[0].head, 'new-head');
  assert.equal(state.lanes[0].lastSignature, 'new-sig');
}

{
  const envInfo = makeEnv('probe-eof-does-not-stop-other-waiting-lane');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    PROBE_EOF_FOR: '707',
    PROBE_STATE_708: 'changed',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const first = state.lanes.find((lane) => lane.issue === '675');
  const second = state.lanes.find((lane) => lane.issue === '676');
  assert.equal(first.stage, 'retryable_blocked');
  assert.equal(second.stage, 'merge_ready');
}

{
  const envInfo = makeEnv('release-lane-command');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'blocked', blockedReason: 'misclaim', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
  }, ['--release-lane', '675', '--reason', 'misclaimed']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: release-lane$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /release 675 --clear-lane --reason misclaimed/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim /);
}

{
  const envInfo = makeEnv('transient-blocked-bridges-existing-pr');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '', head: '', stage: 'blocked', blockedReason: 'GitHub GraphQL EOF', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /find-pr 676/);
  assert.match(log, /probe 708 skip=1/);
  assert.doesNotMatch(log, /select excludes=/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes[0];
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.equal(lane.head, 'head-2');
  assert.equal(lane.blockedReason, '');
}

{
  const envInfo = makeEnv('implementing-lane-advances-to-review-yield');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
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
  assert.match(second.stdout, /^DONE/m);
  assert.match(second.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /find-pr 676/);
  assert.equal(
    (log.match(/^mark-review 676 708$/gm) || []).length,
    1,
    log,
  );
  assert.match(log, /verify-claim --issue 676 --pr 708/);
  assert.match(log, /verify-request 708/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.equal(lane.head, 'head-2');
  assert.match(lane.reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('mismatched-review-receipt-retains-mark-review-fallback');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const first = run(envInfo, { OPENSPEC_BUDDY_AUTO_GOAL: '1', OPENSPEC_BUDDY_AUTO_LANES: '2', CURRENT_BRANCH: 'change-675' });
  assert.equal(first.status, 0, first.stderr);
  const second = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
    DRIVER_MARK_REVIEW_PR: '999',
  });
  assert.equal(second.status, 0, second.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/^mark-review 676 708$/gm) || []).length, 2, log);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.match(state.lanes.find((candidate) => candidate.issue === '676').reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
}

{
  const envInfo = makeEnv('parking-lane-continues-owned-lane-before-new-claim');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 3,
    lanes: [
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing', reviewRetryCount: 0 },
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '3',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.doesNotMatch(result.stdout, /Switch to lane branch/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /mark-review 676 708/);
  assert.match(log, /switch change-675/);
  assert.ok(log.indexOf('switch change-675') > log.indexOf('mark-review 676 708'));
  assert.doesNotMatch(log, /probe 707/);
  assert.doesNotMatch(log, /probe 708/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.find((candidate) => candidate.issue === '676').stage, 'waiting_review');
  assert.match(state.lanes.find((candidate) => candidate.issue === '676').reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(state.lanes.find((candidate) => candidate.issue === '675').stage, 'implementing');
}

{
  const envInfo = makeEnv('dirty-owned-lane-resume-blocks-before-switch-or-probes');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  const initialLanes = [
    normalizedLane({ id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' }),
    normalizedLane({ id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing' }),
  ];
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: initialLanes,
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    BUDDY_FAKE_DIRTY: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /worktree is dirty/);
  const log = fs.existsSync(envInfo.logFile) ? fs.readFileSync(envInfo.logFile, 'utf8') : '';
  assert.doesNotMatch(log, /switch change-676/);
  assert.doesNotMatch(log, /driver-env/);
  assert.doesNotMatch(log, /probe 707/);
  assert.doesNotMatch(log, /probe 708/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.deepEqual(state.lanes, initialLanes);
}

{
  const envInfo = makeEnv('claim-failed-owned-lane-resume-restores-original-branch');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  const initialLanes = [
    normalizedLane({ id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' }),
    normalizedLane({ id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'implementing' }),
  ];
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: initialLanes,
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    CLAIM_GUARD_FAIL: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /foreign claim/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-676/);
  assert.match(log, /switch change-675/);
  assert.ok(log.indexOf('switch change-675') > log.indexOf('switch change-676'), log);
  assert.doesNotMatch(log, /driver-env/);
  assert.doesNotMatch(log, /probe 707/);
  assert.doesNotMatch(log, /probe 708/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
  assert.equal(fs.readFileSync(envInfo.branchFile, 'utf8').trim(), 'change-675');
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.deepEqual(state.lanes, initialLanes);
}

{
  const envInfo = makeEnv('failed-original-branch-restore-is-reported');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  const initialLanes = [
    normalizedLane({ id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' }),
    normalizedLane({ id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'implementing' }),
  ];
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: initialLanes,
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    CLAIM_GUARD_FAIL: '1',
    SWITCH_FAIL_FOR: 'change-675',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /foreign claim/);
  assert.match(result.stdout, /failed to restore original branch change-675/i);
  assert.match(result.stdout, /switch failed for change-675/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-676/);
  assert.match(log, /switch change-675/);
  assert.doesNotMatch(log, /driver-env/);
  assert.doesNotMatch(log, /probe 707/);
  assert.doesNotMatch(log, /probe 708/);
  assert.doesNotMatch(log, /select excludes=/);
  assert.doesNotMatch(log, /claim 676/);
  assert.equal(fs.readFileSync(envInfo.branchFile, 'utf8').trim(), 'change-676');
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.deepEqual(state.lanes, initialLanes);
}

{
  const envInfo = makeEnv('owned-lane-wrong-head-preserves-review-fix-normalization');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    LOCAL_HEAD_675: 'new-local-head',
    PR_707_HEAD: 'head-1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-fix$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.doesNotMatch(log, /switch dev1/);
  assert.doesNotMatch(log, /driver-env/);
  assert.doesNotMatch(log, /probe 707/);
  assert.equal(fs.readFileSync(envInfo.branchFile, 'utf8').trim(), 'change-675');
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'review_fix');
  assert.equal(state.lanes[0].head, 'new-local-head');
  assert.equal(state.lanes[0].lastResult, 'local-review-fix-head-detected');
}

{
  const envInfo = makeEnv('waiting-review-poll-once-probes-once');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'dev1',
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/probe 707/g) || []).length, 1);
}

{
  const envInfo = makeEnv('waiting-review-baseline-review-activity-enters-review-fix');
  const signature = JSON.stringify({
    reviews: 1,
    reviewComments: 0,
    latestReviewSubmittedAt: '2026-06-28T00:00:00Z',
  });
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head', lastSignature: signature },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_SIGNATURE_707: signature.replaceAll('"', '\\"'),
    CHECK_REVIEW_STATUS: '3',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-fix$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707/);
  assert.match(log, /check 707/);
  assert.match(log, /mark-in-progress 675/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'review_fix');
}

{
  const envInfo = makeEnv('waiting-review-waiting-allows-foreground-implementing');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/probe 707/g) || []).length, 1);
  assert.match(log, /find-pr 676/);
  assert.match(log, /mark-review 676 708/);
}

{
  const envInfo = makeEnv('waiting-review-does-not-preempt-foreground-implementing');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', stage: 'implementing', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    PROBE_STATE_707: 'review_returned',
    PROBE_SIGNATURE_707: 'reviewed-sig',
    CHECK_REVIEW_STATUS: '3',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: review-fix$/m);
  assert.match(result.stdout, /^issue: 675$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  const markIndex = log.indexOf('mark-review 676 708');
  const probeIndex = log.indexOf('probe 707');
  assert.notEqual(markIndex, -1, log);
  assert.notEqual(probeIndex, -1, log);
  assert.ok(markIndex < probeIndex, log);
  assert.match(log, /probe 707/);
  assert.match(log, /check 707/);
  assert.match(log, /mark-in-progress 675/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.find((candidate) => candidate.issue === '675').stage, 'review_fix');
  assert.equal(state.lanes.find((candidate) => candidate.issue === '676').stage, 'waiting_review');
}

{
  const envInfo = makeEnv('waiting-review-sync-returns-bound-before-target-recovery');
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
    CURRENT_BRANCH: 'dev1',
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '676',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: implement-or-open-pr$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.match(log, /mark-review 675 707/);
  assert.match(log, /switch dev1/);
  assert.ok(log.indexOf('switch dev1') > log.indexOf('mark-review 675 707'));
  assert.ok(log.indexOf('driver-env targetIssue=676') > log.indexOf('switch dev1'));
}

{
  const envInfo = makeEnv('full-capacity-target-does-not-bypass-waiting-review-sync');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '676',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.doesNotMatch(log, /driver-env targetIssue=676/);
  assert.doesNotMatch(log, /claim 676/);
  assert.match(log, /probe 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes.length, 1);
  assert.equal(state.lanes[0].issue, '675');
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
  assert.match(result.stdout, /^DONE/m);
  assert.doesNotMatch(result.stdout, /Switch to lane branch/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-676/);
  assert.match(log, /driver-env/);
}

{
  const envInfo = makeEnv('claim-next-review-yield');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  const lane = state.lanes.find((candidate) => candidate.issue === '676');
  assert.equal(lane.stage, 'waiting_review');
  assert.equal(lane.pr, '708');
  assert.equal(lane.head, 'head-2');
  assert.equal(lane.branch, 'change-676');
  assert.match(lane.reviewRequestedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(lane.reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/^mark-review 676 708$/gm) || []).length, 1, log);
  assert.equal((log.match(/^verify-claim --issue 676 --pr 708$/gm) || []).length, 1, log);
  assert.equal((log.match(/^verify-request 708$/gm) || []).length, 1, log);
}

{
  const envInfo = makeEnv('just-parked-marker-does-not-skip-other-lane');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 3,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-676', pr: '707', head: 'head-2', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '3',
    CURRENT_BRANCH: 'change-675',
    FIND_PR_FOR_676: '1',
    PR_707_BRANCH: 'change-676',
    PR_707_HEAD: 'head-2',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/^verify-claim --issue 676 --pr 708$/gm) || []).length, 1, log);
  assert.equal((log.match(/^verify-request 708$/gm) || []).length, 1, log);
  assert.equal((log.match(/^verify-claim --issue 675 --pr 707$/gm) || []).length, 1, log);
  assert.equal((log.match(/^verify-request 707$/gm) || []).length, 1, log);
}

{
  const envInfo = makeEnv('new-lane-mismatched-receipt-retains-mark-review-fallback');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
    DRIVER_MARK_REVIEW_PR: '999',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal((log.match(/^mark-review 676 708$/gm) || []).length, 2, log);
}

{
  const envInfo = makeEnv('claim-next-review-yield-dirty-blocks');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
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
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z' },
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
  const log = fs.existsSync(envInfo.logFile) ? fs.readFileSync(envInfo.logFile, 'utf8') : '';
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
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
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

for (const receiptCase of [
  { name: 'valid', markReviewPr: '708', expectedMarkReviewCount: 1 },
  { name: 'mismatched', markReviewPr: '999', expectedMarkReviewCount: 2 },
]) {
  const envInfo = makeEnv(`resumed-lane-${receiptCase.name}-receipt-coordination-count`);
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'review_fix', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-676',
    FIND_PR_FOR_676: '1',
    DRIVER_MARK_REVIEW_PR: receiptCase.markReviewPr,
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.equal(
    (log.match(/^mark-review 676 708$/gm) || []).length,
    receiptCase.expectedMarkReviewCount,
    log,
  );
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.match(state.lanes[0].reviewStatusSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
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
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /review-fix-context=1/);
  assert.match(log, /driver-env issue=675 pr=707 head=head-new targetIssue= targetPr=/);
  assert.match(log, /mark-review 675 707/);
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  assert.match(log, /verify-request 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].head, 'head-new');
}

{
  const envInfo = makeEnv('review-fix-handoff-without-actionable-reparks');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'old-head', stage: 'review_fix', reviewRetryCount: 0 },
    ],
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-review-fix-handoff-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(envInfo.logFile)}, 'review-fix-context=' + (process.env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT || '') + '\\n');
console.log('HANDOFF');
console.log('stage: review-fix');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    REVIEW_FIX_NEW_HEAD: 'head-new',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
    CHECK_REVIEW_STATUS: '1',
    SELECT_NONE: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: waiting_review$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /review-fix-context=1/);
  assert.match(log, /check 707/);
  assert.match(log, /mark-review 675 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].head, 'head-new');
}

{
  const envInfo = makeEnv('review-returned-marks-in-progress');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'review_returned', reviewRetryCount: 0 },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    CHECK_REVIEW_STATUS: '3',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /mark-in-progress 675/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'review_fix');
}

{
  const envInfo = makeEnv('merge-ready-open-pr-runs-single-driver');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'merge_ready', reviewRetryCount: 0 },
    ],
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-merge-ready-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(envInfo.logFile)}, 'single-driver-merge-ready ' + (process.env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE || '') + '\\n');
console.log('HANDOFF');
console.log('stage: merge-pr');
console.log('required_action: merge PR through controller-owned gate');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    CURRENT_BRANCH: 'change-675',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-pr$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  assert.match(log, /single-driver-merge-ready verify-once/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
}

{
  const envInfo = makeEnv('merge-ready-pr-truth-retry-preserves-stage');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'merge_ready', reviewRetryCount: 0 },
    ],
  }));
  const first = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PR_707_TRUTH_EOF_ALWAYS: '1',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^BLOCKED/m);
  let state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'retryable_blocked');
  assert.equal(state.lanes[0].retryableStage, 'merge_ready');
  assert.equal(state.lanes[0].retryableHead, 'head-1');

  const second = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^DONE/m);
  state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
  assert.equal(state.lanes[0].retryableStage || '', '');
}

{
  const envInfo = makeEnv('merge-ready-pr-truth-retry-head-change-waits-review');
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
        stage: 'retryable_blocked',
        blockedReason: 'GitHub API EOF',
        retryAttempts: 1,
        retryableStage: 'merge_ready',
        retryableHead: 'head-1',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'dev1',
    PR_707_HEAD: 'head-2',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].head, 'head-2');
  assert.equal(state.lanes[0].retryableStage || '', '');
  assert.equal(state.lanes[0].retryableHead || '', '');
}

{
  const envInfo = makeEnv('merge-ready-merged-runs-post-merge-on-bound-branch');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 1,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'merge_ready', reviewRetryCount: 0 },
    ],
  }));
  const fakeDriver = path.join(envInfo.root, 'fake-achieved-driver.mjs');
  fs.writeFileSync(fakeDriver, `#!/usr/bin/env node
console.log('DONE');
console.log('stage: achieved');
`, { mode: 0o755 });
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-675',
    PR_707_STATE: 'MERGED',
    PR_707_MERGED_AT: '"2026-06-28T00:00:00Z"',
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: fakeDriver,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /^stage: lane-done$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch dev1/);
  assert.doesNotMatch(log, /verify-claim --issue 675 --pr 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'done');
}

{
  const envInfo = makeEnv('pooled-two-waiting');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
      { id: 'issue-676', issue: '676', change: 'change-676', branch: 'change-676', pr: '708', head: 'head-2', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
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
  const envInfo = makeEnv('retry-due-clear-precheck-enters-merge-ready');
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
        reviewRetryCount: 0,
        reviewRequestedAt: '2000-01-01T00:00:00.000Z',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-676',
    PROBE_RETRY_DUE_707: 'true',
    PROBE_AGE_707: '901',
    PROBE_CLEAR_CANDIDATE_707: 'true',
    CHECK_REVIEW_STATUS: '0',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.match(log, /check 707/);
  assert.doesNotMatch(log, /^request 707/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'merge_ready');
  assert.equal(state.lanes[0].reviewRetryCount, 0);
}

{
  const envInfo = makeEnv('retry-due-resumes-branch-and-dedupes-marker');
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
        reviewRetryCount: 0,
        reviewRequestedAt: '2000-01-01T00:00:00.000Z',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    CURRENT_BRANCH: 'change-676',
    PROBE_RETRY_DUE_707: 'true',
    PROBE_AGE_707: '901',
    RETRY_MARKER_EXISTS: '1',
    CHECK_REVIEW_STATUS: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /switch change-675/);
  assert.match(log, /verify-claim --issue 675 --pr 707/);
  assert.doesNotMatch(log, /check 707/);
  assert.doesNotMatch(log, /request 707 --force/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].reviewRetryCount, 1);
  assert.equal(state.lanes[0].reviewRequestedAt, '2026-06-28T00:00:00Z');
}

{
  const envInfo = makeEnv('retry-expired-does-not-stop-other-waiting-lane');
  fs.mkdirSync(envInfo.stateDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: envInfo.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
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
      {
        id: 'issue-676',
        issue: '676',
        change: 'change-676',
        branch: 'change-676',
        pr: '708',
        head: 'head-2',
        stage: 'waiting_review',
        reviewRetryCount: 0,
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '1',
    CURRENT_BRANCH: 'dev1',
    PROBE_RETRY_EXPIRED_FOR: '707',
    PROBE_STATE_708: 'changed',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /^stage: merge-ready$/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /probe 707/);
  assert.match(log, /probe 708/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'blocked');
  assert.equal(state.lanes[1].stage, 'merge_ready');
}

{
  const envInfo = makeEnv('changed-signature-before-retry-due-deep-checks');
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
        reviewRetryCount: 0,
        reviewRequestedAt: '2000-01-01T00:00:00.000Z',
        lastSignature: 'old-sig',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '1',
    CURRENT_BRANCH: 'change-675',
    CHECK_REVIEW_STATUS: '1',
    PROBE_STATE_707: 'changed',
    PROBE_SIGNATURE_707: 'new-sig',
    PROBE_AGE_707: '901',
    PROBE_RETRY_DUE_707: 'true',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^BLOCKED/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /check 707/);
  assert.doesNotMatch(log, /^request 707/m);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].reviewRetryCount, 0);
  assert.notEqual(state.lanes[0].reviewRequestedAt, '2000-01-01T00:00:00.000Z');
  assert.equal(state.lanes[0].lastSignature, 'new-sig');
}

{
  const envInfo = makeEnv('own-retry-signature-change-does-not-reset-wait');
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
        reviewRequestedAt: '2026-06-28T00:00:00Z',
        lastSignature: 'old-sig',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '900',
    CURRENT_BRANCH: 'change-675',
    CHECK_REVIEW_STATUS: '1',
    PROBE_STATE_707: 'changed',
    PROBE_SIGNATURE_707: 'new-sig',
    PROBE_AGE_707: '60',
    PROBE_RETRY_DUE_707: 'false',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^BLOCKED/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /check 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].reviewRetryCount, 1);
  assert.equal(state.lanes[0].reviewRequestedAt, '2026-06-28T00:00:00Z');
  assert.equal(state.lanes[0].lastSignature, 'new-sig');
}

{
  const envInfo = makeEnv('changed-signature-before-retry-expired-deep-checks');
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
        lastSignature: 'old-sig',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '1',
    CURRENT_BRANCH: 'change-675',
    CHECK_REVIEW_STATUS: '1',
    PROBE_CHANGED_RETRY_EXPIRED_FOR: '707',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^BLOCKED/m);
  const log = fs.readFileSync(envInfo.logFile, 'utf8');
  assert.match(log, /check 707/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'waiting_review');
  assert.equal(state.lanes[0].reviewRetryCount, 0);
  assert.notEqual(state.lanes[0].reviewRequestedAt, '2000-01-01T00:00:00.000Z');
  assert.equal(state.lanes[0].lastSignature, 'new-sig');
}

{
  const envInfo = makeEnv('changed-signature-retryable-deep-check-resets-wait');
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
        lastSignature: 'old-sig',
        lastRequestState: 'present-current-head',
      },
    ],
  }));
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '1',
    OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS: '1',
    CURRENT_BRANCH: 'change-675',
    CHECK_REVIEW_STATUS: '2',
    CHECK_REVIEW_STDERR: 'GitHub API EOF',
    PROBE_CHANGED_RETRY_EXPIRED_FOR: '707',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /GitHub API EOF/);
  const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
  assert.equal(state.lanes[0].stage, 'retryable_blocked');
  assert.equal(state.lanes[0].reviewRetryCount, 0);
  assert.notEqual(state.lanes[0].reviewRequestedAt, '2000-01-01T00:00:00.000Z');
  assert.equal(state.lanes[0].lastSignature, 'new-sig');
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
