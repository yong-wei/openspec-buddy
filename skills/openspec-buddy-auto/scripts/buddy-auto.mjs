#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearInterrupt,
  createControllerRunId,
  controllerStatePath,
  initializeControllerState,
  readControllerState,
  resetControllerState,
  resetLaneState,
  setReviewFix,
  writeControllerState,
  writeInterrupt,
} from './controller-state.mjs';
import { reconcileControllerState } from './controller-reconciler.mjs';
import { readLaneState } from './lane-state.mjs';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const singleDriver = process.env.OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER || path.join(autoScriptDir, 'buddy-auto-driver.mjs');
const laneDriver = process.env.OPENSPEC_BUDDY_AUTO_LANE_DRIVER || path.join(autoScriptDir, 'buddy-auto-lane-driver.mjs');

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function gitDirty() {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git status failed').trim());
  return Boolean(result.stdout.trim());
}

function parseArgs(argv) {
  const opts = { resetController: false, resetLane: false, resetReason: '', recoverUnauthorizedMerge: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset-controller-state') opts.resetController = true;
    else if (arg === '--reset-lane-state') opts.resetLane = true;
    else if (arg === '--recover-unauthorized-merge') opts.recoverUnauthorizedMerge = true;
    else if (arg === '--reason') opts.resetReason = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function seedFromEnv() {
  const mode = String(process.env.OPENSPEC_BUDDY_AUTO_MODE || '').toLowerCase();
  const targetIssue = process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '';
  const targetPr = process.env.OPENSPEC_BUDDY_AUTO_TARGET_PR || '';
  return {
    mode,
    goal: truthy(process.env.OPENSPEC_BUDDY_AUTO_GOAL),
    maxLanes: process.env.OPENSPEC_BUDDY_AUTO_LANES || '',
    issue: targetIssue,
    pr: targetIssue ? '' : targetPr,
    change: process.env.OPENSPEC_BUDDY_AUTO_CHANGE || '',
  };
}

function emit(title, entries = [], output = '') {
  console.log(title);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    console.log(`${key}: ${value}`);
  }
  if (output) {
    console.log('output_excerpt:');
    console.log(output.split('\n').filter(Boolean).slice(-20).join('\n'));
  }
}

function parseBlock(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const status = lines.find((line) => /^(DONE|HANDOFF|BLOCKED)$/.test(line.trim()))?.trim() || '';
  const fields = {};
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2];
  }
  return { status, fields };
}

function compact(result) {
  return [result.stdout || '', result.stderr || ''].join('\n').trim();
}

function childEnv(state, opts = {}, controllerRunId = '') {
  const env = {
    ...process.env,
    OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1',
  };
  if (state.goal) env.OPENSPEC_BUDDY_AUTO_GOAL = '1';
  else delete env.OPENSPEC_BUDDY_AUTO_GOAL;
  if (state.mode === 'multi') env.OPENSPEC_BUDDY_AUTO_LANES = String(state.maxLanes || 2);
  if (controllerRunId) env.OPENSPEC_BUDDY_AUTO_CONTROLLER_RUN_ID = controllerRunId;
  if (state.target.issue) env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE = state.target.issue;
  else delete env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE;
  if (state.target.pr) env.OPENSPEC_BUDDY_AUTO_TARGET_PR = state.target.pr;
  else delete env.OPENSPEC_BUDDY_AUTO_TARGET_PR;
  if (state.target.change) env.OPENSPEC_BUDDY_AUTO_CHANGE = state.target.change;
  else delete env.OPENSPEC_BUDDY_AUTO_CHANGE;
  delete env.OPENSPEC_BUDDY_AUTO_ISSUE;
  delete env.OPENSPEC_BUDDY_AUTO_PR;
  delete env.OPENSPEC_BUDDY_AUTO_HEAD;
  delete env.OPENSPEC_BUDDY_AUTO_CHANGE_ID;
  delete env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE;
  if (state.reviewFix.pending) env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT = '1';
  else delete env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT;
  if (opts.recoverUnauthorizedMerge) {
    env.OPENSPEC_BUDDY_AUTO_UNAUTHORIZED_MERGE_RECOVERY = '1';
    env.OPENSPEC_BUDDY_AUTO_RECOVERY_REASON = opts.resetReason || '';
  } else {
    delete env.OPENSPEC_BUDDY_AUTO_UNAUTHORIZED_MERGE_RECOVERY;
    delete env.OPENSPEC_BUDDY_AUTO_RECOVERY_REASON;
  }
  return env;
}

