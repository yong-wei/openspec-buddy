#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireLaneLock,
  gitRoot,
  laneBlocksGoalCompletion,
  laneNeedsReconciliation,
  laneStateDir,
  normalizeMaxLanes,
  readLaneState,
  reservedLaneCount,
  selectorExcludedIssues,
  writeLaneState,
} from './lane-state.mjs';
import { decideLaneAction } from './auto-decision.mjs';
import { applyReviewTruthToLane, classifyProbe, laneReviewTruth, mergeReviewTruth } from './review-truth.mjs';
import { runLaneAction } from './lane-action-runner.mjs';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(autoScriptDir, '../../openspec-buddy/scripts');
const coreScriptDir = process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;
const singleDriver = process.env.OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER || path.join(autoScriptDir, 'buddy-auto-driver.mjs');
const laneSwitchGate = path.join(autoScriptDir, 'lane-switch-gate.mjs');
const prTruthCache = new Map();

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function controllerChildMode() {
  return truthy(process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD);
}

function run(command, args, options = {}) {
  const timeoutMs = Number(process.env.OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS || 120000);
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const error = new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
    error.status = result.status ?? 1;
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }
  return result;
}

function commandLine(command) {
  return command.map((value) => {
    if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
    return `'${String(value).replaceAll("'", "'\\''")}'`;
  }).join(' ');
}

function emit(title, entries = [], output = '') {
  console.log(title);
  const extra = controllerChildMode()
    ? [
        ['resume_action', 'rerun-controller'],
        ['driver_internal', 'true'],
      ]
    : [];
  for (const [key, value] of [...entries, ...extra]) {
    if (value === undefined || value === null || value === '') continue;
    console.log(`${key}: ${value}`);
  }
  if (output) {
    console.log('output_excerpt:');
    console.log(output.split('\n').filter(Boolean).slice(-20).join('\n'));
  }
}

function emitDone(entries = [], output = '') {
  emit('DONE', entries, output);
}

function emitBlocked(entries = [], output = '') {
  emit('BLOCKED', entries, output);
}

function emitHandoff(entries = [], output = '') {
  emit('HANDOFF', entries, output);
}

