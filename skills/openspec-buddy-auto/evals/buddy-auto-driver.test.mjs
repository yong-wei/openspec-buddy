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
  return spawnSync('node', [helper, ...args], {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-driver-'));
const stateDir = path.join(tmp, 'state');
const coreDir = path.join(tmp, 'core');
const logFile = path.join(tmp, 'commands.log');
fs.mkdirSync(coreDir, { recursive: true });
makeExecutable(path.join(coreDir, 'mark-review.sh'), `#!/usr/bin/env bash\necho "mark-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'wait-for-review-clear.sh'), `#!/usr/bin/env bash\necho "wait-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'verify-review-clear.sh'), `#!/usr/bin/env bash\necho "verify-review $*" >> ${JSON.stringify(logFile)}\n`);
makeExecutable(path.join(coreDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho "claim $*" >> ${JSON.stringify(logFile)}\n`);

const env = {
  OPENSPEC_BUDDY_AUTO_STATE_DIR: stateDir,
  OPENSPEC_BUDDY_CORE_SCRIPT_DIR: coreDir,
  OPENSPEC_BUDDY_AUTO_HEAD: 'abc123',
};

{
  const result = run(['--issue', '12', '--pr', '34'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /mark-review\.sh 12 34/);
}

{
  const result = run(['--issue', '12', '--pr', '34', '--run-next'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(logFile, 'utf8'), /mark-review 12 34/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.ok(state.stages.mark_review_passed);
  assert.ok(state.stages.review_requested);
  assert.match(result.stdout, /stage: wait-review/);
}

{
  const result = run(['--issue', '12', '--pr', '34', '--run-next'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(logFile, 'utf8'), /wait-review 34/);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'pr-34.json'), 'utf8'));
  assert.equal(state.stages.review_clear.head, 'abc123');
  assert.match(result.stdout, /stage: merge-gates/);
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
  const result = run(['--issue', '12', '--pr', '88'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /mark_review_passed:[^\n]+invalid/);
  assert.doesNotMatch(result.stdout, /stage: merge-gates/);
}

{
  fs.copyFileSync(path.join(stateDir, 'pr-34.json'), path.join(stateDir, 'pr-89.json'));
  const result = run(['--issue', '12', '--pr', '89'], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage: mark-review/);
  assert.match(result.stdout, /state_context: invalid/);
  assert.doesNotMatch(result.stdout, /stage: merge-gates/);
}

{
  const skill = fs.readFileSync(path.resolve(__dirname, '../SKILL.md'), 'utf8');
  assert.match(skill, /<EXTREMELY_IMPORTANT>/);
  assert.match(skill, /buddy-auto-driver\.mjs/);
  assert.ok(skill.split('\n').length < 130, 'openspec-buddy-auto SKILL.md should stay focused on the driver entrypoint');
}

console.log('buddy-auto-driver tests passed');
