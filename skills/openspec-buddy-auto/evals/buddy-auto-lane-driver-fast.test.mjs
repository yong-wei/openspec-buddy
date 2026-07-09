#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const laneDriver = path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-lane-fast-'));

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function makeEnv(name = 'park-then-fill-capacity') {
  const root = path.join(tmp, name);
  const binDir = path.join(root, 'bin');
  const coreDir = path.join(root, 'core');
  const repoDir = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const branchFile = path.join(root, 'branch.txt');
  const logFile = path.join(root, 'commands.log');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(coreDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });

  makeExecutable(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
branch_file=${JSON.stringify(branchFile)}
current_branch="\${CURRENT_BRANCH:-dev1}"
if [[ -f "$branch_file" ]]; then current_branch="$(<"$branch_file")"; fi
case "\${1:-}" in
  rev-parse)
    if [[ "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
    if [[ "\${2:-}" == "HEAD" ]]; then
      case "$current_branch" in
        change-677) printf 'head-3\\n' ;;
        change-676) printf 'head-2\\n' ;;
        *) printf 'head-1\\n' ;;
      esac
      exit 0
    fi
    ;;
  config)
    if [[ "\${2:-}" == "--get-regexp" ]]; then exit 1; fi
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
    exit 0
    ;;
  switch)
    echo "switch \${2:-}" >> ${JSON.stringify(logFile)}
    printf '%s\\n' "\${2:-}" > "$branch_file"
    exit 0
    ;;
  ls-remote)
    case "\${4:-}" in
      change-676) printf 'head-2\\trefs/heads/change-676\\n'; exit 0 ;;
      change-677) printf 'head-3\\trefs/heads/change-677\\n'; exit 0 ;;
    esac
    exit 0
    ;;
  remote)
    if [[ "\${2:-}" == "-v" ]]; then printf 'origin\\thttps://github.com/example/repo.git (fetch)\\norigin\\thttps://github.com/example/repo.git (push)\\n'; exit 0; fi
    if [[ "\${2:-}" == "get-url" ]]; then printf 'https://github.com/example/repo.git\\n'; exit 0; fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
`);
  makeExecutable(path.join(binDir, 'gh'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "pr" && "\${2:-}" == "view" ]]; then
  case "\${3:-}" in
    709) printf '%s\\n' '{"number":709,"state":"OPEN","headRefName":"change-677","headRefOid":"head-3","mergedAt":null}' ;;
    *) printf '%s\\n' '{"number":708,"state":"OPEN","headRefName":"change-676","headRefOid":"head-2","mergedAt":null}' ;;
  esac
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
`);

  makeExecutable(path.join(coreDir, 'verify-bound-worktree.sh'), `#!/bin/bash\necho "verify-bound $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-claim-worktree.sh'), `#!/bin/bash\necho "verify-claim $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'verify-current-head-review-request.sh'), `#!/bin/bash\necho "verify-request $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/bin/bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(coreDir, 'select-next-change.sh'), `#!/bin/bash
set -euo pipefail
excluded="$(cat "\${OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE:?}")"
echo "select excludes=$excluded" >> ${JSON.stringify(logFile)}
if grep -q '676' <<<"$excluded"; then
  printf '%s\\n' '{"selected":{"number":677,"title":"Next 677","change_id":"change-677","claim_branch":"change-677"}}'
else
  printf '%s\\n' '{"selected":{"number":676,"title":"Next 676","change_id":"change-676","claim_branch":"change-676"}}'
fi
`);
  makeExecutable(path.join(coreDir, 'probe-review-state.sh'), `#!/bin/bash
echo "probe $*" >> ${JSON.stringify(logFile)}
case "\${1:-}" in
  707) printf '%s\\n' '{"pr":"707","head":"head-1","signature":"sig-707","requestState":"present-current-head","state":"waiting","requestAgeSeconds":60,"retryDue":false,"clearCandidate":false}' ;;
  709) printf '%s\\n' '{"pr":"709","head":"head-3","signature":"sig-709","requestState":"present-current-head","state":"waiting","requestAgeSeconds":60,"retryDue":false,"clearCandidate":false}' ;;
  *) printf '%s\\n' '{"pr":"708","head":"head-2","signature":"sig-708","requestState":"present-current-head","state":"waiting","requestAgeSeconds":60,"retryDue":false,"clearCandidate":false}' ;;