function parseArgs(argv) {
  const opts = {
    goal: truthy(process.env.OPENSPEC_BUDDY_AUTO_GOAL),
    pollOnce: truthy(process.env.OPENSPEC_BUDDY_AUTO_LANE_POLL_ONCE),
    reconcile: false,
    releaseLaneIssue: '',
    releaseReason: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--goal' || arg === '--goal-loop') opts.goal = true;
    else if (arg === '--poll-once') opts.pollOnce = true;
    else if (arg === '--reconcile') opts.reconcile = true;
    else if (arg === '--release-lane') opts.releaseLaneIssue = argv[++i] || '';
    else if (arg === '--reason') opts.releaseReason = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function currentBranch() {
  const result = run('git', ['branch', '--show-current'], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function gitHead() {
  const result = run('git', ['rev-parse', 'HEAD'], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function gitIsAncestor(base, head) {
  if (!base || !head) return false;
  const result = run('git', ['merge-base', '--is-ancestor', String(base), String(head)], { allowFailure: true });
  return result.status === 0;
}

function boundBranch() {
  const result = run('git', ['config', '--worktree', 'buddy.boundBranch'], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function ensureBoundBranch() {
  const branch = boundBranch();
  if (branch && currentBranch() !== branch) {
    run('git', ['switch', branch]);
  }
  run(path.join(coreScriptDir, 'verify-bound-worktree.sh'), ['--phase', 'goal-loop-start']);
}

function parseDriverStage(stdout) {
  const match = String(stdout || '').match(/^([A-Z]+)\n(?:[\s\S]*?\n)?stage:\s*(.+)$/m);
  if (!match) return { status: '', stage: '' };
  return { status: match[1], stage: match[2].trim() };
}

function parseDriverState(stdout) {
  const match = String(stdout || '').match(/^state_file:\s*(.+)$/m);
  if (!match) return {};
  const stateFile = match[1].trim();
  if (!stateFile || !fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function parseSelection(stdout) {
  try {
    const data = JSON.parse(stdout || '{}');
    return data.selected || null;
  } catch {
    return null;
  }
}

function isTransientFailure(output) {
  return /\b(EOF|timeout|timed out|ECONNRESET|ETIMEDOUT|rate.?limit|secondary rate|abuse detection|502|503|504)\b/i
    .test(String(output || ''));
}

function clearRetryableState(lane) {
  lane.retryableSince = '';
  lane.retryAttempts = 0;
  lane.retryableStage = '';
  lane.retryableHead = '';
}

function markLaneFailure(state, lane, reason, { retryable = false, source = '' } = {}) {
  const previousStage = lane.stage;
  lane.stage = retryable ? 'retryable_blocked' : 'blocked';
  lane.blockedReason = reason || 'lane failed';
  lane.lastResult = source || lane.lastResult || '';
  if (retryable) {
    if (previousStage !== 'retryable_blocked') {
      lane.retryableStage = previousStage;
      lane.retryableHead = lane.head || '';
    }
    lane.retryableSince ||= new Date().toISOString();
    lane.retryAttempts = Number(lane.retryAttempts || 0) + 1;
  } else {
    clearRetryableState(lane);
  }
  lane.updatedAt = new Date().toISOString();
  writeLaneState(state);
}

function upsertLane(state, lanePatch) {
  const id = lanePatch.id || (lanePatch.issue ? `issue-${lanePatch.issue}` : `pr-${lanePatch.pr}`);
  const updatedAt = new Date().toISOString();
  const nextLane = {
    id,
    issue: '',
    change: '',
    branch: '',
    pr: '',
    head: '',
    stage: 'implementing',
    claimId: '',
    reviewRequestedAt: '',
    reviewRetryCount: 0,
    lastProbeAt: '',
    lastSignature: '',
    lastRequestState: '',
    lastResult: '',
    blockedReason: '',
    retryableSince: '',
    retryAttempts: 0,
    updatedAt,
    ...lanePatch,
    id,
    updatedAt,
  };
  const existingIndex = state.lanes.findIndex((lane) => lane.id === id);
  if (existingIndex >= 0) state.lanes[existingIndex] = { ...state.lanes[existingIndex], ...nextLane };
  else state.lanes.push(nextLane);
  return nextLane;
}

function runSingleDriverForIssue(issue) {
  return run(process.execPath, [singleDriver], {
    allowFailure: true,
    env: {
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: String(issue),
      OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: 'yield',
    },
  });
}

function runSingleDriverForLane(lane) {
  const env = {
    OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: '',
    OPENSPEC_BUDDY_AUTO_TARGET_PR: '',
    OPENSPEC_BUDDY_AUTO_ISSUE: String(lane.issue || ''),
    OPENSPEC_BUDDY_AUTO_PR: String(lane.pr || ''),
    OPENSPEC_BUDDY_AUTO_HEAD: String(lane.head || ''),
    OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: lane.stage === 'merge_ready' ? 'verify-once' : 'yield',
  };
  if (lane.stage === 'review_fix') {
    env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT = '1';
  }
  return run(process.execPath, [singleDriver], {
    allowFailure: true,
    env,
  });
}

function runSelector(state) {
  const excludeFile = path.join(laneStateDir(), `exclude-${process.pid}.json`);
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.writeFileSync(excludeFile, `${JSON.stringify(selectorExcludedIssues(state))}\n`);
  try {
    return run(path.join(coreScriptDir, 'select-next-change.sh'), [], {
      allowFailure: true,
      env: { OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE: excludeFile },
    });
  } finally {
    fs.rmSync(excludeFile, { force: true });
  }
}

function safeYieldCurrentLane(lane) {
  const args = ['--safe-yield', '--issue', String(lane.issue), '--pr', String(lane.pr), '--branch', String(lane.branch)];
  if (lane.head) args.push('--head', String(lane.head));
  return run(process.execPath, [laneSwitchGate, ...args], { allowFailure: true });
}

function resumeLane(lane) {
  const args = ['--resume', '--issue', String(lane.issue), '--pr', String(lane.pr), '--branch', String(lane.branch)];
  if (lane.head) args.push('--head', String(lane.head));
  return run(process.execPath, [laneSwitchGate, ...args], { allowFailure: true });
}

function prHead(pr) {
  if (!pr) return '';
  const truth = cachedPrTruth(pr);
  return truth.status === 0 ? String(truth.data?.headRefOid || '') : '';
}

function prTruth(pr) {
  if (!pr) return { status: 1, reason: 'lane has no PR' };
  const result = run('gh', ['pr', 'view', String(pr), '--json', 'state,headRefOid,headRefName,mergedAt,number'], { allowFailure: true });
  if (result.status !== 0) {
    return {
      status: result.status || 1,
      reason: result.stderr || result.stdout || 'gh pr view failed',
    };
  }
  try {
    return { status: 0, data: JSON.parse(result.stdout || '{}') };
  } catch {
    return { status: 1, reason: 'gh pr view did not return JSON' };
  }
}

function cachedPrTruth(pr) {
  if (!pr) return { status: 1, reason: 'lane has no PR' };
  const key = String(pr);
  if (prTruthCache.has(key)) return prTruthCache.get(key);
  const truth = prTruth(pr);
  if (truth.status === 0) prTruthCache.set(key, truth);
  return truth;
}

function invalidatePrTruth(pr) {
  if (pr) prTruthCache.delete(String(pr));
}

function forceRefreshPrTruth(pr) {
  invalidatePrTruth(pr);
  return cachedPrTruth(pr);
}

function collectLaneTruth(lane, { needPr = true } = {}) {
  const truth = {
    branch: currentBranch(),
    localHead: gitHead(),
    pr: null,
    prError: '',
  };
  if (needPr && lane.pr) {
    const pr = cachedPrTruth(lane.pr);
    if (pr.status === 0) truth.pr = pr.data;
    else truth.prError = pr.reason || 'gh pr view failed';
  }
  return truth;
}

function normalizeLocalAhead(lane, truth) {
  const remoteHead = String(truth.pr?.headRefOid || '');
  if (!lane.pr || !truth.localHead || !lane.head || truth.localHead === lane.head) return false;
  if (truth.branch !== lane.branch) return false;
  if (!truth.pr || String(truth.pr.state || '').toUpperCase() !== 'OPEN') return false;
  if (!lane.branch || truth.pr.headRefName !== lane.branch) return false;
  if (!remoteHead || remoteHead !== lane.head) return false;
  if (!gitIsAncestor(lane.head, truth.localHead)) return false;
  lane.stage = 'review_fix';
  lane.head = truth.localHead;
  lane.blockedReason = '';
  lane.lastResult = 'local-review-fix-head-detected';
  clearRetryableState(lane);
  lane.updatedAt = new Date().toISOString();
  return true;
}

function parseJsonResult(stdout, fallbackReason = 'invalid JSON output') {
  if (!String(stdout || '').trim()) return { ok: false, reason: fallbackReason };
  try {
    return { ok: true, data: JSON.parse(stdout || '{}') };
  } catch {
    return { ok: false, reason: fallbackReason };
  }
}

function safeToRerun(result) {
  return /\bsafe_to_rerun:\s*true\b/i.test([result.stdout || '', result.stderr || ''].join('\n'));
}

function bridgeIssuePr(issue) {
  const result = run(path.join(coreScriptDir, 'find-issue-pr.sh'), [String(issue)], { allowFailure: true });
  if (result.status !== 0) {
    return {
      status: result.status || 1,
      reason: result.stderr || result.stdout || 'find-issue-pr.sh failed',
    };
  }
  try {
    return { status: 0, data: JSON.parse(result.stdout || '{}') };
  } catch {
    return { status: 1, reason: 'find-issue-pr.sh did not return JSON' };
  }
}

function refreshLanePrFields(lane, data) {
  if (data?.pr || data?.number) lane.pr = String(data.pr || data.number);
  if (data?.head || data?.headRefOid) lane.head = String(data.head || data.headRefOid);
  if (data?.headRefName) lane.branch = String(data.headRefName);
}

function probeLane(lane) {
  return run(path.join(coreScriptDir, 'probe-review-state.sh'), [String(lane.pr)], {
    allowFailure: true,
    env: {
      OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD: '1',
      OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE: lane.lastSignature || '',
      OPENSPEC_BUDDY_REVIEW_LAST_HEAD: lane.head || '',
      OPENSPEC_BUDDY_REVIEW_PREVIOUS_REQUEST_STATE: lane.lastRequestState || '',
      OPENSPEC_BUDDY_REVIEW_REQUESTED_AT: lane.reviewRequestedAt || '',
      OPENSPEC_BUDDY_REVIEW_RETRY_COUNT: String(lane.reviewRetryCount || 0),
    },
  });
}

function checkLaneReview(lane) {
  return run(path.join(coreScriptDir, 'check-review-clear-once.sh'), [String(lane.pr)], { allowFailure: true });
}

function verifyAchievedTruth(lane) {
  return run(path.join(coreScriptDir, 'verify-achieved-truth.mjs'), [String(lane.issue), String(lane.pr)], { allowFailure: true });
}

function markAchievedPostMerge(lane, archivePath) {
  return run(path.join(coreScriptDir, 'mark-achieved-post-merge.sh'), [String(lane.issue), archivePath, String(lane.pr)], { allowFailure: true });
}

function completeMergedLaneAchievement(state, lane) {
  ensureBoundBranch();
  const verify = verifyAchievedTruth(lane);
  if (verify.status !== 0) {
    const reason = verify.stderr || verify.stdout || 'verify-achieved-truth.mjs failed during post-merge achievement';
    markLaneFailure(state, lane, reason, {
      retryable: isTransientFailure(reason),
      source: 'post-merge-achievement',
    });
    emitBlocked([
      ['stage', 'post-merge-achievement'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  const parsed = parseJsonResult(verify.stdout, 'verify-achieved-truth.mjs did not return JSON');
  if (!parsed.ok || parsed.data?.error) {
    const reason = parsed.data?.error || parsed.reason;
    markLaneFailure(state, lane, reason, {
      retryable: isTransientFailure(reason),
      source: 'post-merge-achievement',
    });
    emitBlocked([
      ['stage', 'post-merge-achievement'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  if (parsed.data?.achieved === true) {
    lane.stage = 'done';
    lane.lastResult = 'achieved';
    lane.blockedReason = '';
    clearRetryableState(lane);
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    emitDone([
      ['stage', 'lane-done'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
    ], verify.stdout);
    return true;
  }
  if (parsed.data?.next === 'mark-achieved-post-merge') {
    const archivePath = parsed.data.archivePath || parsed.data.archive_path || '';
    if (!archivePath) {
      markLaneFailure(state, lane, 'verify-achieved-truth requested post-merge achievement but did not return archivePath', {
        retryable: false,
        source: 'post-merge-achievement',
      });
      emitBlocked([
        ['stage', 'post-merge-achievement'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    let achieve = markAchievedPostMerge(lane, archivePath);
    if (achieve.status !== 0 && safeToRerun(achieve)) {
      achieve = markAchievedPostMerge(lane, archivePath);
    }
    if (achieve.status !== 0) {
      const reason = achieve.stderr || achieve.stdout || 'mark-achieved-post-merge.sh failed';
      markLaneFailure(state, lane, reason, {
        retryable: isTransientFailure(reason),
        source: 'post-merge-achievement',
      });
      emitBlocked([
        ['stage', 'post-merge-achievement'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    const reverify = verifyAchievedTruth(lane);
    if (reverify.status !== 0) {
      const reason = reverify.stderr || reverify.stdout || 'verify-achieved-truth.mjs failed after post-merge achievement sync';
      markLaneFailure(state, lane, reason, {
        retryable: isTransientFailure(reason),
        source: 'post-merge-achievement',
      });
      emitBlocked([
        ['stage', 'post-merge-achievement'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    const terminal = parseJsonResult(reverify.stdout, 'verify-achieved-truth.mjs did not return JSON after post-merge achievement sync');
    if (!terminal.ok || terminal.data?.achieved !== true) {
      const reason = terminal.data?.reason || terminal.reason || 'Post-merge achievement sync completed, but terminal truth is still incomplete.';
      markLaneFailure(state, lane, reason, {
        retryable: false,
        source: 'post-merge-achievement',
      });
      emitBlocked([
        ['stage', 'post-merge-achievement'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    lane.stage = 'done';
    lane.lastResult = 'mark-achieved-post-merge';
    lane.blockedReason = '';
    clearRetryableState(lane);
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    emitDone([
      ['stage', 'lane-done'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
    ], achieve.stdout);
    return true;
  }
  emitHandoff([
    ['stage', parsed.data?.next || 'post-merge-achieve'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', parsed.data?.reason || 'Continue post-merge achievement gates.'],
  ], verify.stdout);
  return true;
}

function reconcileLaneFromTruth(state, lane) {
  if (!laneNeedsReconciliation(lane)) return { handled: false };

  if (!lane.pr && lane.issue) {
    const bridge = bridgeIssuePr(lane.issue);
    if (bridge.status !== 0) {
      markLaneFailure(state, lane, bridge.reason, {
        retryable: isTransientFailure(bridge.reason),
        source: 'find-issue-pr',
      });
      return { handled: true, emitted: false };
    }
    if (bridge.data?.pr) {
      refreshLanePrFields(lane, bridge.data);
    } else {
      markLaneFailure(state, lane, bridge.data?.reason || 'no exact issue-bound PR during lane reconciliation', {
        retryable: false,
        source: 'find-issue-pr',
      });
      return { handled: true, emitted: false };
    }
  }

  if (lane.pr) {
    const truth = cachedPrTruth(lane.pr);
    if (truth.status !== 0) {
      markLaneFailure(state, lane, truth.reason, {
        retryable: isTransientFailure(truth.reason),
        source: 'pr-truth',
      });
      return { handled: true, emitted: false };
    }
    const retryableStage = lane.retryableStage || '';
    const retryableHead = lane.retryableHead || '';
    refreshLanePrFields(lane, truth.data);
    const stateValue = String(truth.data?.state || '').toUpperCase();
    if (stateValue === 'OPEN') {
      lane.stage = retryableStage === 'merge_ready' && String(truth.data?.headRefOid || '') === retryableHead
        ? 'merge_ready'
        : 'waiting_review';
      lane.blockedReason = '';
      lane.lastResult = 'reconciled-open-pr';
      clearRetryableState(lane);
      lane.updatedAt = new Date().toISOString();
      writeLaneState(state);
      return { handled: true, emitted: false };
    }
    if (truth.data?.mergedAt) {
      lane.stage = 'merge_ready';
      lane.blockedReason = '';
      lane.lastResult = 'reconciled-merged-pr';
      clearRetryableState(lane);
      lane.updatedAt = new Date().toISOString();
      writeLaneState(state);
      emitHandoff([
        ['stage', 'merge-ready'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['required_action', 'Reconciled a merged PR; run the auto driver on this lane to complete achievement gates.'],
      ]);
      return { handled: true, emitted: true };
    }
    markLaneFailure(state, lane, `PR ${lane.pr} is not open`, {
      retryable: false,
      source: 'pr-truth',
    });
    return { handled: true, emitted: false };
  }

  markLaneFailure(state, lane, 'blocked lane has no issue or PR truth to reconcile', {
    retryable: false,
    source: 'lane-reconcile',
  });
  return { handled: true, emitted: false };
}

function reconcileRecoverableLanes(state) {
  let changed = false;
  const candidates = state.lanes.filter(laneNeedsReconciliation);
  for (const lane of candidates) {
    const result = reconcileLaneFromTruth(state, lane);
    if (result.emitted) return true;
    if (result.handled) changed = true;
  }
  if (changed) {
    const refreshed = readLaneState({ maxLanes: state.maxLanes });
    const blockedLanes = refreshed.lanes.filter(laneBlocksGoalCompletion);
    const activeLanes = refreshed.lanes.filter((lane) => lane.stage !== 'done' && !laneBlocksGoalCompletion(lane));
    if (blockedLanes.length > 0 && activeLanes.length === 0) {
      const lane = blockedLanes[0] || {};
      emitBlocked([
        ['stage', lane.stage === 'retryable_blocked' ? 'retryable-blocked' : 'blocked-lanes'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', `${blockedLanes.length} lane(s) are blocked; resolve, retry, or release lane state before treating the goal loop as complete.`],
        ['blocked_reason', lane.blockedReason],
      ]);
      return true;
    }
  }
  return false;
}

function reconcileWaitingReviewPrTruth(state) {
  let changed = false;
  const candidates = state.lanes.filter((lane) => lane.stage === 'waiting_review' && lane.pr);
  for (const lane of candidates) {
    const result = refreshWaitingLanePrTruth(state, lane);
    if (result.emitted) return true;
    if (result.handled) changed = true;
  }
  if (changed) {
    const refreshed = readLaneState({ maxLanes: state.maxLanes });
    if (emitBlockedLaneSummaryIfTerminal(refreshed)) return true;
  }
  return false;
}

function emitBlockedLaneSummaryIfTerminal(state) {
  const blockedLanes = state.lanes.filter(laneBlocksGoalCompletion);
  const activeLanes = state.lanes.filter((lane) => lane.stage !== 'done' && !laneBlocksGoalCompletion(lane));
  if (blockedLanes.length === 0 || activeLanes.length > 0) return false;
  const lane = blockedLanes[0] || {};
  emitBlocked([
    ['stage', lane.stage === 'retryable_blocked' ? 'retryable-blocked' : 'blocked-lanes'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['reason', `${blockedLanes.length} lane(s) are blocked; resolve, retry, or release lane state before treating the goal loop as complete.`],
    ['blocked_reason', lane.blockedReason],
  ]);
  return true;
}

function repoNwoFromRemote() {
  const remote = run('git', ['remote', 'get-url', 'origin'], { allowFailure: true });
  const url = remote.stdout.trim();
  if (url.startsWith('git@github.com:')) return url.slice('git@github.com:'.length).replace(/\.git$/, '');
  if (url.startsWith('https://github.com/')) return url.slice('https://github.com/'.length).replace(/\.git$/, '');
  const view = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { allowFailure: true });
  return view.stdout.trim();
}

function retryMarker(lane, retryRound) {
  return [
    'OpenSpec Buddy review retry',
    `lane_id: ${lane.id}`,
    `head: ${lane.head}`,
    `retry_round: ${retryRound}`,
  ].join('\n');
}

function retryMarkerExists(lane, retryRound) {
  const repo = repoNwoFromRemote();
  if (!repo) return { exists: false, at: '' };
  const result = run('gh', ['api', `repos/${repo}/issues/${lane.pr}/comments?per_page=100`], { allowFailure: true });
  if (result.status !== 0) return { exists: false, at: '' };
  let comments = [];
  try {
    comments = JSON.parse(result.stdout || '[]');
  } catch {
    return { exists: false, at: '' };
  }
  const marker = retryMarker(lane, retryRound);
  const comment = comments.find((item) => String(item.body || '').includes(marker));
  return {
    exists: Boolean(comment),
    at: String(comment?.created_at || comment?.createdAt || ''),
  };
}

function writeRetryContext(lane, retryRound) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lane-review-retry-'));
  const file = path.join(dir, 'context.md');
  fs.writeFileSync(file, [
    retryMarker(lane, retryRound),
    '',
    '本轮是 multi-lane review wait retry，请基于当前 head 重新审查。',
    '',
    `- 当前 head: ${lane.head || 'unknown'}`,
    `- issue: ${lane.issue || 'unknown'}`,
    `- PR: ${lane.pr || 'unknown'}`,
    '- 触发原因: 等待窗口内未观察到当前 head 的 clean Codex review。',
    '- 请求: 请确认当前 head 是否仍有 actionable P0/P1/P2，或明确回复无重大问题。',
    '',
  ].join('\n'));
  return file;
}

function requestRetry(lane) {
  const retryRound = (lane.reviewRetryCount || 0) + 1;
  const existingMarker = retryMarkerExists(lane, retryRound);
  if (existingMarker.exists) return { skipped: true, retryRound, requestedAt: existingMarker.at || new Date().toISOString() };
  const contextFile = writeRetryContext(lane, retryRound);
  const result = run(path.join(coreScriptDir, 'request-pr-review.sh'), [String(lane.pr), '--force', '--context-file', contextFile], { allowFailure: true });
  fs.rmSync(path.dirname(contextFile), { recursive: true, force: true });
  if (result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || 'request-pr-review.sh failed');
    error.status = result.status;
    throw error;
  }
  return { skipped: false, retryRound, requestedAt: new Date().toISOString() };
}

function markIssueInProgress(issue) {
  if (!issue) return { status: 0, stdout: '', stderr: '' };
  return run(path.join(coreScriptDir, 'mark-in-progress.sh'), [String(issue)], { allowFailure: true });
}

function markIssueInReview(issue, pr) {
  if (!issue || !pr) return { status: 0, stdout: '', stderr: '' };
  return run(path.join(coreScriptDir, 'mark-review.sh'), [String(issue), String(pr)], { allowFailure: true });
}

function resumeLaneOrFail(state, lane, source) {
  const result = resumeLane(lane);
  if (result.status === 0) return { ok: true };
  const reason = result.stderr || result.stdout || `${source} lane resume failed`;
  if (/wrong HEAD:/i.test(reason) && normalizeLocalAhead(lane, collectLaneTruth(lane))) {
    writeLaneState(state);
    return { ok: false, handoff: 'review_fix', reason };
  }
  markLaneFailure(state, lane, reason, {
    retryable: isTransientFailure(reason),
    source,
  });
  return { ok: false, reason };
}

function emitReviewFixHandoff(lane, reason) {
  emitHandoff([
    ['stage', 'review-fix'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', 'Local review-fix commit is ahead of the parked PR head; push it, reply to review threads, run response gate, and request current-head review before parking the lane again.'],
  ], reason);
}

function claimNextIssue(state, opts) {
  if (!opts.goal) return false;
  const activeCount = reservedLaneCount(state);
  if (activeCount >= state.maxLanes) return false;
  ensureBoundBranch();
  const selectionResult = runSelector(state);
  if (selectionResult.status !== 0) {
    emitBlocked([
      ['stage', 'goal-select'],
      ['reason', 'select-next-change.sh failed'],
      ['command', path.join(coreScriptDir, 'select-next-change.sh')],
    ], selectionResult.stderr || selectionResult.stdout);
    return true;
  }
  const selected = parseSelection(selectionResult.stdout);
  if (!selected) {
    if (emitBlockedLaneSummaryIfTerminal(state)) return true;
    const unfinishedLanes = state.lanes.filter((lane) => lane.stage !== 'done');
    if (unfinishedLanes.length === 0) {
      emitDone([
        ['stage', 'no-available-changes'],
        ['reason', 'No executable OpenSpec Buddy issue.'],
      ]);
      return true;
    }
    return false;
  }
  if (selected.local_only || selected.no_issue || !selected.number) {
    emitHandoff([
      ['stage', 'local-only'],
      ['change', selected.change_id || selected.change || ''],
      ['required_action', 'Selector returned a local-only/no-issue change. Use the single-lane local-only --no-pr workflow; do not claim an issue or add a multi-lane issue lane.'],
    ], selectionResult.stdout);
    return true;
  }
  const driver = runSingleDriverForIssue(selected.number);
  if (driver.status !== 0) {
    emitBlocked([
      ['stage', 'claim-next-issue'],
      ['issue', selected.number],
      ['reason', 'buddy-auto-driver failed'],
    ], driver.stderr || driver.stdout);
    return true;
  }
  const parsed = parseDriverStage(driver.stdout);
  const driverState = parseDriverState(driver.stdout);
  const issuePrBound = driverState.stages?.issue_pr_bound || {};
  const lane = {
    id: `issue-${selected.number}`,
    issue: String(driverState.issue || issuePrBound.issue || selected.number),
    change: driverState.change || selected.change_id || '',
    branch: issuePrBound.headRefName || selected.claim_branch || selected.change_id || '',
    pr: String(driverState.pr || issuePrBound.pr || ''),
    head: String(driverState.head || issuePrBound.head || ''),
  };
  const parkResult = parkLaneFromDriverReceipt(state, lane, parsed, driverState);
  if (parkResult.status === 'blocked') {
    emitBlocked([
      ['stage', 'claim-next-issue'],
      ['issue', selected.number],
      ['reason', parkResult.reason],
    ], driver.stdout);
    return true;
  }
  if (parkResult.status === 'parked') {
    emitHandoff([
      ['stage', parsed.stage],
      ['issue', selected.number],
      ['pr', parkResult.lane.pr],
      ['required_action', 'Lane is now safely parked in waiting_review; rerun the lane driver to poll or schedule another lane.'],
    ], driver.stdout);
    return true;
  }
  if (parkResult.status === 'review_fix_handoff') {
    emitReviewFixHandoff(parkResult.lane, parkResult.reason);
    return true;
  }
  upsertLane(state, {
    ...lane,
    stage: 'implementing',
    lastResult: parsed.stage,
  });
  writeLaneState(state);
  emitHandoff([
    ['stage', parsed.stage || 'implement-or-open-pr'],
    ['issue', selected.number],
    ['required_action', 'Continue only the selected lane work returned by buddy-auto-driver.'],
  ], driver.stdout);
  return true;
}

function parkLaneFromDriverReceipt(state, lane, parsed, driverState) {
  const issuePrBound = driverState.stages?.issue_pr_bound || {};
  const reviewRequested = driverState.stages?.review_requested || {};
  const lanePr = String(driverState.pr || issuePrBound.pr || lane.pr || '');
  const laneHead = String(driverState.head || reviewRequested.head || issuePrBound.head || lane.head || '');
  if (parsed.stage === 'review-yield' && (!lanePr || !laneHead)) {
    return {
      status: 'blocked',
      reason: 'buddy-auto-driver returned review-yield without PR/head receipt; refusing to park an unpollable lane.',
    };
  }
  if (parsed.stage !== 'review-yield') return { status: 'ignored' };
  const candidateLane = {
    ...lane,
    issue: String(driverState.issue || issuePrBound.issue || lane.issue || ''),
    change: driverState.change || lane.change || '',
    branch: issuePrBound.headRefName || lane.branch || '',
    pr: lanePr,
    head: laneHead,
    stage: 'waiting_review',
    reviewRequestedAt: reviewRequested.at || lane.reviewRequestedAt || '',
    lastResult: parsed.stage,
  };
  const safe = safeYieldCurrentLane(candidateLane);
  if (safe.status !== 0) {
    const reason = safe.stderr || safe.stdout || 'safe-yield gate failed before parking lane';
    const truth = collectLaneTruth(candidateLane);
    if (/wrong HEAD:/i.test(reason) && normalizeLocalAhead(candidateLane, truth)) {
      upsertLane(state, candidateLane);
      writeLaneState(state);
      return { status: 'review_fix_handoff', lane: candidateLane, reason };
    }
    return {
      status: 'blocked',
      reason,
    };
  }
  upsertLane(state, {
    ...candidateLane,
  });
  writeLaneState(state);
  return { status: 'parked', lane: candidateLane };
}

function blockIfForegroundLaneNotParked(state) {
  const blockedStages = new Set(['claiming', 'implementing', 'pr_opened', 'review_requested', 'achieving']);
  const lane = state.lanes.find((candidate) => blockedStages.has(candidate.stage));
  if (!lane) return false;
  const branch = currentBranch();
  if (lane.branch && branch && branch !== lane.branch) {
    emitHandoff([
      ['stage', lane.stage],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['required_action', `Switch to lane branch ${lane.branch} before advancing this foreground lane.`],
    ]);
    return true;
  }
  const driver = runSingleDriverForLane(lane);
  if (driver.status !== 0) {
    const reason = driver.stderr || driver.stdout || 'buddy-auto-driver failed while advancing foreground lane';
    markLaneFailure(state, lane, reason, {
      retryable: isTransientFailure(reason),
      source: 'advance-foreground-lane',
    });
    emitBlocked([
      ['stage', 'advance-lane'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  const parsed = parseDriverStage(driver.stdout);
  const driverState = parseDriverState(driver.stdout);
  invalidatePrTruth(lane.pr);
  const parkResult = parkLaneFromDriverReceipt(state, lane, parsed, driverState);
  if (parkResult.status === 'blocked') {
    emitBlocked([
      ['stage', 'advance-lane'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', parkResult.reason],
    ]);
    return true;
  }
  if (parkResult.status === 'parked') {
    if (lane.stage === 'review_fix') {
      const statusResult = markIssueInReview(parkResult.lane.issue, parkResult.lane.pr);
      if (statusResult.status !== 0) {
        const persistedLane = state.lanes.find((candidate) => candidate.id === parkResult.lane.id) || parkResult.lane;
        const reason = statusResult.stderr || statusResult.stdout || 'mark-review.sh failed after review fix';
        markLaneFailure(state, persistedLane, reason, {
          retryable: isTransientFailure(reason),
          source: 'mark-review',
        });
        emitBlocked([
          ['stage', 'mark-review'],
          ['lane', persistedLane.id],
          ['issue', persistedLane.issue],
          ['pr', persistedLane.pr],
          ['reason', persistedLane.blockedReason],
        ]);
        return true;
      }
    }
    emitHandoff([
      ['stage', parsed.stage],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', parkResult.lane.pr],
      ['required_action', 'Lane is now safely parked in waiting_review; rerun the lane driver to poll or schedule another lane.'],
    ], driver.stdout);
    return true;
  }
  if (parkResult.status === 'review_fix_handoff') {
    emitReviewFixHandoff(parkResult.lane, parkResult.reason);
    return true;
  }
  emitHandoff([
    ['stage', parsed.stage || lane.stage],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', 'Finish this lane until it is committed, pushed, review-requested, and safely parked before claiming another issue.'],
  ], driver.stdout);
  return true;
}

function verifyCurrentWaitingLaneIfOnBranch(state) {
  const branch = currentBranch();
  if (!branch) return false;
  const lane = state.lanes.find((candidate) => candidate.stage === 'waiting_review' && candidate.branch === branch);
  if (!lane) return false;
  const safe = safeYieldCurrentLane(lane);
  if (safe.status === 0) return false;
  const reason = safe.stderr || safe.stdout || 'safe-yield gate failed';
  const truth = collectLaneTruth(lane);
  if (/wrong HEAD:/i.test(reason) && normalizeLocalAhead(lane, truth)) {
    writeLaneState(state);
    emitHandoff([
      ['stage', 'review-fix'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['required_action', 'Local review-fix commit is ahead of the parked PR head; push it, reply to review threads, run response gate, and request current-head review before parking the lane again.'],
    ], reason);
    return true;
  }
  markLaneFailure(state, lane, reason, {
    retryable: isTransientFailure(reason),
    source: 'safe-yield',
  });
  emitBlocked([
    ['stage', 'safe-yield'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['reason', lane.blockedReason],
  ]);
  return true;
}

function advanceResumedLane(state, lane) {
  if (lane.stage === 'review_fix') {
    const truth = forceRefreshPrTruth(lane.pr);
    const head = truth.status === 0 ? String(truth.data?.headRefOid || '') : '';
    if (head && head !== lane.head) {
      lane.head = head;
      lane.updatedAt = new Date().toISOString();
      writeLaneState(state);
    }
  }
  if (lane.stage === 'merge_ready') {
    const truth = cachedPrTruth(lane.pr);
    if (truth.status !== 0) {
      markLaneFailure(state, lane, truth.reason, {
        retryable: isTransientFailure(truth.reason),
        source: 'merge-ready-pr-truth',
      });
      emitBlocked([
        ['stage', 'merge-ready'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    const prState = String(truth.data?.state || '').toUpperCase();
    if (prState === 'MERGED' || truth.data?.mergedAt) {
      return completeMergedLaneAchievement(state, lane);
    }
    const resumed = resumeLaneOrFail(state, lane, 'resume-merge-ready-lane');
    if (!resumed.ok) {
      if (resumed.handoff === 'review_fix') {
        emitReviewFixHandoff(lane, resumed.reason);
      } else {
        emitBlocked([
          ['stage', 'resume-merge-ready'],
          ['lane', lane.id],
          ['issue', lane.issue],
          ['pr', lane.pr],
          ['reason', lane.blockedReason],
        ]);
      }
      return true;
    }
  } else {
    const resumed = resumeLaneOrFail(state, lane, 'resume-lane');
    if (!resumed.ok) {
      if (resumed.handoff === 'review_fix') {
        emitReviewFixHandoff(lane, resumed.reason);
      } else {
        emitBlocked([
          ['stage', 'resume-lane'],
          ['lane', lane.id],
          ['reason', lane.blockedReason],
        ]);
      }
      return true;
    }
  }
  let driver = null;
  let parsed = { status: '', stage: '' };
  let driverState = {};
  let advanceAttempts = 0;
  for (; advanceAttempts < 4; advanceAttempts += 1) {
    driver = runSingleDriverForLane(lane);
    invalidatePrTruth(lane.pr);
    if (driver.status !== 0) {
      const reason = driver.stderr || driver.stdout || 'buddy-auto-driver failed while advancing resumed lane';
      markLaneFailure(state, lane, reason, {
        retryable: isTransientFailure(reason),
        source: 'advance-resumed-lane',
      });
      emitBlocked([
        ['stage', 'advance-lane'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    parsed = parseDriverStage(driver.stdout);
    driverState = parseDriverState(driver.stdout);
    if (parsed.status === 'DONE' && parsed.stage === 'review_clear') {
      lane.stage = 'merge_ready';
      lane.updatedAt = new Date().toISOString();
      lane.lastResult = 'review_clear';
      writeLaneState(state);
      continue;
    }
    break;
  }
  if (parsed.status === 'DONE' && parsed.stage === 'review_clear') {
    markLaneFailure(state, lane, 'buddy-auto-driver stopped at internal review_clear after repeated lane advancement attempts', {
      retryable: false,
      source: 'advance-resumed-lane',
    });
    emitBlocked([
      ['stage', 'advance-lane'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  const parkResult = parkLaneFromDriverReceipt(state, lane, parsed, driverState);
  if (parkResult.status === 'blocked') {
    emitBlocked([
      ['stage', 'advance-lane'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', parkResult.reason],
    ]);
    return true;
  }
  if (parkResult.status === 'parked') {
    if (lane.stage === 'review_fix') {
      const statusResult = markIssueInReview(parkResult.lane.issue, parkResult.lane.pr);
      if (statusResult.status !== 0) {
        const persistedLane = state.lanes.find((candidate) => candidate.id === parkResult.lane.id) || parkResult.lane;
        const reason = statusResult.stderr || statusResult.stdout || 'mark-review.sh failed after review fix';
        markLaneFailure(state, persistedLane, reason, {
          retryable: isTransientFailure(reason),
          source: 'mark-review',
        });
        emitBlocked([
          ['stage', 'mark-review'],
          ['lane', persistedLane.id],
          ['issue', persistedLane.issue],
          ['pr', persistedLane.pr],
          ['reason', persistedLane.blockedReason],
        ]);
        return true;
      }
    }
    emitHandoff([
      ['stage', parsed.stage],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', parkResult.lane.pr],
      ['required_action', 'Lane is safely parked in waiting_review; rerun the lane driver to poll or schedule another lane.'],
    ], driver.stdout);
    return true;
  }
  if (lane.stage === 'review_fix' && parsed.stage === 'review-fix') {
    const truth = forceRefreshPrTruth(lane.pr);
    const head = truth.status === 0 ? String(truth.data?.headRefOid || '') : '';
    if (head && head !== lane.head) {
      lane.head = head;
      lane.updatedAt = new Date().toISOString();
      writeLaneState(state);
    }
    const check = checkLaneReview(lane);
    if (check.status === 0) {
      lane.stage = 'merge_ready';
      lane.updatedAt = new Date().toISOString();
      lane.lastResult = 'review-clear-after-review-fix';
      writeLaneState(state);
      emitHandoff([
        ['stage', 'merge-ready'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['required_action', 'Run the auto driver on this lane to continue merge and achievement gates.'],
      ], check.stdout);
      return true;
    }
    if (check.status === 1) {
      const statusResult = markIssueInReview(lane.issue, lane.pr);
      if (statusResult.status !== 0) {
        const reason = statusResult.stderr || statusResult.stdout || 'mark-review.sh failed after review fix';
        markLaneFailure(state, lane, reason, {
          retryable: isTransientFailure(reason),
          source: 'mark-review',
        });
        emitBlocked([
          ['stage', 'mark-review'],
          ['lane', lane.id],
          ['issue', lane.issue],
          ['pr', lane.pr],
          ['reason', lane.blockedReason],
        ]);
        return true;
      }
      lane.stage = 'waiting_review';
      lane.updatedAt = new Date().toISOString();
      lane.lastResult = 'review-fix-waiting-current-head-review';
      writeLaneState(state);
      emitHandoff([
        ['stage', 'review-yield'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['required_action', 'No new actionable thread is present; lane is parked in waiting_review for current-head review.'],
      ], check.stdout || check.stderr);
      return true;
    }
    if (check.status !== 3) {
      const reason = check.stderr || check.stdout || 'check-review-clear-once.sh failed after review-fix handoff';
      markLaneFailure(state, lane, reason, {
        retryable: isTransientFailure(reason),
        source: 'check-review-clear-once',
      });
      emitBlocked([
        ['stage', 'check-review-clear-once'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
  }
  if (parsed.stage === 'achieved') {
    lane.stage = 'done';
    lane.updatedAt = new Date().toISOString();
    lane.lastResult = parsed.stage;
    writeLaneState(state);
    emitDone([
      ['stage', 'lane-done'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
    ], driver.stdout);
    return true;
  }
  lane.stage = parsed.stage === 'merge-pr' || parsed.stage === 'merge-gates' ? 'merge_ready' : lane.stage;
  lane.updatedAt = new Date().toISOString();
  lane.lastResult = parsed.stage || lane.lastResult || '';
  writeLaneState(state);
  emitHandoff([
    ['stage', parsed.stage || lane.stage],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', lane.stage === 'merge_ready' ? 'Continue merge gates through buddy-auto-driver.' : 'Address review feedback before any other lane work.'],
  ], driver.stdout);
  return true;
}

function refreshWaitingLanePrTruth(state, lane) {
  if (!lane.pr) return { handled: false, emitted: false };

  const truth = forceRefreshPrTruth(lane.pr);
  if (truth.status !== 0) {
    const reason = truth.reason || 'gh pr view failed';
    const retryable = isTransientFailure(reason);
    markLaneFailure(state, lane, reason, {
      retryable,
      source: 'pr-truth',
    });
    if (retryable) return { handled: true, emitted: false };
    emitBlocked([
      ['stage', 'pr-truth'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return { handled: true, emitted: true };
  }

  const stateValue = String(truth.data?.state || '').toUpperCase();
  if (stateValue === 'MERGED' || truth.data?.mergedAt) {
    refreshLanePrFields(lane, truth.data);
    lane.stage = 'merge_ready';
    lane.blockedReason = '';
    lane.lastResult = 'pr-truth-merged';
    clearRetryableState(lane);
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    emitHandoff([
      ['stage', 'merge-ready'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['required_action', 'PR is already merged; run the auto driver on this lane to complete achievement gates.'],
    ]);
    return { handled: true, emitted: true };
  }

  if (stateValue && stateValue !== 'OPEN') {
    markLaneFailure(state, lane, `PR ${lane.pr} is not open`, {
      retryable: false,
      source: 'pr-truth',
    });
    emitBlocked([
      ['stage', 'pr-truth'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return { handled: true, emitted: true };
  }

  return { handled: false, emitted: false };
}

function enterReviewFix(state, lane, output = '') {
  const statusResult = markIssueInProgress(lane.issue);
  if (statusResult.status !== 0) {
    const reason = statusResult.stderr || statusResult.stdout || 'mark-in-progress.sh failed before review fix';
    markLaneFailure(state, lane, reason, {
      retryable: isTransientFailure(reason),
      source: 'mark-in-progress',
    });
    emitBlocked([
      ['stage', 'mark-in-progress'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  lane.stage = 'review_fix';
  lane.updatedAt = new Date().toISOString();
  writeLaneState(state);
  emitHandoff([
    ['stage', 'review-fix'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', 'Address actionable review feedback on this lane only.'],
  ], output);
  return true;
}

function enterMergeReady(state, lane, output = '') {
  lane.stage = 'merge_ready';
  lane.updatedAt = new Date().toISOString();
  lane.lastResult = 'review-clear';
  writeLaneState(state);
  emitHandoff([
    ['stage', 'merge-ready'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', 'Run the auto driver on this lane to continue merge and achievement gates.'],
  ], output);
  return true;
}

function runDeepReviewCheck(state, lane, source = 'deep-check-review') {
  const resumed = resumeLaneOrFail(state, lane, 'resume-lane');
  if (!resumed.ok) {
    if (resumed.handoff === 'review_fix') {
      emitReviewFixHandoff(lane, resumed.reason);
    } else {
      emitBlocked([
        ['stage', 'resume-lane'],
        ['lane', lane.id],
        ['reason', lane.blockedReason],
      ]);
    }
    return true;
  }
  const check = checkLaneReview(lane);
  if (check.status === 0) return enterMergeReady(state, lane, check.stdout);
  if (check.status === 1) {
    lane.stage = 'waiting_review';
    lane.updatedAt = new Date().toISOString();
    lane.lastResult = source;
    writeLaneState(state);
    return false;
  }
  if (check.status === 3) return enterReviewFix(state, lane, check.stdout || check.stderr);
  const reason = check.stderr || check.stdout || 'check-review-clear-once.sh failed';
  markLaneFailure(state, lane, reason, {
    retryable: isTransientFailure(reason),
    source: 'check-review-clear-once',
  });
  emitBlocked([
    ['stage', 'check-review-clear-once'],
    ['lane', lane.id],
    ['reason', lane.blockedReason],
  ]);
  return true;
}

function processWaitingLane(state, lane) {
  const prTruth = refreshWaitingLanePrTruth(state, lane);
  if (prTruth.handled) return prTruth.emitted;

  const probe = probeLane(lane);
  if (probe.status !== 0) {
    const reason = probe.stderr || probe.stdout || 'probe-review-state.sh failed';
    const retryable = isTransientFailure(reason);
    markLaneFailure(state, lane, reason, {
      retryable,
      source: 'probe-review-state',
    });
    if (retryable) return false;
    emitBlocked([
      ['stage', 'probe-review-state'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  const parsedProbe = parseJsonResult(probe.stdout, 'probe-review-state.sh returned invalid JSON');
  if (!parsedProbe.ok) {
    markLaneFailure(state, lane, parsedProbe.reason, {
      retryable: true,
      source: 'probe-review-state',
    });
    return false;
  }
  const result = parsedProbe.data;
  const previousHead = lane.head || '';
  const previousSignature = lane.lastSignature || '';
  const truth = classifyProbe({
    ...result,
    pr: lane.pr,
    head: result.state === 'head_changed' ? (result.head || lane.head) : lane.head,
  }, {
    previousHead,
    previousSignature,
  });
  applyReviewTruthToLane(lane, mergeReviewTruth(laneReviewTruth(lane), truth));
  lane.lastProbeAt = lane.restFreshAt;

  if (result.retryExpired === true) {
    markLaneFailure(state, lane, 'review retry window expired without current-head clean review', {
      retryable: false,
      source: 'review-retry-expired',
    });
    return false;
  }

  if (result.retryDue === true && Number(lane.reviewRetryCount || 0) === 0) {
    const resumed = resumeLaneOrFail(state, lane, 'resume-review-retry');
    if (!resumed.ok) {
      if (resumed.handoff === 'review_fix') {
        emitReviewFixHandoff(lane, resumed.reason);
      } else {
        emitBlocked([
          ['stage', 'resume-review-retry'],
          ['lane', lane.id],
          ['issue', lane.issue],
          ['pr', lane.pr],
          ['reason', lane.blockedReason],
        ]);
      }
      return true;
    }
    let retry;
    try {
      retry = requestRetry(lane);
      invalidatePrTruth(lane.pr);
    } catch (error) {
      const reason = error.stderr || error.stdout || error.message || 'request-pr-review.sh failed';
      markLaneFailure(state, lane, reason, {
        retryable: isTransientFailure(reason),
        source: 'request-review-retry',
      });
      emitBlocked([
        ['stage', 'request-review-retry'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    lane.reviewRetryCount = retry.retryRound;
    lane.reviewRequestedAt = retry.requestedAt || new Date().toISOString();
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    return false;
  }

  const decision = decideLaneAction({ lane, reviewTruth: laneReviewTruth(lane) });
  if (decision.action === 'keep-waiting') {
    if (truth.probeState === 'head_changed' && truth.requestState === 'present-current-head') {
      lane.reviewRetryCount = 0;
      lane.reviewRequestedAt = new Date().toISOString();
    }
    writeLaneState(state);
    return false;
  }
  if (decision.action === 'enter-merge-ready') return enterMergeReady(state, lane);
  if (decision.action === 'enter-review-fix') return enterReviewFix(state, lane);
  if (decision.action === 'request-current-head-review') {
    const requestedAt = new Date().toISOString();
    const action = runLaneAction(state, lane, {
      command: path.join(coreScriptDir, 'request-pr-review.sh'),
      args: [String(lane.pr), '--force'],
      patch: {
        stage: 'waiting_review',
        reviewRequestedAt: requestedAt,
        lastRequestState: 'present-current-head',
        lastResult: 'request-current-head-review',
      },
    }, { coreScriptDir, refreshTruth: false });
    if (action.status !== 'ok') {
      markLaneFailure(state, lane, action.reason || 'request-pr-review.sh failed', {
        retryable: isTransientFailure(action.reason),
        source: 'request-current-head-review',
      });
      emitBlocked([
        ['stage', 'request-current-head-review'],
        ['lane', lane.id],
        ['issue', lane.issue],
        ['pr', lane.pr],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    return false;
  }
  if (decision.action === 'deep-check-review') {
    return runDeepReviewCheck(state, lane, decision.reason);
  }
  if (decision.action === 'block') {
    markLaneFailure(state, lane, decision.reason, {
      retryable: false,
      source: 'auto-decision',
    });
    emitBlocked([
      ['stage', 'waiting_review'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }

  writeLaneState(state);
  return false;
}

function runScheduler(opts) {
  let lock;
  try {
    const maxLanes = normalizeMaxLanes();
    lock = acquireLaneLock();
    let state = readLaneState({ maxLanes });
    state.maxLanes = maxLanes;
    writeLaneState(state);

    if (opts.releaseLaneIssue) {
      const args = [String(opts.releaseLaneIssue), '--clear-lane'];
      if (opts.releaseReason) args.push('--reason', opts.releaseReason);
      const result = run(path.join(coreScriptDir, 'release-claim.sh'), args, { allowFailure: true });
      if (result.status !== 0) {
        emitBlocked([
          ['stage', 'release-lane'],
          ['issue', opts.releaseLaneIssue],
          ['reason', 'release-claim.sh failed'],
        ], result.stderr || result.stdout);
        return;
      }
      emitDone([
        ['stage', 'release-lane'],
        ['issue', opts.releaseLaneIssue],
        ['reason', 'Claim released and matching lane state cleared.'],
      ], result.stdout);
      return;
    }

    if (opts.reconcile) {
      if (reconcileRecoverableLanes(state)) return;
      if (reconcileWaitingReviewPrTruth(state)) return;
      const refreshed = readLaneState({ maxLanes });
      if (emitBlockedLaneSummaryIfTerminal(refreshed)) return;
      emitDone([
        ['stage', 'reconciled'],
        ['reason', 'No recoverable lane required further action.'],
      ]);
      return;
    }

    for (const lane of state.lanes) {
      if (lane.stage === 'review_returned') {
        const resumed = resumeLaneOrFail(state, lane, 'resume-review-returned');
        if (!resumed.ok) {
          if (resumed.handoff === 'review_fix') {
            emitReviewFixHandoff(lane, resumed.reason);
          } else {
            emitBlocked([
              ['stage', 'resume-review-returned'],
              ['lane', lane.id],
              ['issue', lane.issue],
              ['pr', lane.pr],
              ['reason', lane.blockedReason],
            ]);
          }
          return;
        }
        const check = checkLaneReview(lane);
        if (check.status === 0) {
          lane.stage = 'merge_ready';
          lane.updatedAt = new Date().toISOString();
          writeLaneState(state);
        } else if (check.status === 3) {
          const statusResult = markIssueInProgress(lane.issue);
          if (statusResult.status !== 0) {
            const reason = statusResult.stderr || statusResult.stdout || 'mark-in-progress.sh failed before review fix';
            markLaneFailure(state, lane, reason, {
              retryable: isTransientFailure(reason),
              source: 'mark-in-progress',
            });
            emitBlocked([
              ['stage', 'mark-in-progress'],
              ['lane', lane.id],
              ['issue', lane.issue],
              ['pr', lane.pr],
              ['reason', lane.blockedReason],
            ]);
            return;
          }
          lane.stage = 'review_fix';
          lane.updatedAt = new Date().toISOString();
          writeLaneState(state);
          emitHandoff([
            ['stage', 'review-fix'],
            ['lane', lane.id],
            ['issue', lane.issue],
            ['pr', lane.pr],
            ['required_action', 'Address actionable review feedback on this lane only.'],
          ], check.stdout || check.stderr);
          return;
        } else if (check.status === 1) {
          lane.stage = 'waiting_review';
          lane.updatedAt = new Date().toISOString();
          writeLaneState(state);
        } else {
          emitBlocked([
            ['stage', 'check-review-clear-once'],
            ['lane', lane.id],
            ['reason', check.stderr || check.stdout],
          ]);
          return;
        }
      }
      if (lane.stage === 'merge_ready' || lane.stage === 'review_fix') {
        advanceResumedLane(state, lane);
        return;
      }
    }

    if (blockIfForegroundLaneNotParked(state)) return;

    while (true) {
      state = readLaneState({ maxLanes });
      if (reconcileRecoverableLanes(state)) return;
      state = readLaneState({ maxLanes });
      if (emitBlockedLaneSummaryIfTerminal(state)) return;
      const waiting = state.lanes.filter((lane) => lane.stage === 'waiting_review' && lane.pr);
      for (const lane of waiting) {
        if (processWaitingLane(state, lane)) return;
      }
      state = readLaneState({ maxLanes });
      if (emitBlockedLaneSummaryIfTerminal(state)) return;
      if (blockIfForegroundLaneNotParked(state)) return;
      if (opts.goal && verifyCurrentWaitingLaneIfOnBranch(state)) return;
      if (claimNextIssue(state, opts)) return;
      if (opts.pollOnce) {
        emitDone([
          ['stage', 'waiting_review'],
          ['reason', 'No lane changed during this poll.'],
        ]);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.OPENSPEC_BUDDY_REVIEW_POLL_SECONDS || 60) * 1000);
    }
  } catch (error) {
    if (error.code === 'LANE_LOCKED') {
      emitBlocked([
        ['stage', 'lane-driver-already-running'],
        ['reason', error.message],
      ]);
      return;
    }
    emitBlocked([
      ['stage', 'lane-driver'],
      ['reason', error.message],
    ]);
  } finally {
    lock?.release?.();
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: buddy-auto-lane-driver.mjs [--goal] [--poll-once] [--reconcile] [--release-lane ISSUE [--reason TEXT]]');
    return;
  }
  if (!controllerChildMode()) {
    emitBlocked([
      ['stage', 'controller-owned'],
      ['reason', 'Buddy Auto child drivers are internal. Run buddy-auto.mjs instead.'],
    ]);
    return;
  }
  runScheduler(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
