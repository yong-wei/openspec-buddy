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
    env: { ...env, ...options.env },
    encoding: 'utf8',
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-driver-'));
const stateDir = path.join(tmp, 'state');
const coreDir = path.join(tmp, 'core');
const logFile = path.join(tmp, 'commands.log');
fs.mkdirSync(coreDir, { recursive: true });
makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "helper stdout should stay quiet"\necho "wait-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(logFile)}\n`);

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
  assert.match(result.stdout, /stage: select-or-claim/);
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
  assert.match(result.stdout, /stage: select-or-claim/);
  assert.equal(fs.existsSync(mergedPrLogFile), false);
  assert.match(fs.readFileSync(mergedPrGhLogFile, 'utf8'), /pr view --json number,state --jq select\(\.state == "OPEN"\) \| \.number/);
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
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: claim-issue/);
  assert.match(result.stdout, /next_stage: implement-or-open-pr/);
  assert.equal(fs.readFileSync(targetIssueLogFile, 'utf8').trim(), 'claim 693');
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
  assert.equal(fs.readFileSync(targetIssueLogFile, 'utf8').trim(), 'claim 693');
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
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: wait-review/);
  assert.equal(fs.readFileSync(targetPrLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
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
  assert.equal(fs.readFileSync(bothTargetLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
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
  assert.match(result.stdout, /stage: claim-issue/);
  assert.equal(fs.readFileSync(cliTargetLogFile, 'utf8').trim(), 'claim 701');
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
  makeExecutable(path.join(cliTargetPrBinDir, 'gh'), `#!/usr/bin/env bash\nif [[ "$*" == "pr view 694 --json body --jq .body" ]]; then echo "origin issue: #693"; exit 0; fi\nif [[ "$*" == "pr view 694 --json headRefOid --jq .headRefOid" ]]; then echo target-head; exit 0; fi\nexit 1\n`);
  const result = run(['--target-pr', '694', '--issue', '999', '--pr', '448', '--head', 'stale-head'], {
    env: {
      OPENSPEC_BUDDY_AUTO_STATE_DIR: cliTargetPrStateDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: cliTargetPrCoreDir,
      PATH: `${cliTargetPrBinDir}:${process.env.PATH}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(cliTargetPrLogFile, 'utf8').trim(), [
    'mark-review 693 694',
    'wait-review 694',
  ].join('\n'));
}

{
  const result = run(['--dry-run', '--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /mark-review\.sh 12 34/);
}

{
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /mark-review 12 34/);
  assert.match(log, /wait-review 34/);
  assert.match(result.stdout, /^DONE/m);
  assert.match(result.stdout, /stage: wait-review/);
  assert.doesNotMatch(result.stdout, /helper stdout should stay quiet/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.ok(state.stages.mark_review_passed);
  assert.ok(state.stages.review_requested);
  assert.ok(state.stages.review_clear);
}

{
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(logFile, 'utf8'), /verify-review 34/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.equal(state.stages.review_clear.head, 'abc123');
  assert.ok(state.stages.merge_gates_passed);
  assert.match(result.stdout, /stage: merge-gates/);
  assert.match(result.stdout, /next_stage: merge-or-achieve/);
}

{
  const before = fs.readFileSync(logFile, 'utf8');
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /stage: merge-or-achieve/);
  assert.equal(fs.readFileSync(logFile, 'utf8'), before);
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
  assert.match(result.stdout, /^DONE/m);
  assert.equal(fs.readFileSync(noArgLogFile, 'utf8').trim(), [
    'mark-review 55 56',
    'wait-review 56',
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
  assert.match(skill, /buddy-auto-driver\.mjs/);
  assert.match(skill, /DO NOT OUTPUT/);
  assert.match(skill, /WAIT SILENTLY/);
  assert.ok(skill.split('\n').length < 130, 'openspec-buddy-auto SKILL.md should stay focused on the driver entrypoint');
}

console.log('buddy-auto-driver tests passed');