function runChild(state, opts = {}, controllerRunId = '') {
  const command = state.mode === 'multi' ? laneDriver : singleDriver;
  const args = state.mode === 'multi' ? [command, '--poll-once'] : [command];
  const env = childEnv(state, opts, controllerRunId);
  if (state.mode === 'multi') env.OPENSPEC_BUDDY_AUTO_LANE_POLL_ONCE = '1';
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function laneForIssue(state, issue) {
  if (!issue) return null;
  try {
    const laneState = readLaneState({ maxLanes: state.maxLanes || 1 });
    return (laneState.lanes || []).find((lane) => String(lane.issue || '') === String(issue)) || null;
  } catch {
    return null;
  }
}

function syncTargetPrFromIssueLane(state) {
  const issue = String(state.target?.issue || '');
  const targetPr = String(state.target?.pr || '');
  if (!issue || !targetPr) return state;
  const lane = laneForIssue(state, issue);
  if (!lane) return state;
  const lanePr = String(lane.pr || '');
  if (lanePr === targetPr) return state;

  const nextPr = lanePr || '';
  const next = {
    ...state,
    target: { ...state.target, pr: nextPr },
  };
  if (String(next.reviewFix?.pr || '') === targetPr && nextPr !== targetPr) {
    next.reviewFix = { pending: false, head: '', pr: '', evidence: '' };
  }
  if (
    next.interrupt
    && String(next.interrupt.issue || '') === issue
    && String(next.interrupt.pr || '') === targetPr
  ) {
    next.interrupt = { ...next.interrupt, pr: nextPr };
  }
  return writeControllerState(next);
}

function isReviewFixStage(stage) {
  return ['review-fix', 'review_fix', 'review-response-gate'].includes(String(stage || ''));
}

function shouldClearReviewFix(status, stage) {
  if (status !== 'DONE' && status !== 'HANDOFF') return false;
  return [
    'review-response-gate',
    'review-yield',
    'wait-review',
    'review_clear',
    'merge-pr',
    'achieved',
    'mark-achieved-post-merge',
    'stub-done',
    'lane-done',
  ].includes(String(stage || ''));
}

function shouldClearTarget(status, stage) {
  if (status !== 'DONE') return false;
  return ['achieved', 'mark-achieved-post-merge', 'lane-done'].includes(String(stage || ''));
}

function readChildState(fields) {
  const file = fields.state_file || '';
  if (!file || !fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function syncTargetFromChildState(state, parsed) {
  const childState = readChildState(parsed.fields);
  const target = {
    issue: parsed.fields.issue || childState.issue || state.target.issue || '',
    pr: parsed.fields.pr || childState.pr || state.target.pr || '',
    change: parsed.fields.change || childState.change || state.target.change || '',
  };
  if (
    target.issue === state.target.issue
    && target.pr === state.target.pr
    && target.change === state.target.change
  ) {
    return state;
  }
  return writeControllerState({ ...state, target });
}

function handleChildResult(state, result) {
  const text = compact(result);
  const parsed = parseBlock(result.stdout);
  const stage = parsed.fields.stage || '';
  if (result.status !== 0 && !parsed.status) {
    const next = writeInterrupt(state, {
      type: 'blocked',
      stage: 'child-process',
      blockedCode: `exit-${result.status ?? 1}`,
      allowedWork: 'Fix only this blocker, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('BLOCKED', [
      ['stage', 'child-process'],
      ['state_file', controllerStatePath()],
      ['allowed_work', next.interrupt.allowedWork],
      ['resume_action', 'rerun buddy-auto.mjs'],
    ], text);
    return;
  }
  if (result.status !== 0 && parsed.status !== 'BLOCKED') {
    const next = writeInterrupt(state, {
      type: 'blocked',
      stage: 'child-process',
      blockedCode: `exit-${result.status ?? 1}`,
      allowedWork: 'Fix only this blocker, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('BLOCKED', [
      ['stage', 'child-process'],
      ['state_file', controllerStatePath()],
      ['allowed_work', next.interrupt.allowedWork],
      ['resume_action', 'rerun buddy-auto.mjs'],
      ['reason', `Child driver exited ${result.status ?? 1} after ${parsed.status}.`],
    ], text);
    return;
  }
  if (!parsed.status) {
    const next = writeInterrupt(state, {
      type: 'blocked',
      stage: 'child-protocol',
      blockedCode: 'missing-status',
      allowedWork: 'Fix the child driver output protocol, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('BLOCKED', [
      ['stage', 'child-protocol'],
      ['state_file', controllerStatePath()],
      ['allowed_work', next.interrupt.allowedWork],
      ['resume_action', 'rerun buddy-auto.mjs'],
      ['reason', 'Child driver exited successfully without DONE, HANDOFF, or BLOCKED.'],
    ], text);
    return;
  }
  state = syncTargetFromChildState(state, parsed);
  if (isReviewFixStage(stage)) {
    state = setReviewFix(state, {
      pending: true,
      head: parsed.fields.head || state.reviewFix.head || '',
      pr: parsed.fields.pr || state.reviewFix.pr || state.target.pr || '',
      evidence: 'response-gate-required',
    });
  }

  if (parsed.status === 'HANDOFF') {
    if (shouldClearReviewFix(parsed.status, stage)) {
      state = setReviewFix(state, { pending: false }, {});
    }
    const next = writeInterrupt(state, {
      type: 'handoff',
      stage,
      issue: parsed.fields.issue || state.target.issue,
      pr: parsed.fields.pr || state.target.pr,
      allowedWork: parsed.fields.agent_action || parsed.fields.required_action || 'Perform only the requested external work, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('HANDOFF', [
      ['stage', stage],
      ['state_file', controllerStatePath()],
      ['allowed_work', next.interrupt.allowedWork],
      ['resume_action', 'rerun buddy-auto.mjs'],
    ]);
    return;
  }

  if (parsed.status === 'BLOCKED') {
    const next = writeInterrupt(state, {
      type: 'blocked',
      stage,
      lane: parsed.fields.lane || '',
      issue: parsed.fields.issue || state.target.issue,
      pr: parsed.fields.pr || state.target.pr,
      branch: parsed.fields.branch || '',
      head: parsed.fields.head || state.reviewFix.head || '',
      blockedCode: stage || parsed.fields.reason || 'blocked',
      reason: parsed.fields.reason || '',
      allowedWork: 'Fix only this blocker, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('BLOCKED', [
      ['stage', stage],
      ['lane', next.interrupt.lane],
      ['issue', next.interrupt.issue],
      ['pr', next.interrupt.pr],
      ['branch', next.interrupt.branch],
      ['head', next.interrupt.head],
      ['state_file', controllerStatePath()],
      ['allowed_work', next.interrupt.allowedWork],
      ['resume_action', 'rerun buddy-auto.mjs'],
      ['reason', parsed.fields.reason || ''],
    ], text);
    return;
  }

  let next = clearInterrupt(state);
  if (shouldClearReviewFix(parsed.status, stage)) {
    next = setReviewFix(next, { pending: false }, {});
  }
  if (shouldClearTarget(parsed.status, stage)) {
    next = writeControllerState({ ...next, target: { issue: '', pr: '', change: '' } });
  }
  emit('DONE', [
    ['stage', stage || 'controller'],
    ['state_file', controllerStatePath()],
    ['resume_action', parsed.status === 'DONE' ? '' : 'rerun buddy-auto.mjs'],
  ], text);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seed = seedFromEnv();
  if (opts.help) {
    console.log('Usage: buddy-auto.mjs [--reset-controller-state] [--reset-lane-state --reason <why>] [--recover-unauthorized-merge --reason <why>]');
    return;
  }
  if (opts.resetController || opts.resetLane) {
    if (gitDirty()) throw new Error('Refusing to reset Buddy Auto state while git worktree is dirty.');
    if (opts.resetLane) {
      const backup = resetLaneState({ reason: opts.resetReason });
      emit('DONE', [
        ['stage', 'reset-lane-state'],
        ['backup', backup],
      ]);
      return;
    }
    resetControllerState();
    emit('DONE', [['stage', 'reset-controller-state']]);
    return;
  }

  let state;
  try {
    state = initializeControllerState(seed);
  } catch (error) {
    if (error.code === 'LEGACY_LANE_STATE') {
      emit('BLOCKED', [
        ['stage', 'legacy-lane-state'],
        ['state_file', controllerStatePath()],
        ['allowed_work', 'Repair the local lane cache or run buddy-auto.mjs --reset-lane-state --reason "<why>" if it is abandoned.'],
        ['resume_action', 'rerun buddy-auto.mjs'],
        ['reason', error.message],
      ]);
      return;
    }
    throw error;
  }

  const controllerRunId = createControllerRunId();
  state = reconcileControllerState(state).state;
  state = syncTargetPrFromIssueLane(state);
  handleChildResult(state, runChild(state, opts, controllerRunId));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
