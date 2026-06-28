#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const controllerModule = await import(pathToFileURL(path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/controller-state.mjs')).href);
const laneStateModule = await import(pathToFileURL(path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/lane-state.mjs')).href);
const helper = path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/buddy-auto.mjs');
const singleDriverHelper = path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-controller-'));

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function makeEnv(name) {
  const root = path.join(tmp, name);
  const binDir = path.join(root, 'bin');
  const repoDir = path.join(root, 'repo');
  const stateDir = path.join(root, 'controller');
  const laneDir = path.join(root, 'lanes');
  const logFile = path.join(root, 'commands.log');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  makeExecutable(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "rev-parse" && "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "--worktree" ]]; then
  case "\${3:-}" in
    buddy.worktreeAlias) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBranch) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBase) printf 'origin/integration\\n'; exit 0 ;;
  esac
fi
if [[ "\${1:-}" == "status" && "\${2:-}" == "--porcelain" ]]; then
  if [[ "\${BUDDY_FAKE_DIRTY:-0}" == "1" ]]; then printf ' M dirty.txt\\n'; fi
  exit 0
fi
exit 1
`);
  const singleDriver = path.join(root, 'single-driver.mjs');
  const laneDriver = path.join(root, 'lane-driver.mjs');
  makeExecutable(singleDriver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({
  child: 'single',
  issue: process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || process.env.OPENSPEC_BUDDY_AUTO_ISSUE || '',
  pr: process.env.OPENSPEC_BUDDY_AUTO_TARGET_PR || process.env.OPENSPEC_BUDDY_AUTO_PR || '',
  head: process.env.OPENSPEC_BUDDY_AUTO_HEAD || '',
  change: process.env.OPENSPEC_BUDDY_AUTO_CHANGE || process.env.OPENSPEC_BUDDY_AUTO_CHANGE_ID || '',
  waitMode: process.env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE || '',
  goal: process.env.OPENSPEC_BUDDY_AUTO_GOAL || '',
  reviewFix: process.env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT || '',
  controllerChild: process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD || ''
}) + '\\n');
if (process.env.BUDDY_STUB_STATE_ISSUE) {
  const stateFile = ${JSON.stringify(root)} + '/stub-state.json';
  fs.writeFileSync(stateFile, JSON.stringify({
    issue: process.env.BUDDY_STUB_STATE_ISSUE || '',
    pr: process.env.BUDDY_STUB_STATE_PR || '',
    change: process.env.BUDDY_STUB_STATE_CHANGE || ''
  }));
  console.log('HANDOFF');
  console.log('stage: implement-or-open-pr');
  console.log('state_file: ' + stateFile);
  console.log('required_action: do external work');
  process.exit(0);
}
if (process.env.BUDDY_STUB_STATUS === 'BLOCKED') {
  console.log('BLOCKED');
  console.log('stage: stub-blocked');
  console.log('reason: stub blocker');
} else if (process.env.BUDDY_STUB_STAGE) {
  console.log('HANDOFF');
  console.log('stage: ' + process.env.BUDDY_STUB_STAGE);
  console.log('required_action: do external work');
} else {
  console.log('DONE');
  console.log('stage: stub-done');
}
`);
  makeExecutable(laneDriver, `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({
  child: 'lane',
  goal: process.env.OPENSPEC_BUDDY_AUTO_GOAL || '',
  lanes: process.env.OPENSPEC_BUDDY_AUTO_LANES || '',
  controllerChild: process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD || ''
}) + '\\n');
if (process.env.BUDDY_STUB_STATUS === 'BLOCKED') {
  console.log('BLOCKED');
  console.log('stage: lane-blocked');
  console.log('reason: lane blocker');
} else if (process.env.BUDDY_STUB_STAGE) {
  console.log('HANDOFF');
  console.log('stage: ' + process.env.BUDDY_STUB_STAGE);
  console.log('required_action: lane work');
} else {
  console.log('DONE');
  console.log('stage: lane-done');
}
`);
  return { root, binDir, repoDir, stateDir, laneDir, logFile, singleDriver, laneDriver };
}

