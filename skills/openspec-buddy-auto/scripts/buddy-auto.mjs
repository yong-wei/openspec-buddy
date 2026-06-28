#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearInterrupt,
  controllerStatePath,
  initializeControllerState,
  readControllerState,
  resetControllerState,
  resetLaneState,
  setReviewFix,
  writeControllerState,
  writeInterrupt,
} from './controller-state.mjs';

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
  const opts = { resetController: false, resetLane: false, resetReason: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset-controller-state') opts.resetController = true;
    else if (arg === '--reset-lane-state') opts.resetLane = true;
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

function childEnv(state) {
  const env = {
    ...process.env,
    OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD: '1',
  };
  if (state.goal) env.OPENSPEC_BUDDY_AUTO_GOAL = '1';
  else delete env.OPENSPEC_BUDDY_AUTO_GOAL;
  if (state.mode === 'multi') env.OPENSPEC_BUDDY_AUTO_LANES = String(state.maxLanes || 2);
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
  return env;
}

function runChild(state) {
  const command = state.mode === 'multi' ? laneDriver : singleDriver;
  return spawnSync(process.execPath, [command], {
    cwd: process.cwd(),
    env: childEnv(state),
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function isReviewFixStage(stage) {
  return ['review-fix', 'review_fix', 'review-response-gate'].includes(String(stage || ''));
}

function shouldClearReviewFix(status, stage) {
  if (status !== 'DONE' && status !== 'HANDOFF') return false;
  return ['review-response-gate', 'review-yield', 'wait-review', 'review_clear', 'stub-done', 'lane-done'].includes(String(stage || ''));
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
  if (result.status !== 0) {
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

  const parsed = parseBlock(result.stdout);
  const stage = parsed.fields.stage || '';
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
      blockedCode: stage || parsed.fields.reason || 'blocked',
      allowedWork: 'Fix only this blocker, then rerun buddy-auto.mjs.',
      child: state.mode,
    });
    emit('BLOCKED', [
      ['stage', stage],
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
  emit('DONE', [
    ['stage', stage || 'controller'],
    ['state_file', controllerStatePath()],
    ['resume_action', parsed.status === 'DONE' ? '' : 'rerun buddy-auto.mjs'],
  ], text);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: buddy-auto.mjs [--reset-controller-state] [--reset-lane-state --reason <why>]');
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
    state = initializeControllerState(seedFromEnv());
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

  handleChildResult(state, runChild(state));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
