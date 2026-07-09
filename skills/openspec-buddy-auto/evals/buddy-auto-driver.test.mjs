import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const helper = path.resolve(__dirname, '../scripts/buddy-auto-driver.mjs');

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function run(args, options = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENSPEC_BUDDY_AUTO_')) delete env[key];
  }
  return spawnSync('node', [helper, ...args], {
    cwd: options.cwd || repoRoot,
    env: { ...env, OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1', ...options.env },
    encoding: 'utf8',
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-driver-'));
const stateDir = path.join(tmp, 'state');
const coreDir = path.join(tmp, 'core');
const logFile = path.join(tmp, 'commands.log');
fs.mkdirSync(coreDir, { recursive: true });
makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'review-response-gate.sh'), `#!/usr/bin/env bash\necho "review-response-gate $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "helper stdout should stay quiet"\necho "wait-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(logFile)}\nprintf '{"issue":%s,"pr":null,"reason":"no exact PR"}\\n' "$1"\n`);
makeExecutable(path.join(coreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(logFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
makeExecutable(path.join(coreDir, 'mark-achieved-post-merge.sh'), `#!/usr/bin/env bash\necho "post-merge-achieve $*" >> ${JSON.stringify(logFile)}\n`);

const env = {
  OPENSPEC_BUDDY_AUTO_STATE_DIR: stateDir,
  OPENSPEC_BUDDY_CORE_SCRIPT_DIR: coreDir,
  OPENSPEC_BUDDY_AUTO_HEAD: 'abc123',
};

{
  const noContextStateDir = path.join(tmp, 'state-no-context');
  const noContextCoreDir = path.join(tmp, 'core-no-context');
  const noContextLogFile = path.join(tmp, 'commands-no-context.log');
  const binDir = path.join(tmp, 'bin-no-context');
  fs.mkdirSync(noContextCoreDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  makeExecutable(path.join(noContextCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(noContextLogFile)}\n`);
  makeExecutable(path.join(binDir, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: noContextStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: noContextCoreDir,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: no-goal-context/);
  assert.equal(fs.existsSync(noContextLogFile), false);
}

{
  const mergedPrStateDir = path.join(tmp, 'state-merged-pr-context');
  const mergedPrCoreDir = path.join(tmp, 'core-merged-pr-context');
  const mergedPrLogFile = path.join(tmp, 'commands-merged-pr-context.log');
  const mergedPrBinDir = path.join(tmp, 'bin-merged-pr-context');
  const mergedPrGhLogFile = path.join(tmp, 'gh-merged-pr-context.log');
  fs.mkdirSync(mergedPrCoreDir, { recursive: true });
  fs.mkdirSync(mergedPrBinDir, { recursive: true });
  makeExecutable(path.join(mergedPrCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(mergedPrLogFile)}\n`);
  makeExecutable(path.join(mergedPrBinDir, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(mergedPrGhLogFile)}\nif [[ "$*" == "pr view --json number,state --jq select(.state == \\"OPEN\\") | .number" ]]; then exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: mergedPrStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: mergedPrCoreDir,
      PATH: `${mergedPrBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: no-goal-context/);
  assert.equal(fs.existsSync(mergedPrLogFile), false);
  assert.match(fs.readFileSync(mergedPrGhLogFile, 'utf8'), /pr view --json number,state --jq select\(\.state == "OPEN"\) \| \.number/);
}

{
  const goalStateDir = path.join(tmp, 'state-goal-selected');
  const goalCoreDir = path.join(tmp, 'core-goal-selected');
  const goalLogFile = path.join(tmp, 'commands-goal-selected.log');
  const goalBinDir = path.join(tmp, 'bin-goal-selected');
  const goalGhLogFile = path.join(tmp, 'gh-goal-selected.log');
  fs.mkdirSync(goalCoreDir, { recursive: true });
  fs.mkdirSync(goalBinDir, { recursive: true });
  makeExecutable(path.join(goalCoreDir, 'verify-bound-worktree.sh'), `#!/usr/bin/env bash\necho "verify-bound $*" >> ${JSON.stringify(goalLogFile)}\n`);
  makeExecutable(path.join(goalCoreDir, 'select-next-change.sh'), `#!/usr/bin/env bash\necho "select" >> ${JSON.stringify(goalLogFile)}\nprintf '%s\\n' '{"selected":{"number":675,"title":"Next change","change_id":"next-change"}}'\n`);
  makeExecutable(path.join(goalCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(goalLogFile)}\n`);
  makeExecutable(path.join(goalCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(goalLogFile)}\nprintf '%s\\n' '{"issue":675,"pr":null,"reason":"no exact PR"}'\n`);
  makeExecutable(path.join(goalBinDir, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(goalGhLogFile)}\nif [[ "$*" == "pr view --json number,state --jq select(.state == \\"OPEN\\") | .number" ]]; then echo 448; exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: goalStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: goalCoreDir,
      OPENSPEC_BUDDY_AUTO_GOAL: '1',
      PATH: `${goalBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: implement-or-open-pr/);
  assert.equal(fs.readFileSync(goalLogFile, 'utf8').trim(), [
    'verify-bound --phase goal-loop-start',
    'select',
    'claim 675',
    'find-pr 675',
  ].join('\n'));
  assert.equal(fs.existsSync(goalGhLogFile), false);
  const state = JSON.parse(fs.readFileSync(path.join(goalStateDir, 'issue-675.json'), 'utf8'));
  assert.equal(state.issue, '675');
  assert.ok(state.stages.claimed);
}

{
  const goalEmptyStateDir = path.join(tmp, 'state-goal-empty');
  const goalEmptyCoreDir = path.join(tmp, 'core-goal-empty');
  const goalEmptyLogFile = path.join(tmp, 'commands-goal-empty.log');
  fs.mkdirSync(goalEmptyCoreDir, { recursive: true });
  makeExecutable(path.join(goalEmptyCoreDir, 'verify-bound-worktree.sh'), `#!/usr/bin/env bash\necho "verify-bound $*" >> ${JSON.stringify(goalEmptyLogFile)}\n`);
  makeExecutable(path.join(goalEmptyCoreDir, 'select-next-change.sh'), `#!/usr/bin/env bash\necho "select" >> ${JSON.stringify(goalEmptyLogFile)}\nprintf '%s\\n' '{"selected":null,"reason":"No executable OpenSpec Buddy issue."}'\n`);
  makeExecutable(path.join(goalEmptyCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(goalEmptyLogFile)}\n`);
  makeExecutable(path.join(goalEmptyCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(goalEmptyLogFile)}\nprintf '{"issue":%s,"pr":null}\\n' "$1"\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: goalEmptyStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: goalEmptyCoreDir,
      OPENSPEC_BUDDY_AUTO_GOAL: 'true',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: no-available-changes/);
  assert.match(result.stdout, /No executable OpenSpec Buddy issue/);
  assert.equal(fs.readFileSync(goalEmptyLogFile, 'utf8').trim(), [
    'verify-bound --phase goal-loop-start',
    'select',
  ].join('\n'));
}

{
  const goalLocalStateDir = path.join(tmp, 'state-goal-local-only');
  const goalLocalCoreDir = path.join(tmp, 'core-goal-local-only');
  const goalLocalLogFile = path.join(tmp, 'commands-goal-local-only.log');
  fs.mkdirSync(goalLocalCoreDir, { recursive: true });
  makeExecutable(path.join(goalLocalCoreDir, 'verify-bound-worktree.sh'), `#!/usr/bin/env bash\necho "verify-bound $*" >> ${JSON.stringify(goalLocalLogFile)}\n`);
  makeExecutable(path.join(goalLocalCoreDir, 'select-next-change.sh'), `#!/usr/bin/env bash\necho "select" >> ${JSON.stringify(goalLocalLogFile)}\nprintf '%s\\n' '{"selected":{"number":null,"change_id":"local-change","local_only":true,"no_issue":true}}'\n`);
  makeExecutable(path.join(goalLocalCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(goalLocalLogFile)}\n`);
  makeExecutable(path.join(goalLocalCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(goalLocalLogFile)}\nprintf '{"issue":%s,"pr":null}\\n' "$1"\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: goalLocalStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: goalLocalCoreDir,
      OPENSPEC_BUDDY_AUTO_GOAL: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: local-review/);
  assert.match(result.stdout, /Local-only --no-pr path/);
  assert.equal(fs.readFileSync(goalLocalLogFile, 'utf8').trim(), [
    'verify-bound --phase goal-loop-start',
    'select',
  ].join('\n'));
}

{
  const targetIssueStateDir = path.join(tmp, 'state-target-issue');
  const targetIssueCoreDir = path.join(tmp, 'core-target-issue');
  const targetIssueLogFile = path.join(tmp, 'commands-target-issue.log');
  const targetIssueBinDir = path.join(tmp, 'bin-target-issue');
  const targetIssueGhLogFile = path.join(tmp, 'gh-target-issue.log');
  fs.mkdirSync(targetIssueCoreDir, { recursive: true });
  fs.mkdirSync(targetIssueBinDir, { recursive: true });
  makeExecutable(path.join(targetIssueCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(targetIssueLogFile)}\n`);
  makeExecutable(path.join(targetIssueCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(targetIssueLogFile)}\nprintf '%s\\n' '{"issue":693,"pr":null,"reason":"no exact PR"}'\n`);
  makeExecutable(path.join(targetIssueBinDir, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(targetIssueGhLogFile)}\nif [[ "$*" == "pr view --json number --jq .number" ]]; then echo 448; exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: targetIssueStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: targetIssueCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '693',
      OPENSPEC_BUDDY_AUTO_PR: '448',
      OPENSPEC_BUDDY_AUTO_HEAD: 'stale-head',
      PATH: `${targetIssueBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: implement-or-open-pr/);
  assert.equal(fs.readFileSync(targetIssueLogFile, 'utf8').trim(), [
    'claim 693',
    'find-pr 693',
  ].join('\n'));
  assert.equal(fs.existsSync(targetIssueGhLogFile), false);

  const second = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: targetIssueStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: targetIssueCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '693',
      OPENSPEC_BUDDY_AUTO_PR: '448',
      OPENSPEC_BUDDY_AUTO_HEAD: 'stale-head',
      PATH: `${targetIssueBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^HANDOFF/m);
  assert.match(second.stdout, /stage: implement-or-open-pr/);
  assert.equal(fs.readFileSync(targetIssueLogFile, 'utf8').trim(), [
    'claim 693',
    'find-pr 693',
    'find-pr 693',
  ].join('\n'));
}

{
  const targetIssuePrStateDir = path.join(tmp, 'state-target-issue-pr');
  const targetIssuePrCoreDir = path.join(tmp, 'core-target-issue-pr');
  const targetIssuePrLogFile = path.join(tmp, 'commands-target-issue-pr.log');
  fs.mkdirSync(targetIssuePrCoreDir, { recursive: true });
  makeExecutable(path.join(targetIssuePrCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(targetIssuePrLogFile)}\n`);
  makeExecutable(path.join(targetIssuePrCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(targetIssuePrLogFile)}\nprintf '%s\\n' '{"issue":675,"pr":707,"head":"exact-head","state":"OPEN","headRefName":"audit-remediation-arena-publication-context"}'\n`);
  makeExecutable(path.join(targetIssuePrCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(targetIssuePrLogFile)}\n`);
  makeExecutable(path.join(targetIssuePrCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(targetIssuePrLogFile)}\n`);
  makeExecutable(path.join(targetIssuePrCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(targetIssuePrLogFile)}\n`);
  makeExecutable(path.join(targetIssuePrCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: targetIssuePrStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: targetIssuePrCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '675',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.equal(fs.readFileSync(targetIssuePrLogFile, 'utf8').trim(), [
    'claim 675',
    'find-pr 675',
    'mark-review 675 707',
    'wait-review 707',
    'verify-review 707',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(targetIssuePrStateDir, 'pr-707.json'), 'utf8'));
  assert.ok(state.stages.issue_pr_bound);
  assert.ok(state.stages.merge_gates_passed);
}

{
  const yieldStateDir = path.join(tmp, 'state-review-yield');
  const yieldCoreDir = path.join(tmp, 'core-review-yield');
  const yieldLogFile = path.join(tmp, 'commands-review-yield.log');
  fs.mkdirSync(yieldCoreDir, { recursive: true });
  makeExecutable(path.join(yieldCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(yieldLogFile)}\n`);
  makeExecutable(path.join(yieldCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(yieldLogFile)}\nprintf '%s\\n' '{"issue":675,"pr":707,"head":"exact-head","state":"OPEN","headRefName":"audit-remediation-arena-publication-context"}'\n`);
  makeExecutable(path.join(yieldCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(yieldLogFile)}\n`);
  makeExecutable(path.join(yieldCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(yieldLogFile)}\n`);
  makeExecutable(path.join(yieldCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(yieldLogFile)}\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: yieldStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: yieldCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '675',
      OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: 'yield',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: review-yield/);
  assert.equal(fs.readFileSync(yieldLogFile, 'utf8').trim(), [
    'claim 675',
    'find-pr 675',
    'mark-review 675 707',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(yieldStateDir, 'pr-707.json'), 'utf8'));
  assert.ok(state.stages.mark_review_passed);
  assert.ok(state.stages.review_requested);
  assert.equal(state.stages.review_clear, undefined);
}

{
  const verifyOnceStateDir = path.join(tmp, 'state-review-verify-once');
  const verifyOnceCoreDir = path.join(tmp, 'core-review-verify-once');
  const verifyOnceLogFile = path.join(tmp, 'commands-review-verify-once.log');
  fs.mkdirSync(verifyOnceCoreDir, { recursive: true });
  makeExecutable(path.join(verifyOnceCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(verifyOnceLogFile)}\n`);
  makeExecutable(path.join(verifyOnceCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(verifyOnceLogFile)}\nprintf '%s\\n' '{"issue":675,"pr":707,"head":"exact-head","state":"OPEN","headRefName":"audit-remediation-arena-publication-context"}'\n`);
  makeExecutable(path.join(verifyOnceCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(verifyOnceLogFile)}\n`);
  makeExecutable(path.join(verifyOnceCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(verifyOnceLogFile)}\n`);
  makeExecutable(path.join(verifyOnceCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(verifyOnceLogFile)}\n`);
  makeExecutable(path.join(verifyOnceCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: verifyOnceStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: verifyOnceCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '675',
      OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: 'verify-once',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: review_clear/);
  assert.equal(fs.readFileSync(verifyOnceLogFile, 'utf8').trim(), [
    'claim 675',
    'find-pr 675',
    'mark-review 675 707',
    'verify-review 707',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(verifyOnceStateDir, 'pr-707.json'), 'utf8'));
  assert.ok(state.stages.review_clear);
  assert.equal(state.stages.merge_gates_passed, undefined);
}

{
  const mergedBridgeStateDir = path.join(tmp, 'state-merged-bridge');
  const mergedBridgeCoreDir = path.join(tmp, 'core-merged-bridge');
  const mergedBridgeLogFile = path.join(tmp, 'commands-merged-bridge.log');
  fs.mkdirSync(mergedBridgeCoreDir, { recursive: true });
  makeExecutable(path.join(mergedBridgeCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(mergedBridgeLogFile)}\n`);
  makeExecutable(path.join(mergedBridgeCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(mergedBridgeLogFile)}\nprintf '%s\\n' '{"issue":675,"pr":707,"head":"merged-head","state":"CLOSED","merged":true,"headRefName":"audit-remediation-arena-publication-context"}'\n`);
  makeExecutable(path.join(mergedBridgeCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(mergedBridgeLogFile)}\n`);
  makeExecutable(path.join(mergedBridgeCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(mergedBridgeLogFile)}\n`);
  makeExecutable(path.join(mergedBridgeCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(mergedBridgeLogFile)}\n`);
  makeExecutable(path.join(mergedBridgeCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(mergedBridgeLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:true,reason:'merged PR already terminal'}));\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: mergedBridgeStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: mergedBridgeCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '675',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: achieved/);
  assert.equal(fs.readFileSync(mergedBridgeLogFile, 'utf8').trim(), [
    'claim 675',
    'find-pr 675',
    'mark-review 675 707',
    'wait-review 707',
    'verify-review 707',
    'achieved-truth 675 707',
  ].join('\n'));
}

{
  const achievedStateDir = path.join(tmp, 'state-achieved-truth');
  const achievedCoreDir = path.join(tmp, 'core-achieved-truth');
  const achievedLogFile = path.join(tmp, 'commands-achieved-truth.log');
  fs.mkdirSync(achievedCoreDir, { recursive: true });
  makeExecutable(path.join(achievedCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(achievedLogFile)}\n`);
  makeExecutable(path.join(achievedCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(achievedLogFile)}\n`);
  makeExecutable(path.join(achievedCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(achievedLogFile)}\n`);
  makeExecutable(path.join(achievedCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(achievedLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:true,reason:'terminal'}));\n`);
  const result = run(['--issue', '675', '--pr', '707', '--head', 'head-1'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: achievedStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: achievedCoreDir,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: achieved/);
  assert.equal(fs.readFileSync(achievedLogFile, 'utf8').trim(), [
    'mark-review 675 707',
    'wait-review 707',
    'verify-review 707',
    'achieved-truth 675 707',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(achievedStateDir, 'pr-707.json'), 'utf8'));
  assert.ok(state.stages.achieved);
}

{
  const postMergeStateDir = path.join(tmp, 'state-post-merge-achieve');
  const postMergeCoreDir = path.join(tmp, 'core-post-merge-achieve');
  const postMergeLogFile = path.join(tmp, 'commands-post-merge-achieve.log');
  fs.mkdirSync(postMergeCoreDir, { recursive: true });
  makeExecutable(path.join(postMergeCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(postMergeLogFile)}\n`);
  makeExecutable(path.join(postMergeCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(postMergeLogFile)}\n`);
  makeExecutable(path.join(postMergeCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(postMergeLogFile)}\n`);
  makeExecutable(path.join(postMergeCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst countFile = ${JSON.stringify(path.join(tmp, 'post-merge-truth.count'))};\nconst count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) + 1 : 1;\nfs.writeFileSync(countFile, String(count));\nfs.appendFileSync(${JSON.stringify(postMergeLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nif (count === 1) console.log(JSON.stringify({achieved:false,next:'mark-achieved-post-merge',archivePath:'openspec/changes/archive/2026-06-26-demo',reason:'issue not archived'}));\nelse console.log(JSON.stringify({achieved:true,reason:'terminal after post-merge sync'}));\n`);
  makeExecutable(path.join(postMergeCoreDir, 'mark-achieved-post-merge.sh'), `#!/usr/bin/env bash\nset -euo pipefail\ncount_file=${JSON.stringify(path.join(tmp, 'post-merge-achieve.count'))}\nif [[ -f "$count_file" ]]; then count=$(( $(cat "$count_file") + 1 )); else count=1; fi\necho "$count" > "$count_file"\necho "post-merge-achieve $*" >> ${JSON.stringify(postMergeLogFile)}\nif [[ "$count" == "1" ]]; then\n  echo "safe_to_rerun: true" >&2\n  exit 1\nfi\n`);
  const result = run(['--issue', '675', '--pr', '707', '--head', 'head-1'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: postMergeStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: postMergeCoreDir,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: mark-achieved-post-merge/);
  assert.equal(fs.readFileSync(postMergeLogFile, 'utf8').trim(), [
    'mark-review 675 707',
    'wait-review 707',
    'verify-review 707',
    'achieved-truth 675 707',
    'post-merge-achieve 675 openspec/changes/archive/2026-06-26-demo 707',
    'post-merge-achieve 675 openspec/changes/archive/2026-06-26-demo 707',
    'achieved-truth 675 707',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(postMergeStateDir, 'pr-707.json'), 'utf8'));
  assert.ok(state.stages.post_merge_achieved);
  assert.ok(state.stages.achieved);
}

{
  const targetPrStateDir = path.join(tmp, 'state-target-pr');
  const targetPrCoreDir = path.join(tmp, 'core-target-pr');
  const targetPrLogFile = path.join(tmp, 'commands-target-pr.log');
  const targetPrBinDir = path.join(tmp, 'bin-target-pr');
  const targetPrGhLogFile = path.join(tmp, 'gh-target-pr.log');
  fs.mkdirSync(targetPrCoreDir, { recursive: true });
  fs.mkdirSync(targetPrBinDir, { recursive: true });
  makeExecutable(path.join(targetPrCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(targetPrLogFile)}\n`);
  makeExecutable(path.join(targetPrCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(targetPrLogFile)}\n`);
  makeExecutable(path.join(targetPrCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(targetPrLogFile)}\n`);
  makeExecutable(path.join(targetPrCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(targetPrLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  makeExecutable(path.join(targetPrBinDir, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(targetPrGhLogFile)}\nif [[ "$*" == "pr view 694 --json body --jq .body" ]]; then echo "origin issue: #693"; exit 0; fi\nif [[ "$*" == "pr view 694 --json headRefOid --jq .headRefOid" ]]; then echo target-head; exit 0; fi\nif [[ "$*" == "pr view --json number --jq .number" ]]; then echo 448; exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: targetPrStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: targetPrCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_PR: '694',
      OPENSPEC_BUDDY_AUTO_ISSUE: '12',
      OPENSPEC_BUDDY_AUTO_HEAD: 'stale-head',
      PATH: `${targetPrBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.equal(fs.readFileSync(targetPrLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
    'verify-review 694',
    'achieved-truth 693 694',
  ].join('\n'));
  const ghLog = fs.readFileSync(targetPrGhLogFile, 'utf8');
  assert.match(ghLog, /pr view 694 --json body --jq \.body/);
  assert.match(ghLog, /pr view 694 --json headRefOid --jq \.headRefOid/);
  assert.doesNotMatch(ghLog, /pr view --json number --jq \.number/);
}

{
  const bothTargetStateDir = path.join(tmp, 'state-both-targets');
  const bothTargetCoreDir = path.join(tmp, 'core-both-targets');
  const bothTargetLogFile = path.join(tmp, 'commands-both-targets.log');
  const bothTargetBinDir = path.join(tmp, 'bin-both-targets');
  fs.mkdirSync(bothTargetCoreDir, { recursive: true });
  fs.mkdirSync(bothTargetBinDir, { recursive: true });
  makeExecutable(path.join(bothTargetCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(bothTargetLogFile)}\n`);
  makeExecutable(path.join(bothTargetCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(bothTargetLogFile)}\n`);
  makeExecutable(path.join(bothTargetCoreDir, 'verify-review-clear.sh'), '#!/usr/bin/env bash\nexit 0\n');
  makeExecutable(path.join(bothTargetCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(bothTargetLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  makeExecutable(path.join(bothTargetBinDir, 'gh'), `#!/usr/bin/env bash\nif [[ "$*" == "pr view 694 --json body --jq .body" ]]; then echo "origin issue: #693"; exit 0; fi\nif [[ "$*" == "pr view 694 --json headRefOid --jq .headRefOid" ]]; then echo target-head; exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: bothTargetStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: bothTargetCoreDir,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '999',
      OPENSPEC_BUDDY_AUTO_TARGET_PR: '694',
      PATH: `${bothTargetBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.equal(fs.readFileSync(bothTargetLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
    'achieved-truth 693 694',
  ].join('\n'));
}

{
  const cliTargetStateDir = path.join(tmp, 'state-cli-targets');
  const cliTargetCoreDir = path.join(tmp, 'core-cli-targets');
  const cliTargetLogFile = path.join(tmp, 'commands-cli-targets.log');
  const cliTargetBinDir = path.join(tmp, 'bin-cli-targets');
  fs.mkdirSync(cliTargetCoreDir, { recursive: true });
  fs.mkdirSync(cliTargetBinDir, { recursive: true });
  makeExecutable(path.join(cliTargetCoreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(cliTargetLogFile)}\n`);
  makeExecutable(path.join(cliTargetCoreDir, 'find-issue-pr.sh'), `#!/usr/bin/env bash\necho "find-pr $*" >> ${JSON.stringify(cliTargetLogFile)}\nprintf '%s\\n' '{"issue":701,"pr":null}'\n`);
  makeExecutable(path.join(cliTargetBinDir, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  const result = run(['--target-issue', '701'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: cliTargetStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: cliTargetCoreDir,
      OPENSPEC_BUDDY_AUTO_PR: '448',
      OPENSPEC_BUDDY_AUTO_HEAD: 'stale-head',
      PATH: `${cliTargetBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: implement-or-open-pr/);
  assert.equal(fs.readFileSync(cliTargetLogFile, 'utf8').trim(), [
    'claim 701',
    'find-pr 701',
  ].join('\n'));
}

{
  const cliTargetPrStateDir = path.join(tmp, 'state-cli-target-pr');
  const cliTargetPrCoreDir = path.join(tmp, 'core-cli-target-pr');
  const cliTargetPrLogFile = path.join(tmp, 'commands-cli-target-pr.log');
  const cliTargetPrBinDir = path.join(tmp, 'bin-cli-target-pr');
  fs.mkdirSync(cliTargetPrCoreDir, { recursive: true });
  fs.mkdirSync(cliTargetPrBinDir, { recursive: true });
  makeExecutable(path.join(cliTargetPrCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(cliTargetPrLogFile)}\n`);
  makeExecutable(path.join(cliTargetPrCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(cliTargetPrLogFile)}\n`);
  makeExecutable(path.join(cliTargetPrCoreDir, 'verify-review-clear.sh'), '#!/usr/bin/env bash\nexit 0\n');
  makeExecutable(path.join(cliTargetPrCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(cliTargetPrLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  makeExecutable(path.join(cliTargetPrBinDir, 'gh'), `#!/usr/bin/env bash\nif [[ "$*" == "pr view 694 --json body --jq .body" ]]; then echo "origin issue: #693"; exit 0; fi\nif [[ "$*" == "pr view 694 --json headRefOid --jq .headRefOid" ]]; then echo target-head; exit 0; fi\nexit 1\n`);
  const result = run(['--target-pr', '694', '--issue', '999', '--pr', '448', '--head', 'stale-head'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: cliTargetPrStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: cliTargetPrCoreDir,
      PATH: `${cliTargetPrBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.equal(fs.readFileSync(cliTargetPrLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
    'achieved-truth 693 694',
  ].join('\n'));
}

{
  const result = run(['--dry-run', '--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /driver_internal: true/);
}

{
  const reviewFixStateDir = path.join(tmp, 'state-review-fix');
  const reviewFixCoreDir = path.join(tmp, 'core-review-fix');
  const reviewFixLogFile = path.join(tmp, 'commands-review-fix.log');
  fs.mkdirSync(reviewFixCoreDir, { recursive: true });
  makeExecutable(path.join(reviewFixCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(reviewFixLogFile)}\n`);
  makeExecutable(path.join(reviewFixCoreDir, 'review-response-gate.sh'), `#!/usr/bin/env bash\necho "review-response-gate $*" >> ${JSON.stringify(reviewFixLogFile)}\n`);
  makeExecutable(path.join(reviewFixCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(reviewFixLogFile)}\n`);
  makeExecutable(path.join(reviewFixCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(reviewFixLogFile)}\n`);
  makeExecutable(path.join(reviewFixCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(reviewFixLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  const result = run(['--issue', '12', '--pr', '34', '--head', 'fix-head'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: reviewFixStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: reviewFixCoreDir,
      OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(reviewFixLogFile, 'utf8').trim(), [
    'review-response-gate 34 --head fix-head',
    'mark-review 12 34',
    'wait-review 34',
    'verify-review 34',
    'achieved-truth 12 34',
  ].join('\n'));
  const state = JSON.parse(fs.readFileSync(path.join(reviewFixStateDir, 'pr-34.json'), 'utf8'));
  assert.ok(state.stages.review_response_gate_passed);
}

{
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /mark-review 12 34/);
  assert.match(log, /wait-review 34/);
  assert.match(log, /verify-review 34/);
  assert.match(log, /achieved-truth 12 34/);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.doesNotMatch(result.stdout, /helper stdout should stay quiet/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.ok(state.stages.mark_review_passed);
  assert.ok(state.stages.review_requested);
  assert.ok(state.stages.review_clear);
  assert.ok(state.stages.merge_gates_passed);
}

{
  const before = fs.readFileSync(logFile, 'utf8');
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(logFile, 'utf8'), /achieved-truth 12 34/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.equal(state.stages.review_clear.head, 'abc123');
  assert.ok(state.stages.merge_gates_passed);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.ok(fs.readFileSync(logFile, 'utf8').length > before.length);
}

{
  const before = fs.readFileSync(logFile, 'utf8');
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.ok(fs.readFileSync(logFile, 'utf8').length > before.length);
}

{
  const before = fs.readFileSync(logFile, 'utf8');
  const result = run(['--dry-run', '--issue', '12', '--pr', '34', '--head', 'new-head'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: mark-review/);
  assert.doesNotMatch(result.stdout, /stage: merge-or-achieve/);
  assert.equal(fs.readFileSync(logFile, 'utf8'), before);
}

{
  const result = run(['--pr', '99'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR review phases require --issue/);
}

{
  const result = run(['--issue', '12', '--no-pr'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: blocked/);
  assert.match(result.stdout, /--no-pr is valid only with --change/);
}

{
  const result = run(['--issue', '12', '--pr', '77', '--record', 'mark_review_passed'], { env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown argument: --record/);
  assert.equal(fs.existsSync(path.join(stateDir, 'pr-77.json')), false);
}

{
  fs.writeFileSync(path.join(stateDir, 'pr-88.json'), JSON.stringify({
    version: 1,
    key: 'pr-88',
    issue: '12',
    pr: '88',
    stages: {
      mark_review_passed: { at: '2026-01-01T00:00:00.000Z', command: 'fake' },
      review_requested: { at: '2026-01-01T00:00:00.000Z', command: 'fake' },
      review_clear: { at: '2026-01-01T00:00:00.000Z', command: 'fake' },
    },
  }, null, 2));
  const result = run(['--dry-run', '--issue', '12', '--pr', '88'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /mark_review_passed:[^\n]+invalid/);
  assert.doesNotMatch(result.stdout, /stage: merge-gates/);
}

{
  fs.copyFileSync(path.join(stateDir, 'pr-34.json'), path.join(stateDir, 'pr-89.json'));
  const result = run(['--dry-run', '--issue', '12', '--pr', '89'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /state_context: invalid/);
  assert.doesNotMatch(result.stdout, /stage: merge-gates/);
}

{
  const noArgStateDir = path.join(tmp, 'state-no-arg');
  const noArgLogFile = path.join(tmp, 'commands-no-arg.log');
  const noArgCoreDir = path.join(tmp, 'core-no-arg');
  const noArgBinDir = path.join(tmp, 'bin-no-arg');
  const noArgGhLogFile = path.join(tmp, 'gh-no-arg.log');
  fs.mkdirSync(noArgCoreDir, { recursive: true });
  fs.mkdirSync(noArgBinDir, { recursive: true });
  makeExecutable(path.join(noArgCoreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(noArgLogFile)}\n`);
  makeExecutable(path.join(noArgCoreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(noArgLogFile)}\n`);
  makeExecutable(path.join(noArgCoreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(noArgLogFile)}\n`);
  makeExecutable(path.join(noArgCoreDir, 'verify-achieved-truth.mjs'), `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(noArgLogFile)}, \`achieved-truth \${process.argv.slice(2).join(' ')}\\n\`);\nconsole.log(JSON.stringify({achieved:false,next:'merge-pr',reason:'PR is not merged'}));\n`);
  makeExecutable(path.join(noArgBinDir, 'gh'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(noArgGhLogFile)}\nif [[ "$*" == "pr view 56 --json headRefOid --jq .headRefOid" ]]; then echo inferred-head; exit 0; fi\nexit 1\n`);
  const result = run([], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: noArgStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: noArgCoreDir,
      OPENSPEC_BUDDY_AUTO_ISSUE: '55',
      OPENSPEC_BUDDY_AUTO_PR: '56',
      PATH: `${noArgBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-pr/);
  assert.equal(fs.readFileSync(noArgLogFile, 'utf8').trim(), [
    'mark-review 55 56',
    'wait-review 56',
    'verify-review 56',
    'achieved-truth 55 56',
  ].join('\n'));
  assert.match(fs.readFileSync(noArgGhLogFile, 'utf8'), /pr view 56 --json headRefOid --jq \.headRefOid/);
}

{
  const staleStateDir = path.join(tmp, 'state-stale-head');
  const staleCoreDir = path.join(tmp, 'core-stale-head');
  const staleBinDir = path.join(tmp, 'bin-stale-head');
  fs.mkdirSync(staleCoreDir, { recursive: true });
  fs.mkdirSync(staleBinDir, { recursive: true });
  makeExecutable(path.join(staleCoreDir, 'mark-review.sh'), '#!/usr/bin/env bash\nexit 0\n');
  makeExecutable(path.join(staleCoreDir, 'wait-for-review-clear.sh'), '#!/usr/bin/env bash\nexit 0\n');
  makeExecutable(path.join(staleCoreDir, 'verify-review-clear.sh'), '#!/usr/bin/env bash\nexit 0\n');
  makeExecutable(path.join(staleCoreDir, 'verify-achieved-truth.mjs'), '#!/usr/bin/env node\nconsole.log(JSON.stringify({achieved:false,next:"merge-pr",reason:"PR is not merged"}));\n');
  makeExecutable(path.join(staleBinDir, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  const seedEnv = {
    OPENSPEC_BUDDY_AUTO_STATE_DIR: staleStateDir,
    OPENSPEC_BUDDY_CORE_SCRIPT_DIR: staleCoreDir,
    OPENSPEC_BUDDY_AUTO_HEAD: 'old-head',
  };
  assert.equal(run(['--issue', '91', '--pr', '92'], { env: seedEnv }).status, 0);
  assert.equal(run(['--issue', '91', '--pr', '92'], { env: seedEnv }).status, 0);
  const result = run(['--issue', '91', '--pr', '92'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: staleStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: staleCoreDir,
      PATH: `${staleBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /current PR head/);
  assert.doesNotMatch(result.stdout, /merge-or-achieve/);
}

{
  const skill = fs.readFileSync(path.resolve(__dirname, '../SKILL.md'), 'utf8');
  assert.match(skill, /<EXTREMELY_IMPORTANT>/);
  assert.match(skill, /buddy-auto\.mjs/);
  assert.doesNotMatch(skill, /buddy-auto-driver\.mjs/);
  assert.doesNotMatch(skill, /buddy-auto-lane-driver\.mjs/);
  assert.match(skill, /DO NOT OUTPUT/);
  assert.match(skill, /WAIT SILENTLY/);
  assert.ok(skill.split('\n').length < 150, 'openspec-buddy-auto SKILL.md should stay focused on the controller entrypoint');
}

console.log('buddy-auto-driver tests passed');