function run(envInfo, extraEnv = {}, args = []) {
  return spawnSync(process.execPath, [helper, ...args], {
    cwd: envInfo.repoDir,
    env: {
      ...process.env,
      PATH: `${envInfo.binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR: envInfo.stateDir,
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: envInfo.laneDir,
      OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: envInfo.singleDriver,
      OPENSPEC_BUDDY_AUTO_LANE_DRIVER: envInfo.laneDriver,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

function readLog(envInfo) {
  return fs.existsSync(envInfo.logFile)
    ? fs.readFileSync(envInfo.logFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

function withControllerEnv(envInfo, fn) {
  const previousPath = process.env.PATH;
  const previousControllerDir = process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR;
  const previousLaneDir = process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
  process.env.PATH = `${envInfo.binDir}:${previousPath}`;
  process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR = envInfo.stateDir;
  process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = envInfo.laneDir;
  try {
    return fn();
  } finally {
    process.env.PATH = previousPath;
    if (previousControllerDir === undefined) delete process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR;
    else process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR = previousControllerDir;
    if (previousLaneDir === undefined) delete process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
    else process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = previousLaneDir;
  }
}

function readController(envInfo) {
  return withControllerEnv(envInfo, () => controllerModule.readControllerState({ cwd: envInfo.repoDir }));
}

function controllerPath(envInfo) {
  return withControllerEnv(envInfo, () => controllerModule.controllerStatePath(envInfo.repoDir));
}

{
  const envInfo = makeEnv('state-basics');
  process.env.PATH = `${envInfo.binDir}:${process.env.PATH}`;
  process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR = envInfo.stateDir;
  process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = envInfo.laneDir;
  const empty = controllerModule.readControllerState({ cwd: envInfo.repoDir });
  assert.equal(empty.mode, '');
  const initialized = controllerModule.initializeControllerState({ mode: 'multi', goal: true, maxLanes: '3' }, { cwd: envInfo.repoDir });
  assert.equal(initialized.mode, 'multi');
  assert.equal(initialized.goal, true);
  assert.equal(initialized.maxLanes, 3);
  const interrupted = controllerModule.writeInterrupt(initialized, { type: 'handoff', stage: 'implement', issue: '1', allowedWork: 'edit', child: 'single' }, { cwd: envInfo.repoDir });
  assert.equal(interrupted.interrupt.stage, 'implement');
  assert.equal(controllerModule.clearInterrupt(interrupted, { cwd: envInfo.repoDir }).interrupt, null);
  delete process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR;
  delete process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
}

{
  const envInfo = makeEnv('single-default');
  const result = run(envInfo);
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].child, 'single');
  const state = readController(envInfo);
  assert.equal(state.mode, 'single');
}

{
  const envInfo = makeEnv('multi-seed');
  let result = run(envInfo, { OPENSPEC_BUDDY_AUTO_MODE: 'multi', OPENSPEC_BUDDY_AUTO_LANES: '2', OPENSPEC_BUDDY_AUTO_GOAL: '1' });
  assert.equal(result.status, 0, result.stderr);
  result = run(envInfo, { OPENSPEC_BUDDY_AUTO_MODE: 'single', OPENSPEC_BUDDY_AUTO_LANES: '1', OPENSPEC_BUDDY_AUTO_GOAL: '0' });
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].child, 'lane');
  assert.equal(log[0].lanes, '2');
  assert.equal(log[1].child, 'lane');
  assert.equal(log[1].lanes, '2');
  const state = readController(envInfo);
  assert.equal(state.mode, 'multi');
  assert.equal(state.goal, true);
  assert.equal(state.maxLanes, 2);
}

{
  const envInfo = makeEnv('target-stale');
  let result = run(envInfo, { OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '123' });
  assert.equal(result.status, 0, result.stderr);
  result = run(envInfo, { OPENSPEC_BUDDY_AUTO_TARGET_PR: '456' });
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].issue, '123');
  assert.equal(log[1].issue, '123');
  assert.equal(log[1].pr, '');
}

{
  const envInfo = makeEnv('legacy-env-cleared');
  let result = run(envInfo);
  assert.equal(result.status, 0, result.stderr);
  fs.rmSync(envInfo.logFile, { force: true });
  result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_ISSUE: '999',
    OPENSPEC_BUDDY_AUTO_PR: '888',
    OPENSPEC_BUDDY_AUTO_HEAD: 'stale-head',
    OPENSPEC_BUDDY_AUTO_CHANGE: 'stale-change',
    OPENSPEC_BUDDY_AUTO_CHANGE_ID: 'stale-change-id',
    OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT: '1',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].issue, '');
  assert.equal(log[0].pr, '');
  assert.equal(log[0].head, '');
  assert.equal(log[0].change, '');
  assert.equal(log[0].waitMode, '');
  assert.equal(log[0].reviewFix, '');
}

{
  const envInfo = makeEnv('lane-wait-mode-cleared');
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: 'yield',
  });
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].waitMode, '');
}

{
  const envInfo = makeEnv('child-state-target-sync');
  const result = run(envInfo, {
    OPENSPEC_BUDDY_AUTO_GOAL: '1',
    BUDDY_STUB_STATE_ISSUE: '675',
    BUDDY_STUB_STATE_CHANGE: 'change-675',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  const state = readController(envInfo);
  assert.equal(state.target.issue, '675');
  assert.equal(state.target.change, 'change-675');
  assert.equal(state.interrupt.issue, '675');
}

{
  const envInfo = makeEnv('child-protocol-block');
  const badDriver = path.join(envInfo.root, 'bad-protocol-driver.mjs');
  makeExecutable(badDriver, `#!/usr/bin/env node
console.log('legacy helper completed without protocol');
`);
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER: badDriver });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /^stage: child-protocol$/m);
  assert.match(result.stdout, /without DONE, HANDOFF, or BLOCKED/);
  const state = readController(envInfo);
  assert.equal(state.interrupt.type, 'blocked');
  assert.equal(state.interrupt.stage, 'child-protocol');
}

{
  const envInfo = makeEnv('legacy-lane');
  process.env.PATH = `${envInfo.binDir}:${process.env.PATH}`;
  process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = envInfo.laneDir;
  const laneState = laneStateModule.emptyLaneState({ cwd: envInfo.repoDir, maxLanes: 3 });
  laneState.lanes.push({ id: 'issue-1', issue: '1', pr: '2', branch: 'change', stage: 'waiting_review' });
  laneStateModule.writeLaneState(laneState, { cwd: envInfo.repoDir });
  delete process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
  const result = run(envInfo, { OPENSPEC_BUDDY_AUTO_MODE: 'single' });
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[0].child, 'lane');
  assert.equal(log[0].lanes, '3');
  const state = readController(envInfo);
  assert.equal(state.mode, 'multi');
  assert.equal(state.maxLanes, 3);
}

{
  const envInfo = makeEnv('legacy-residual');
  process.env.PATH = `${envInfo.binDir}:${process.env.PATH}`;
  process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = envInfo.laneDir;
  const laneState = laneStateModule.emptyLaneState({ cwd: envInfo.repoDir, maxLanes: 2 });
  laneState.lanes.push({ id: 'cleared-blocked', stage: 'blocked', blockedReason: 'cleared' });
  laneStateModule.writeLaneState(laneState, { cwd: envInfo.repoDir });
  delete process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
  const result = run(envInfo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readLog(envInfo)[0].child, 'single');
}

{
  const envInfo = makeEnv('legacy-malformed');
  fs.mkdirSync(envInfo.laneDir, { recursive: true });
  fs.writeFileSync(path.join(envInfo.laneDir, 'dev1.json'), '{not-json');
  const result = run(envInfo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /legacy-lane-state/);
  assert.equal(readLog(envInfo).length, 0);
}

{
  const envInfo = makeEnv('review-fix');
  let result = run(envInfo, { BUDDY_STUB_STAGE: 'review-fix' });
  assert.equal(result.status, 0, result.stderr);
  let state = readController(envInfo);
  assert.equal(state.reviewFix.pending, true);
  result = run(envInfo);
  assert.equal(result.status, 0, result.stderr);
  const log = readLog(envInfo);
  assert.equal(log[1].reviewFix, '1');
}

{
  const envInfo = makeEnv('review-yield-clears-review-fix');
  let result = run(envInfo, { BUDDY_STUB_STAGE: 'review-fix' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readController(envInfo).reviewFix.pending, true);
  result = run(envInfo, { BUDDY_STUB_STAGE: 'review-yield' });
  assert.equal(result.status, 0, result.stderr);
  const state = readController(envInfo);
  assert.equal(state.reviewFix.pending, false);
  assert.equal(state.interrupt.stage, 'review-yield');
}

{
  const envInfo = makeEnv('reset-controller');
  let result = run(envInfo, { OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '1' });
  assert.equal(result.status, 0, result.stderr);
  result = run(envInfo, { BUDDY_FAKE_DIRTY: '1' }, ['--reset-controller-state']);
  assert.notEqual(result.status, 0);
  result = run(envInfo, {}, ['--reset-controller-state']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(controllerPath(envInfo)), false);
}

{
  const envInfo = makeEnv('reset-lane');
  process.env.PATH = `${envInfo.binDir}:${process.env.PATH}`;
  process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR = envInfo.laneDir;
  const laneState = laneStateModule.emptyLaneState({ cwd: envInfo.repoDir, maxLanes: 2 });
  laneState.lanes.push({ id: 'issue-1', issue: '1', stage: 'waiting_review' });
  laneStateModule.writeLaneState(laneState, { cwd: envInfo.repoDir });
  delete process.env.OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR;
  let result = run(envInfo, {}, ['--reset-lane-state']);
  assert.notEqual(result.status, 0);
  result = run(envInfo, { BUDDY_FAKE_DIRTY: '1' }, ['--reset-lane-state', '--reason', 'abandoned']);
  assert.notEqual(result.status, 0);
  result = run(envInfo, {}, ['--reset-lane-state', '--reason', 'abandoned']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(laneStateModule.laneStatePath(envInfo.repoDir)), false);
  assert.equal(fs.existsSync(controllerPath(envInfo)), false);
  assert.equal(fs.readdirSync(envInfo.laneDir).some((name) => name.endsWith('.bak')), true);
}

{
  const envInfo = makeEnv('reset-lane-without-lane-file-clears-controller');
  let result = run(envInfo, { OPENSPEC_BUDDY_AUTO_MODE: 'multi', OPENSPEC_BUDDY_AUTO_LANES: '2' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(controllerPath(envInfo)), true);
  assert.equal(fs.existsSync(laneStateModule.laneStatePath(envInfo.repoDir)), false);
  result = run(envInfo, {}, ['--reset-lane-state', '--reason', 'abandoned']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(controllerPath(envInfo)), false);
  assert.equal(fs.existsSync(laneStateModule.laneStatePath(envInfo.repoDir)), false);
  assert.doesNotMatch(result.stdout, /backup:/);
}

{
  const envInfo = makeEnv('direct-driver-guard');
  let result = run(envInfo, { OPENSPEC_BUDDY_AUTO_MODE: 'multi' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync(process.execPath, [singleDriverHelper, '--goal'], {
    cwd: envInfo.repoDir,
    env: {
      ...process.env,
      PATH: `${envInfo.binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR: envInfo.stateDir,
      OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR: envInfo.laneDir,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: envInfo.root,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCKED/m);
  assert.match(result.stdout, /controller-owned/);
}

{
  const mode = fs.statSync(helper).mode & 0o111;
  assert.notEqual(mode, 0, 'buddy-auto.mjs must be directly executable');
}

{
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/openspec-buddy-auto/SKILL.md'), 'utf8');
  const refs = [
    'driver-states.md',
    'execution-loop.md',
    'failure-recovery.md',
    'review-waiting.md',
  ].map((file) => fs.readFileSync(path.join(repoRoot, 'skills/openspec-buddy-auto/references', file), 'utf8')).join('\n');
  const evals = fs.readFileSync(path.join(repoRoot, 'skills/openspec-buddy-auto/evals/evals.json'), 'utf8');
  assert.match(skill, /scripts\/buddy-auto\.mjs/);
  for (const text of [skill, refs, evals]) {
    assert.doesNotMatch(text, /scripts\/buddy-auto-driver\.mjs/);
    assert.doesNotMatch(text, /scripts\/buddy-auto-lane-driver\.mjs/);
    assert.doesNotMatch(text, /scripts\/wait-for-review-clear\.sh/);
    assert.doesNotMatch(text, /scripts\/request-pr-review\.sh/);
    assert.doesNotMatch(text, /scripts\/review-response-gate\.sh/);
    assert.doesNotMatch(text, /scripts\/mark-review\.sh/);
  }
}

console.log('buddy-auto-controller tests passed');