esac
`);

  const singleDriver = path.join(root, 'fake-single-driver.mjs');
  fs.writeFileSync(singleDriver, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const issue = process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '';
const pr = issue === '677' ? '709' : '708';
const branch = issue === '677' ? 'change-677' : 'change-676';
const head = issue === '677' ? 'head-3' : 'head-2';
fs.appendFileSync(${JSON.stringify(logFile)}, 'driver issue=' + issue + '\\n');
fs.writeFileSync(${JSON.stringify(branchFile)}, branch + '\\n');
const stateFile = path.join(${JSON.stringify(root)}, 'driver-state-' + process.pid + '.json');
fs.writeFileSync(stateFile, JSON.stringify({
  issue,
  pr,
  change: branch,
  head,
  stages: {
    issue_pr_bound: { issue, pr, head, headRefName: branch },
    review_requested: { at: new Date().toISOString(), head },
  },
}));
console.log('DONE');
console.log('stage: review-yield');
console.log('state_file: ' + stateFile);
`, { mode: 0o755 });

  return { binDir, coreDir, repoDir, stateDir, singleDriver, logFile };
}

const envInfo = makeEnv();
const result = spawnSync(process.execPath, [laneDriver, '--poll-once'], {
  cwd: envInfo.repoDir,
  timeout: 60000,
  encoding: 'utf8',
  env: {
    ...process.env,
    PATH: `${envInfo.binDir}:${process.env.PATH}`,
    OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1',
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    OPENSPEC_BUDDY_AUTO_LANES: '2',
    OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: envInfo.stateDir,
    OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: envInfo.singleDriver,
    OPENSPEC_BUDDY_CORE_SCRIPT_DIR: envInfo.coreDir,
    OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS: '10000',
  },
});

assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /^DONE/m);
assert.match(result.stdout, /^stage: waiting_review$/m);

const log = fs.readFileSync(envInfo.logFile, 'utf8');
assert.match(log, /driver issue=676/);
assert.match(log, /select excludes=\["676"\]/);
assert.match(log, /driver issue=677/);
assert.match(log, /probe 708/);
assert.match(log, /probe 709/);

const state = JSON.parse(fs.readFileSync(path.join(envInfo.stateDir, 'dev1.json'), 'utf8'));
assert.deepEqual(
  state.lanes.map((lane) => [lane.issue, lane.pr, lane.stage]),
  [['676', '708', 'waiting_review'], ['677', '709', 'waiting_review']],
);

{
  const parkedEnv = makeEnv('parked-review-fills-capacity-before-probe');
  fs.mkdirSync(parkedEnv.stateDir, { recursive: true });
  fs.writeFileSync(path.join(parkedEnv.stateDir, 'dev1.json'), JSON.stringify({
    version: 1,
    worktree: { path: parkedEnv.repoDir, alias: 'dev1', pathHash: 'hash', boundBranch: 'dev1', boundBase: 'origin/integration' },
    maxLanes: 2,
    lanes: [
      { id: 'issue-675', issue: '675', change: 'change-675', branch: 'change-675', pr: '707', head: 'head-1', stage: 'waiting_review', reviewRetryCount: 0, reviewStatusSyncedAt: '2026-06-28T00:00:00.000Z', lastRequestState: 'present-current-head' },
    ],
  }));
  const parkedResult = spawnSync(process.execPath, [laneDriver, '--poll-once'], {
    cwd: parkedEnv.repoDir,
    timeout: 60000,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${parkedEnv.binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1',
      OPENSPEC_BUDDY_AUTO_GOAL: '1',
      OPENSPEC_BUDDY_AUTO_LANES: '2',
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: parkedEnv.stateDir,
      OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: parkedEnv.singleDriver,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: parkedEnv.coreDir,
      OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS: '10000',
    },
  });
  assert.equal(parkedResult.status, 0, parkedResult.stderr);
  const parkedLog = fs.readFileSync(parkedEnv.logFile, 'utf8');
  const selectIndex = parkedLog.indexOf('select excludes=');
  const probeIndex = parkedLog.indexOf('probe 707');
  assert.notEqual(selectIndex, -1, parkedLog);
  assert.notEqual(probeIndex, -1, parkedLog);
  assert.ok(selectIndex < probeIndex, parkedLog);
  const parkedState = JSON.parse(fs.readFileSync(path.join(parkedEnv.stateDir, 'dev1.json'), 'utf8'));
  assert.deepEqual(
    parkedState.lanes.map((lane) => [lane.issue, lane.pr, lane.stage]),
    [['675', '707', 'waiting_review'], ['676', '708', 'waiting_review']],
  );
}

console.log('buddy-auto-lane-driver fast tests passed');
