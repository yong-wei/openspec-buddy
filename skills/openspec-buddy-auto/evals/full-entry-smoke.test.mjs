#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../scripts/buddy-auto.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-full-entry-'));
const bin = path.join(root, 'bin');
const repo = path.join(root, 'repo');
const controllerDir = path.join(root, 'controller');
const laneDir = path.join(root, 'lanes');
const driver = path.join(root, 'driver.mjs');
const log = path.join(root, 'driver.log');
fs.mkdirSync(bin); fs.mkdirSync(repo); fs.mkdirSync(controllerDir); fs.mkdirSync(laneDir);
fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash
if [[ "\${1:-}" == rev-parse && "\${2:-}" == --show-toplevel ]]; then printf '%s\\n' ${JSON.stringify(repo)}; exit 0; fi
if [[ "\${1:-}" == rev-parse && "\${2:-}" == --git-common-dir ]]; then printf '%s\\n' ${JSON.stringify(path.join(root, 'git-common'))}; exit 0; fi
if [[ "\${1:-}" == config && "\${2:-}" == --worktree ]]; then
  case "\${3:-}" in buddy.worktreeAlias|buddy.boundBranch) printf 'dev1\\n';; buddy.boundBase) printf 'origin/integration\\n';; esac; exit 0
fi
if [[ "\${1:-}" == status && "\${2:-}" == --porcelain ]]; then exit 0; fi
exit 1
`, { mode: 0o755 });
fs.writeFileSync(driver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  issue: process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '',
  change: process.env.OPENSPEC_BUDDY_AUTO_CHANGE || '',
  recovery: process.env.OPENSPEC_BUDDY_AUTO_UNAUTHORIZED_MERGE_RECOVERY || '',
  reason: process.env.OPENSPEC_BUDDY_AUTO_RECOVERY_REASON || '',
}) + '\\n');
const status = process.env.SMOKE_STATUS || 'DONE';
console.log(status); console.log('stage: smoke-' + status.toLowerCase());
if (status === 'HANDOFF') console.log('required_action: preserve this output');
if (status === 'BLOCKED') console.log('reason: preserve this blocker');
`, { mode: 0o755 });

const state = {
  version: 1,
  worktree: { path: repo, alias: 'dev1', pathHash: 'ignored', boundBranch: 'dev1', boundBase: 'origin/integration' },
  mode: 'single', goal: false, maxLanes: 1,
  target: { issue: '123', pr: '', change: 'existing-change' },
  reviewFix: { pending: false, head: '', pr: '', evidence: '' }, interrupt: null, updatedAt: '2026-01-01T00:00:00.000Z',
};
fs.writeFileSync(path.join(controllerDir, 'dev1.json'), `${JSON.stringify(state, null, 2)}\n`);

function run(status, args = []) {
  return spawnSync(process.execPath, [entry, 'full', ...args], {
    cwd: repo,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR: controllerDir,
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: laneDir,
      OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: driver,
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '999',
      OPENSPEC_BUDDY_AUTO_CHANGE: 'new-change',
      SMOKE_STATUS: status,
    },
    encoding: 'utf8',
  });
}

for (const status of ['DONE', 'HANDOFF', 'BLOCKED']) {
  const result = run(status, ['--recover-unauthorized-merge', '--reason', 'approved recovery']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^${status}\\n`));
  assert.doesNotMatch(result.stdout, /"mode"|"result"/);
}
const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
for (const call of calls) {
  assert.equal(call.issue, '123', 'existing controller target must win over a new target seed');
  assert.equal(call.change, 'existing-change');
  assert.equal(call.recovery, '1');
  assert.equal(call.reason, 'approved recovery');
}

const badArg = run('DONE', ['--not-a-controller-option']);
assert.equal(badArg.status, 1);
assert.match(badArg.stderr, /^Unknown argument: --not-a-controller-option\n$/);
assert.equal(badArg.stdout, '');

console.log('full public entry smoke tests passed');
