#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  acquireLaneLock,
  activeLaneIssues,
  laneStateDir,
  normalizeMaxLanes,
  readLaneState,
  writeLaneState,
} from './lane-state.mjs';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(autoScriptDir, '../../openspec-buddy/scripts');
const coreScriptDir = process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;
const singleDriver = process.env.OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER || path.join(autoScriptDir, 'buddy-auto-driver.mjs');
const laneSwitchGate = path.join(autoScriptDir, 'lane-switch-gate.mjs');

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
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
  for (const [key, value] of entries) {
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
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--goal' || arg === '--goal-loop') opts.goal = true;
    else if (arg === '--poll-once') opts.pollOnce = true;
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
  return run(process.execPath, [singleDriver], {
    allowFailure: true,
    env: {
      OPENSPEC_BUDDY_AUTO_TARGET_ISSUE: String(lane.issue || ''),
      OPENSPEC_BUDDY_AUTO_TARGET_PR: String(lane.pr || ''),
      OPENSPEC_BUDDY_AUTO_HEAD: String(lane.head || ''),
      OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE: 'yield',
    },
  });
}

function runSelector(state) {
  const excludeFile = path.join(laneStateDir(), `exclude-${process.pid}.json`);
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.writeFileSync(excludeFile, `${JSON.stringify(activeLaneIssues(state))}\n`);
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

function probeLane(lane) {
  return run(path.join(coreScriptDir, 'probe-review-state.sh'), [String(lane.pr)], {
    allowFailure: true,
    env: {
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
  if (!repo) return false;
  const result = run('gh', ['api', `repos/${repo}/issues/${lane.pr}/comments?per_page=100`], { allowFailure: true });
  if (result.status !== 0) return false;
  let comments = [];
  try {
    comments = JSON.parse(result.stdout || '[]');
  } catch {
    return false;
  }
  const marker = retryMarker(lane, retryRound);
  return comments.some((comment) => String(comment.body || '').includes(marker));
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
  if (retryMarkerExists(lane, retryRound)) return { skipped: true, retryRound };
  const contextFile = writeRetryContext(lane, retryRound);
  const result = run(path.join(coreScriptDir, 'request-pr-review.sh'), [String(lane.pr), '--force', '--context-file', contextFile], { allowFailure: true });
  fs.rmSync(path.dirname(contextFile), { recursive: true, force: true });
  if (result.status !== 0) {
    const error = new Error(result.stderr || result.stdout || 'request-pr-review.sh failed');
    error.status = result.status;
    throw error;
  }
  return { skipped: false, retryRound };
}

function claimNextIssue(state, opts) {
  if (!opts.goal) return false;
  const activeCount = state.lanes.filter((lane) => !['done', 'blocked'].includes(lane.stage)).length;
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
    if (state.lanes.length === 0) {
      emitDone([
        ['stage', 'no-available-changes'],
        ['reason', 'No executable OpenSpec Buddy issue.'],
      ]);
      return true;
    }
    return false;
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
  const reviewRequested = driverState.stages?.review_requested || {};
  const laneStage = parsed.stage === 'review-yield' ? 'waiting_review' : 'implementing';
  const lanePr = String(driverState.pr || issuePrBound.pr || '');
  const laneHead = String(driverState.head || reviewRequested.head || issuePrBound.head || '');
  if (laneStage === 'waiting_review' && (!lanePr || !laneHead)) {
    emitBlocked([
      ['stage', 'claim-next-issue'],
      ['issue', selected.number],
      ['reason', 'buddy-auto-driver returned review-yield without PR/head receipt; refusing to park an unpollable lane.'],
    ], driver.stdout);
    return true;
  }
  upsertLane(state, {
    id: `issue-${selected.number}`,
    issue: String(driverState.issue || issuePrBound.issue || selected.number),
    change: driverState.change || selected.change_id || '',
    branch: issuePrBound.headRefName || selected.claim_branch || selected.change_id || '',
    pr: lanePr,
    head: laneHead,
    stage: laneStage,
    reviewRequestedAt: reviewRequested.at || '',
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

function blockIfForegroundLaneNotParked(state) {
  const blockedStages = new Set(['claiming', 'implementing', 'pr_opened', 'review_requested', 'achieving']);
  const lane = state.lanes.find((candidate) => blockedStages.has(candidate.stage));
  if (!lane) return false;
  emitHandoff([
    ['stage', lane.stage],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['required_action', 'Finish this lane until it is committed, pushed, review-requested, and safely parked before claiming another issue.'],
  ]);
  return true;
}

function verifyCurrentWaitingLaneIfOnBranch(state) {
  const branch = currentBranch();
  if (!branch) return false;
  const lane = state.lanes.find((candidate) => candidate.stage === 'waiting_review' && candidate.branch === branch);
  if (!lane) return false;
  const safe = safeYieldCurrentLane(lane);
  if (safe.status === 0) return false;
  lane.stage = 'blocked';
  lane.blockedReason = safe.stderr || safe.stdout || 'safe-yield gate failed';
  lane.updatedAt = new Date().toISOString();
  writeLaneState(state);
  emitBlocked([
    ['stage', 'safe-yield'],
    ['lane', lane.id],
    ['issue', lane.issue],
    ['pr', lane.pr],
    ['reason', lane.blockedReason],
  ]);
  return true;
}

function processWaitingLane(state, lane) {
  const probe = probeLane(lane);
  if (probe.status !== 0) {
    lane.stage = 'blocked';
    lane.blockedReason = probe.stderr || probe.stdout || 'probe-review-state.sh failed';
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    emitBlocked([
      ['stage', 'probe-review-state'],
      ['lane', lane.id],
      ['issue', lane.issue],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }
  const result = JSON.parse(probe.stdout || '{}');
  lane.lastProbeAt = new Date().toISOString();
  lane.lastSignature = result.signature || lane.lastSignature || '';
  lane.lastRequestState = result.requestState || lane.lastRequestState || '';
  lane.lastResult = result.state || 'waiting';

  if (result.state === 'request_missing' || result.state === 'head_changed') {
    lane.stage = 'blocked';
    lane.blockedReason = result.state;
    writeLaneState(state);
    emitBlocked([
      ['stage', 'waiting_review'],
      ['lane', lane.id],
      ['pr', lane.pr],
      ['reason', result.state],
    ]);
    return true;
  }

  if (result.retryExpired === true) {
    lane.stage = 'blocked';
    lane.blockedReason = 'review retry window expired without current-head clean review';
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    emitBlocked([
      ['stage', 'waiting_review'],
      ['lane', lane.id],
      ['pr', lane.pr],
      ['reason', lane.blockedReason],
    ]);
    return true;
  }

  if (result.retryDue === true && Number(lane.reviewRetryCount || 0) === 0) {
    const retry = requestRetry(lane);
    lane.reviewRetryCount = retry.retryRound;
    lane.reviewRequestedAt = new Date().toISOString();
    lane.updatedAt = new Date().toISOString();
    writeLaneState(state);
    return false;
  }

  if (result.state === 'changed' || result.state === 'review_returned') {
    const resume = resumeLane(lane);
    if (resume.status !== 0) {
      lane.stage = 'blocked';
      lane.blockedReason = resume.stderr || resume.stdout || 'lane resume failed';
      writeLaneState(state);
      emitBlocked([
        ['stage', 'resume-lane'],
        ['lane', lane.id],
        ['reason', lane.blockedReason],
      ]);
      return true;
    }
    const check = checkLaneReview(lane);
    if (check.status === 0) {
      lane.stage = 'merge_ready';
      lane.updatedAt = new Date().toISOString();
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
      lane.stage = 'waiting_review';
      lane.updatedAt = new Date().toISOString();
      writeLaneState(state);
      return false;
    }
    if (check.status === 3) {
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
      return true;
    }
    lane.stage = 'blocked';
    lane.blockedReason = check.stderr || check.stdout || 'check-review-clear-once.sh failed';
    writeLaneState(state);
    emitBlocked([
      ['stage', 'check-review-clear-once'],
      ['lane', lane.id],
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

    for (const lane of state.lanes) {
      if (lane.stage === 'review_returned') {
        const resume = resumeLane(lane);
        if (resume.status !== 0) {
          emitBlocked([
            ['stage', 'resume-lane'],
            ['lane', lane.id],
            ['reason', resume.stderr || resume.stdout],
          ]);
          return;
        }
        const check = checkLaneReview(lane);
        if (check.status === 0) {
          lane.stage = 'merge_ready';
          lane.updatedAt = new Date().toISOString();
          writeLaneState(state);
        } else if (check.status === 3) {
          lane.stage = 'review_fix';
          lane.updatedAt = new Date().toISOString();
          writeLaneState(state);
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
        const resume = resumeLane(lane);
        if (resume.status !== 0) {
          emitBlocked([
            ['stage', 'resume-lane'],
            ['lane', lane.id],
            ['reason', resume.stderr || resume.stdout],
          ]);
          return;
        }
        emitHandoff([
          ['stage', lane.stage],
          ['lane', lane.id],
          ['issue', lane.issue],
          ['pr', lane.pr],
          ['required_action', lane.stage === 'merge_ready' ? 'Continue merge gates through buddy-auto-driver.' : 'Address review feedback before any other lane work.'],
        ]);
        return;
      }
    }

    if (blockIfForegroundLaneNotParked(state)) return;

    while (true) {
      state = readLaneState({ maxLanes });
      const waiting = state.lanes.filter((lane) => lane.stage === 'waiting_review' && lane.pr);
      for (const lane of waiting) {
        if (processWaitingLane(state, lane)) return;
      }
      state = readLaneState({ maxLanes });
      if (blockIfForegroundLaneNotParked(state)) return;
      if (verifyCurrentWaitingLaneIfOnBranch(state)) return;
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
    console.log('Usage: buddy-auto-lane-driver.mjs [--goal] [--poll-once]');
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
