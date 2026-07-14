#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readControllerState } from './controller-state.mjs';
import { signReceipt, validSignedReceipt } from './receipt-truth.mjs';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(autoScriptDir, '../../openspec-buddy/scripts');
const coreScriptDir = process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;

const stages = new Set([
  'claimed',
  'issue_pr_bound',
  'in_progress',
  'pr_opened',
  'mark_review_passed',
  'review_requested',
  'review_response_gate_passed',
  'review_clear',
  'merge_gates_passed',
  'merge_authorized',
  'unauthorized_merge',
  'unauthorized_merge_recovered',
  'post_merge_achieved',
  'merged',
  'achieved',
]);

const deterministicStages = new Set([
  'goal-select',
  'claim-issue',
  'issue-pr-bridge',
  'mark-review',
  'review-response-gate',
  'wait-review',
  'merge-gates',
  'achieved-truth',
]);

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function evidenceDigest(kind, value) {
  return `${kind}:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function parseArgs(argv) {
  const targetIssue = process.env.OPENSPEC_BUDDY_AUTO_TARGET_ISSUE || '';
  const targetPr = process.env.OPENSPEC_BUDDY_AUTO_TARGET_PR || '';
  const opts = {
    issue: targetIssue || (targetPr ? '' : process.env.OPENSPEC_BUDDY_AUTO_ISSUE || ''),
    pr: targetPr || (targetIssue ? '' : process.env.OPENSPEC_BUDDY_AUTO_PR || ''),
    change: process.env.OPENSPEC_BUDDY_AUTO_CHANGE || '',
    head: targetPr ? '' : process.env.OPENSPEC_BUDDY_AUTO_HEAD || '',
    noPr: false,
    dryRun: false,
    goal: truthy(process.env.OPENSPEC_BUDDY_AUTO_GOAL),
    explicitIssue: Boolean(targetIssue || (!targetPr && process.env.OPENSPEC_BUDDY_AUTO_ISSUE)),
    explicitPr: Boolean(targetPr || (!targetIssue && process.env.OPENSPEC_BUDDY_AUTO_PR)),
    targetIssueLocked: Boolean(targetIssue),
    targetPrLocked: Boolean(targetPr),
    targetIssueValue: targetIssue,
    targetPrValue: targetPr,
    repository: process.env.OPENSPEC_BUDDY_REPO_NWO || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target-issue') {
      opts.issue = argv[++i] || '';
      opts.pr = '';
      opts.head = '';
      opts.explicitIssue = true;
      opts.explicitPr = false;
      opts.targetIssueLocked = true;
      opts.targetPrLocked = false;
      opts.targetIssueValue = opts.issue;
      opts.targetPrValue = '';
    } else if (arg === '--target-pr') {
      opts.pr = argv[++i] || '';
      opts.issue = '';
      opts.head = '';
      opts.explicitPr = true;
      opts.explicitIssue = false;
      opts.targetPrLocked = true;
      opts.targetIssueLocked = false;
      opts.targetPrValue = opts.pr;
      opts.targetIssueValue = '';
    } else if (arg === '--issue') {
      opts.issue = argv[++i] || '';
      opts.explicitIssue = true;
    } else if (arg === '--pr') {
      opts.pr = argv[++i] || '';
      opts.explicitPr = true;
    }
    else if (arg === '--change') opts.change = argv[++i] || '';
    else if (arg === '--head') opts.head = argv[++i] || '';
    else if (arg === '--no-pr') opts.noPr = true;
    else if (arg === '--goal' || arg === '--goal-loop') opts.goal = true;
    else if (arg === '--run-next') continue;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.targetPrLocked) {
    opts.pr = opts.targetPrValue || opts.pr;
    opts.issue = '';
    opts.head = '';
    opts.explicitPr = true;
    opts.explicitIssue = false;
  } else if (opts.targetIssueLocked) {
    opts.issue = opts.targetIssueValue || opts.issue;
    opts.pr = '';
    opts.head = '';
    opts.explicitIssue = true;
    opts.explicitPr = false;
  }
  return opts;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.status !== 0) {
    if (options.optional) return '';
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout?.trim() || '';
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(command) {
  return command.map(shellQuote).join(' ');
}

function repositoryIdentity() {
  const configured = process.env.OPENSPEC_BUDDY_REPO_NWO || '';
  if (configured) return configured;
  const remote = run('git', ['remote', 'get-url', 'origin'], { optional: true });
  const url = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  if (url.startsWith('https://github.com/')) return url.slice('https://github.com/'.length);
  return '';
}

function controllerChildMode() {
  return truthy(process.env.OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD);
}

function directRunBlockedByController() {
  if (controllerChildMode()) return '';
  try {
    readControllerState();
  } catch {
    // Child drivers are controller-owned even before a state file exists.
  }
  return 'Buddy Auto child drivers are internal. Run buddy-auto.mjs instead.';
}

function outputBlock(title, entries = []) {
  console.log(title);
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    console.log(`${key}: ${value}`);
  }
}

function compactOutput(result) {
  const text = [result.stdout || '', result.stderr || ''].join('\n').trim();
  if (!text) return '';
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-20).join('\n');
}

function safeToRerun(result) {
  return /\bsafe_to_rerun:\s*true\b/i.test([result.stdout || '', result.stderr || ''].join('\n'));
}

function emitDone({ stage, command = [], state, next, output = '' }) {
  outputBlock('DONE', [
    ['stage', stage],
    ['state_file', statePath(state)],
    ['command', controllerChildMode() ? '' : (command.length ? commandLine(command) : '')],
    ['next_stage', next?.stage || ''],
    ['next_action', next?.reason || ''],
    ['next_command', controllerChildMode() ? '' : (next?.command?.length ? commandLine(next.command) : '')],
    ['agent_action', next?.reason || ''],
    ['resume_action', 'rerun-controller'],
    ['driver_internal', controllerChildMode() ? 'true' : ''],
  ]);
  if (output) {
    console.log('output_excerpt:');
    console.log(output);
  }
}

function emitBlocked({ stage, reason, command = [], output = '' }) {
  outputBlock('BLOCKED', [
    ['stage', stage],
    ['reason', reason],
    ['command', controllerChildMode() ? '' : (command.length ? commandLine(command) : '')],
    ['agent_action', 'Fix only this blocker, then rerun the Buddy Auto controller.'],
    ['resume_action', 'rerun-controller'],
    ['driver_internal', controllerChildMode() ? 'true' : ''],
  ]);
  if (output) {
    console.log('diagnostic:');
    console.log(output);
  }
}

function emitHandoff({ stage, reason, command = [], state = null }) {
  outputBlock('HANDOFF', [
    ['stage', stage],
    ['state_file', state ? statePath(state) : ''],
    ['required_action', reason],
    ['command', controllerChildMode() ? '' : (command.length ? commandLine(command) : '')],
    ['agent_action', reason],
    ['resume_action', 'rerun-controller'],
    ['driver_internal', controllerChildMode() ? 'true' : ''],
  ]);
}

function inferCurrentPr() {
  return run('gh', ['pr', 'view', '--json', 'number,state', '--jq', 'select(.state == "OPEN") | .number'], { optional: true });
}

function inferCurrentHead(pr) {
  const args = pr ? ['pr', 'view', String(pr), '--json', 'headRefOid', '--jq', '.headRefOid'] : ['pr', 'view', '--json', 'headRefOid', '--jq', '.headRefOid'];
  return run('gh', args, { optional: true });
}

function inferIssueFromPrBody(pr = '') {
  const args = pr ? ['pr', 'view', String(pr), '--json', 'body', '--jq', '.body'] : ['pr', 'view', '--json', 'body', '--jq', '.body'];
  const body = run('gh', args, { optional: true });
  if (!body) return '';
  const metadataMatch = body.match(/origin[_ -]?issue\s*[:#]\s*#?(\d+)/i);
  if (metadataMatch) return metadataMatch[1];
  const closesMatch = body.match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i);
  if (closesMatch) return closesMatch[1];
  return '';
}

function inferContext(opts) {
  const inferred = { ...opts };
  inferred.repository ||= repositoryIdentity();
  if (inferred.targetPrLocked) inferred.issue = '';
  if (!inferred.pr && !inferred.explicitIssue && !inferred.goal) inferred.pr = inferCurrentPr();
  if (inferred.pr && !inferred.issue) inferred.issue = inferIssueFromPrBody(inferred.pr);
  if (inferred.pr && !inferred.head) inferred.head = inferCurrentHead(inferred.pr);
  return inferred;
}

function gitRoot() {
  return run('git', ['rev-parse', '--show-toplevel'], { optional: true }) || process.cwd();
}

function stateDir() {
  return process.env.OPENSPEC_BUDDY_AUTO_STATE_DIR || path.join(gitRoot(), 'openspec/.buddy-cache/auto-state');
}

function recordCacheMetric(kind, surface, outcome, context = {}) {
  const metricsTool = path.join(coreScriptDir, 'cache-metrics.mjs');
  if (!fs.existsSync(metricsTool)) return;
  const cacheDir = process.env.OPENSPEC_BUDDY_CACHE_DIR
    || process.env.OPENSPEC_BUDDY_GH_CACHE_DIR
    || path.dirname(stateDir());
  spawnSync(process.execPath, [metricsTool, 'event', cacheDir, kind, surface, outcome, JSON.stringify(context)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'ignore',
  });
}

function stateKey(opts) {
  if (opts.pr) return `pr-${opts.pr}`;
  if (opts.issue) return `issue-${opts.issue}`;
  if (opts.change) return `change-${opts.change}`;
  return 'worktree';
}

function statePath(opts) {
  return path.join(stateDir(), `${stateKey(opts)}.json`);
}

function validReceipt(state, stage, options = {}) {
  return validSignedReceipt(state, stage, { ...options, stateDir: stateDir() });
}

function readLiveClaimTruth(issue, options = {}) {
  const command = [path.join(coreScriptDir, 'read-live-claim-truth.sh'), String(issue), '--json'];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: Number(process.env.OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS || 5000),
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit status ${result.status ?? 1}`;
    return { ok: false, error: `Live claim truth probe failed: ${detail}`, command };
  }
  let liveClaim;
  try {
    liveClaim = JSON.parse(result.stdout || '{}');
  } catch {
    return { ok: false, error: 'Live claim truth probe returned malformed JSON.', command };
  }
  const statuses = new Set(['owned', 'missing', 'foreign', 'expired', 'invalid']);
  if (!statuses.has(liveClaim.status) || liveClaim.source !== 'github-rest') {
    return { ok: false, error: 'Live claim truth probe returned an invalid result.', command };
  }
  return { ok: true, ...liveClaim, command };
}

function claimedReceiptIsUsable(state, opts, liveClaim) {
  return stateMatchesContext(opts, state)
    && validReceipt(state, 'claimed')
    && liveClaim?.ok === true
    && liveClaim.status === 'owned';
}

function stateMatchesContext(opts, state) {
  if ((state.key || '') !== stateKey(opts)) return false;
  if ((opts.issue || '') !== (state.issue || '')) return false;
  if ((opts.pr || '') !== (state.pr || '')) return false;
  if ((opts.change || '') !== (state.change || '')) return false;
  if (opts.repository && state.repository && opts.repository !== state.repository) return false;
  return true;
}

function readState(opts) {
  const file = statePath(opts);
  if (!fs.existsSync(file)) {
    return { version: 1, key: stateKey(opts), issue: opts.issue || '', pr: opts.pr || '', change: opts.change || '', head: opts.head || '', repository: opts.repository || repositoryIdentity(), stages: {} };
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.head = opts.head || '';
  state.repository ||= opts.repository || repositoryIdentity();
  return state;
}

function writeState(opts, state) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(opts), `${JSON.stringify(state, null, 2)}\n`);
}

function clearMergeAuthorization(opts, mergeAttemptId) {
  const state = readState(opts);
  const authorization = state.stages?.merge_authorized;
  if (!authorization || (mergeAttemptId && authorization.mergeAttemptId !== mergeAttemptId)) return;
  delete state.stages.merge_authorized;
  writeState(opts, state);
}

function recordStage(opts, stage, command = [], extras = {}) {
  if (!stages.has(stage)) throw new Error(`Unknown stage: ${stage}`);
  const state = readState(opts);
  state.issue ||= opts.issue || '';
  state.pr ||= opts.pr || '';
  state.change ||= opts.change || '';
  state.head = opts.head || '';
  state.repository ||= opts.repository || repositoryIdentity();
  const receipt = {
    at: new Date().toISOString(),
    head: opts.head || '',
    repository: state.repository || '',
    issue: state.issue || '',
    pr: state.pr || '',
    command: command.length ? commandLine(command) : '',
    source: 'buddy-auto-driver/run-next',
    ...extras,
  };
  receipt.signature = signReceipt(state, stage, receipt, { stateDir: stateDir() });
  state.stages[stage] = receipt;
  writeState(opts, state);
  return state;
}

function parseGoalSelection(stdout) {
  let data;
  try {
    data = JSON.parse(stdout || '{}');
  } catch {
    return { error: 'select-next-change.sh did not return JSON.' };
  }

  const selected = data.selected || null;
  if (!selected) {
    return { selected: null, reason: data.reason || 'No executable OpenSpec Buddy issue.' };
  }
  if (selected.local_only || selected.no_issue || !selected.number) {
    return {
      selected: null,
      localOnly: Boolean(selected.change_id),
      change: selected.change_id || '',
      reason: selected.change_id
        ? 'Selector chose a local-only change; continue through the local-only --no-pr handoff.'
        : 'Selector chose a local-only change without a change_id.',
    };
  }
  return { selected: String(selected.number), change: selected.change_id || '', reason: selected.title || '' };
}

function parseJsonOutput(stdout, fallbackReason) {
  try {
    return JSON.parse(stdout || '{}');
  } catch {
    return { error: fallbackReason };
  }
}

function parseKeyValueOutput(output) {
  const values = {};
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/i);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function reviewEvidenceFromOutput(output) {
  const values = parseKeyValueOutput(output);
  return {
    responseOutcome: values.review_outcome || '',
    requestId: values.review_request_id || '',
    responseId: values.review_response_id || '',
    responseUrl: values.review_response_url || '',
    responseAt: values.review_response_at || '',
  };
}

function reviewEvidenceFromReceipt(state) {
  const receipt = state.stages?.review_clear || {};
  return {
    requestId: receipt.requestId || '',
    responseId: receipt.responseId || '',
    responseUrl: receipt.responseUrl || '',
    responseAt: receipt.responseAt || '',
    responseOutcome: receipt.responseOutcome || 'clear',
  };
}

function controllerMergeAuthorizationValid(opts, state, { requireMerged = false } = {}) {
  const clear = state.stages?.review_clear || {};
  const authorization = state.stages?.merge_authorized || {};
  if (!validReceipt(state, 'merge_authorized', {
    require: ['repository', 'issue', 'pr', 'head', 'requestId', 'responseId', 'mergeAttemptId'],
  })) return false;
  if (!validReceipt(state, 'review_clear', {
    require: ['repository', 'issue', 'pr', 'head', 'requestId', 'responseId'],
  })) return false;
  if (
    clear.responseOutcome !== 'clear'
    || authorization.requestId !== clear.requestId
    || authorization.responseId !== clear.responseId
    || authorization.repository !== state.repository
    || authorization.pr !== String(opts.pr || '')
    || authorization.head !== String(opts.head || '')
  ) return false;
  if (requireMerged) {
    const merged = state.stages?.merged || {};
    if (!validReceipt(state, 'merged', {
      require: ['repository', 'issue', 'pr', 'head', 'requestId', 'responseId', 'mergeAttemptId'],
    })) return false;
    if (
      merged.requestId !== authorization.requestId
      || merged.responseId !== authorization.responseId
      || merged.mergeAttemptId !== authorization.mergeAttemptId
    ) return false;
  }
  return true;
}

function freshRemotePrTruth(state, pr) {
  const repository = state.repository || repositoryIdentity();
  if (!repository || !pr) return null;
  const result = spawnSync('gh', ['api', `repos/${repository}/pulls/${pr}`], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: Number(process.env.OPENSPEC_BUDDY_COMMAND_TIMEOUT_MS || 5000),
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

function remotePrIsMerged(truth) {
  return Boolean(truth && (
    String(truth.state || '').toUpperCase() === 'MERGED'
    || truth.merged_at
    || truth.mergedAt
  ));
}

function controllerMergeRecoveryAvailable(opts, state) {
  if (!stateMatchesContext(opts, state)) return false;
  if (validReceipt(state, 'merged', {
    require: ['repository', 'issue', 'pr', 'head', 'requestId', 'responseId', 'mergeAttemptId'],
  })) return false;
  if (!controllerMergeAuthorizationValid(opts, state)) return false;
  const remoteTruth = freshRemotePrTruth(state, opts.pr);
  if (!remotePrIsMerged(remoteTruth)) return false;
  const remoteHead = remoteTruth.head?.sha || remoteTruth.headRefOid || '';
  return !remoteHead || !opts.head || String(remoteHead) === String(opts.head);
}

function ensureControllerMergedReceipt(opts, state) {
  if (controllerMergeAuthorizationValid(opts, state, { requireMerged: true })) return true;
  if (!controllerMergeAuthorizationValid(opts, state)) return false;
  const remoteTruth = freshRemotePrTruth(state, opts.pr);
  if (!remotePrIsMerged(remoteTruth)) return false;
  const remoteHead = remoteTruth.head?.sha || remoteTruth.headRefOid || '';
  if (remoteHead && opts.head && String(remoteHead) !== String(opts.head)) return false;
  runControllerOwnedMerge(opts);
  return controllerMergeAuthorizationValid(opts, readState(opts), { requireMerged: true });
}

function unauthorizedMergeRecoveryValid(opts, state) {
  const violation = state.stages?.unauthorized_merge || {};
  const recovery = state.stages?.unauthorized_merge_recovered || {};
  const receiptOptions = {
    require: ['repository', 'issue', 'pr', 'head', 'remoteHead', 'mergedAt'],
    repository: opts.repository,
    issue: String(opts.issue || ''),
    pr: String(opts.pr || ''),
    head: String(opts.head || ''),
  };
  return stateMatchesContext(opts, state)
    && validReceipt(state, 'unauthorized_merge', receiptOptions)
    && validReceipt(state, 'unauthorized_merge_recovered', receiptOptions)
    && Boolean(recovery.recoveryReason)
    && violation.remoteHead === String(opts.head || '')
    && Boolean(violation.mergedAt)
    && Boolean(recovery.mergedAt)
    && recovery.remoteHead === String(opts.head || '')
    && recovery.command === evidenceDigest('unauthorized-merge-recovery', recovery.recoveryReason)
    && recovery.violationSignature === violation.signature;
}

function postMergeAuthorizationValid(opts, state) {
  return controllerMergeAuthorizationValid(opts, state, { requireMerged: true })
    || unauthorizedMergeRecoveryValid(opts, state);
}

function recoverUnauthorizedMerge(opts, state) {
  if (!truthy(process.env.OPENSPEC_BUDDY_AUTO_UNAUTHORIZED_MERGE_RECOVERY)) return { attempted: false };
  if (!controllerChildMode()) {
    return { attempted: true, ok: false, reason: 'Unauthorized merge recovery is controller-owned; rerun through buddy-auto.mjs.' };
  }
  const reason = String(process.env.OPENSPEC_BUDDY_AUTO_RECOVERY_REASON || '').trim();
  if (!reason) {
    return { attempted: true, ok: false, reason: 'Explicit unauthorized merge recovery requires a non-empty user authorization reason.' };
  }
  const violation = state.stages?.unauthorized_merge || {};
  if (!stateMatchesContext(opts, state) || !validReceipt(state, 'unauthorized_merge', {
    require: ['repository', 'issue', 'pr', 'head', 'remoteHead', 'mergedAt'],
    repository: opts.repository,
    issue: String(opts.issue || ''),
    pr: String(opts.pr || ''),
    head: String(opts.head || ''),
  }) || violation.remoteHead !== String(opts.head || '') || !violation.mergedAt) {
    return { attempted: true, ok: false, reason: 'Explicit recovery requires a matching signed violation context for this repository, issue, PR, and head.' };
  }
  const truth = freshRemotePrTruth(state, opts.pr);
  const remoteHead = truth?.head?.sha || truth?.headRefOid || '';
  if (!remotePrIsMerged(truth) || !remoteHead || String(remoteHead) !== String(opts.head || '')) {
    return { attempted: true, ok: false, reason: 'Explicit recovery requires fresh merged PR truth for the exact violation head.' };
  }
  recordStage(opts, 'unauthorized_merge_recovered', [evidenceDigest('unauthorized-merge-recovery', reason)], {
    recoveryReason: reason,
    violationSignature: violation.signature,
    mergedAt: truth.merged_at || truth.mergedAt || '',
    remoteHead,
  });
  return { attempted: true, ok: true };
}

function emitUnauthorizedMerge(opts, reason) {
  const state = readState(opts);
  const truth = freshRemotePrTruth(state, opts.pr);
  const remoteHead = truth?.head?.sha || truth?.headRefOid || '';
  const mergedAt = truth?.merged_at || truth?.mergedAt || '';
  if (!remotePrIsMerged(truth) || !mergedAt || !remoteHead || String(remoteHead) !== String(opts.head || '')) {
    emitBlocked({
      stage: 'unauthorized-merge',
      reason: 'Cannot record an unauthorized merge without fresh merged PR truth for the exact current head.',
      command: [],
      output: `issue: ${opts.issue}\npr: ${opts.pr}\nhead: ${opts.head}`,
    });
    process.exit(1);
  }
  recordStage(opts, 'unauthorized_merge', [evidenceDigest('unauthorized-merge', reason)], {
    violationReason: reason,
    remoteHead,
    mergedAt,
    ...(truth.merge_commit_sha || truth.mergeCommit
      ? { mergeCommit: truth.merge_commit_sha || truth.mergeCommit }
      : {}),
  });
  emitBlocked({
    stage: 'unauthorized-merge',
    reason,
    command: [],
    output: `issue: ${opts.issue}\npr: ${opts.pr}\nhead: ${opts.head}`,
  });
  process.exit(1);
}

function commandFor(opts, state, runtime = {}) {
  if (opts.noPr) {
    if (opts.issue || opts.pr || !opts.change) {
      return {
        stage: 'blocked',
        command: [],
        reason: '--no-pr is valid only with --change for an explicit local-only propose --no-issue change; do not use it with issue-backed work.',
      };
    }
    return {
      stage: 'local-review',
      command: [],
      reason: 'Local-only --no-pr path: run local review and verification; do not call GitHub PR helpers.',
    };
  }

  if (!opts.issue && !opts.pr) {
    if (opts.goal) {
      return {
        stage: 'goal-select',
        command: [path.join(coreScriptDir, 'select-next-change.sh')],
        precommands: [[path.join(coreScriptDir, 'verify-bound-worktree.sh'), '--phase', 'goal-loop-start']],
        reason: 'Goal-loop is authorized. Recalculate executable issues, select the smallest claimable issue, then claim it through the driver.',
      };
    }
    return {
      stage: 'no-goal-context',
      command: [],
      reason: 'No issue or PR context was inferred. Do not claim new work or mutate GitHub state until a concrete phase context exists.',
    };
  }

  if (!opts.pr) {
    const contextMatches = stateMatchesContext(opts, state);
    const localClaimed = contextMatches && validReceipt(state, 'claimed');
    if (!localClaimed) {
      return {
        stage: 'claim-issue',
        command: [path.join(coreScriptDir, 'claim-issue.sh'), opts.issue],
        reason: 'Explicit issue target must be claimed by the driver before implementation or PR work.',
        records: ['claimed'],
      };
    }
    runtime.liveClaim = readLiveClaimTruth(opts.issue);
    if (!runtime.liveClaim.ok) {
      return {
        stage: 'blocked',
        command: [],
        reason: runtime.liveClaim.error,
      };
    }
    if (runtime.liveClaim.status === 'foreign') {
      recordCacheMetric('coordination', 'live-claim', 'stale_recovery', { issue: opts.issue, status: runtime.liveClaim.status });
      return {
        stage: 'blocked',
        command: [],
        reason: `Live claim belongs to another identity (${runtime.liveClaim.reason || 'foreign claim'}); do not take over the issue automatically.`,
      };
    }
    if (runtime.liveClaim.status === 'missing') {
      recordCacheMetric('coordination', 'live-claim', 'stale_recovery', { issue: opts.issue, status: runtime.liveClaim.status });
      return {
        stage: 'claim-issue',
        command: [path.join(coreScriptDir, 'claim-issue.sh'), opts.issue],
        reason: `Live claim is ${runtime.liveClaim.status}; reacquire the remote claim before issue/PR lookup.`,
        records: ['claimed'],
        claimRecovery: true,
      };
    }
    if (runtime.liveClaim.status === 'expired') {
      if (runtime.liveClaim.issueStatus === 'status:claimed') {
        recordCacheMetric('coordination', 'live-claim', 'stale_recovery', { issue: opts.issue, status: runtime.liveClaim.status });
        return {
          stage: 'claim-issue',
          command: [path.join(coreScriptDir, 'claim-issue.sh'), opts.issue],
          reason: 'Live claim is expired while issue remains status:claimed; recover the remote claim before issue/PR lookup.',
          records: ['claimed'],
          claimRecovery: true,
        };
      }
      recordCacheMetric('coordination', 'live-claim', 'stale_recovery', {
        issue: opts.issue,
        status: runtime.liveClaim.status,
        issueStatus: runtime.liveClaim.issueStatus || 'unknown',
      });
      return {
        stage: 'blocked',
        command: [],
        reason: `Live claim is expired while issue status is '${runtime.liveClaim.issueStatus || 'unknown'}'; reconcile the active issue state before retrying claim recovery.`,
      };
    }
    if (!claimedReceiptIsUsable(state, opts, runtime.liveClaim)) {
      recordCacheMetric('coordination', 'live-claim', 'stale_recovery', { issue: opts.issue, status: runtime.liveClaim.status });
      return {
        stage: 'blocked',
        command: [],
        reason: `Live claim status '${runtime.liveClaim.status}' cannot authorize issue/PR lookup.`,
      };
    }
    return {
      stage: 'issue-pr-bridge',
      command: [path.join(coreScriptDir, 'find-issue-pr.sh'), opts.issue],
      reason: 'Issue is claimed for this driver context. Check for an exact issue-bound PR before handing implementation back to the agent.',
    };
  }

  if (!opts.issue) {
    return {
      stage: 'blocked',
      command: [],
      reason: 'PR review phases require --issue so coordination can be verified against the origin issue.',
    };
  }

  if (!opts.head) {
    return {
      stage: 'blocked',
      command: [],
      reason: 'PR review phases require the current PR head. Set OPENSPEC_BUDDY_AUTO_HEAD or run from a worktree where gh pr view <pr> can read headRefOid.',
    };
  }

  const contextMatches = stateMatchesContext(opts, state);
  const markReviewPassed = contextMatches && validReceipt(state, 'mark_review_passed');
  const reviewRequested = contextMatches && validReceipt(state, 'review_requested');
  const reviewResponseGatePassed = contextMatches && validReceipt(state, 'review_response_gate_passed');
  const reviewClear = contextMatches && validReceipt(state, 'review_clear');
  const mergeGatesPassed = contextMatches && validReceipt(state, 'merge_gates_passed');
  const merged = contextMatches && validReceipt(state, 'merged', {
    require: ['repository', 'requestId', 'responseId', 'mergeAttemptId'],
  });

  if (merged) {
    return {
      stage: 'achieved-truth',
      command: [path.join(coreScriptDir, 'verify-achieved-truth.mjs'), opts.issue, opts.pr],
      reason: 'Controller-owned merge was verified for this exact head; read archive and achievement truth.',
    };
  }

  if (unauthorizedMergeRecoveryValid(opts, state)) {
    return {
      stage: 'achieved-truth',
      command: [path.join(coreScriptDir, 'verify-achieved-truth.mjs'), opts.issue, opts.pr],
      reason: 'Signed unauthorized merge recovery permits post-merge achievement truth for this exact head.',
    };
  }

  if (controllerMergeRecoveryAvailable(opts, state)) {
    return {
      stage: 'achieved-truth',
      command: [path.join(coreScriptDir, 'verify-achieved-truth.mjs'), opts.issue, opts.pr],
      reason: 'Remote PR is merged and a matching merge authorization receipt exists; recover the missing merged receipt before applying live-claim gates.',
    };
  }

  runtime.liveClaim = readLiveClaimTruth(opts.issue);
  if (!runtime.liveClaim.ok) {
    return {
      stage: 'blocked',
      command: [],
      reason: runtime.liveClaim.error,
    };
  }
  if (runtime.liveClaim.status !== 'owned') {
    recordCacheMetric('coordination', 'live-claim', 'stale_recovery', {
      issue: opts.issue,
      pr: opts.pr,
      status: runtime.liveClaim.status,
    });
    return {
      stage: 'blocked',
      command: [],
      reason: `Live claim status '${runtime.liveClaim.status}' cannot authorize PR phases.`,
    };
  }

  if (truthy(process.env.OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT) && !reviewResponseGatePassed) {
    return {
      stage: 'review-response-gate',
      command: [path.join(coreScriptDir, 'review-response-gate.sh'), opts.pr, '--head', opts.head],
      reason: 'Review-fix context requires reply -> resolve -> verify before requesting or waiting for another review.',
      records: ['review_response_gate_passed'],
    };
  }

  if (!markReviewPassed || !reviewRequested) {
    return {
      stage: 'mark-review',
      command: [path.join(coreScriptDir, 'mark-review.sh'), opts.issue, opts.pr],
      reason: 'PR must pass metadata coordination, review request, and in-review sync before any review wait.',
      records: ['mark_review_passed', 'review_requested'],
    };
  }

  if (!reviewClear) {
    if (process.env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE === 'yield') {
      return {
        stage: 'review-yield',
        command: [],
        reason: 'Current PR has passed mark-review and has a current-head review request. Multi-lane scheduler may park this lane instead of entering the blocking review wait.',
      };
    }
    if (process.env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE === 'verify-once') {
      return {
        stage: 'wait-review',
        command: [path.join(coreScriptDir, 'verify-review-clear.sh'), opts.pr],
        reason: 'Multi-lane merge-ready recovery verifies current-head review clearance once without entering the blocking foreground wait.',
        records: ['review_clear'],
      };
    }
    return {
      stage: 'wait-review',
      command: [path.join(coreScriptDir, 'wait-for-review-clear.sh'), opts.pr],
      reason: 'The only legal review wait is the foreground wait helper. Do not hand-write sleep or gh polling.',
      records: ['review_clear'],
    };
  }

  if (!mergeGatesPassed) {
    return {
      stage: 'merge-gates',
      command: [path.join(coreScriptDir, 'verify-review-clear.sh'), opts.pr],
      reason: 'Current state has review_clear. Run final merge gates before merge or achievement.',
      records: ['merge_gates_passed'],
    };
  }

  return {
    stage: 'achieved-truth',
    command: [path.join(coreScriptDir, 'verify-achieved-truth.mjs'), opts.issue, opts.pr],
    reason: 'Review and merge gates passed. Read GitHub and archive truth before merge handoff or post-merge achievement sync.',
  };
}

function runProcess(command) {
  return spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runControllerOwnedMerge(opts) {
  const mergeCommand = [path.join(coreScriptDir, 'merge-pr-after-gates.sh'), opts.issue, opts.pr, opts.head];
  const beforeState = readState(opts);
  const remoteTruth = freshRemotePrTruth(beforeState, opts.pr);
  if (remotePrIsMerged(remoteTruth)) {
    if (!controllerMergeAuthorizationValid(opts, beforeState)) {
      emitUnauthorizedMerge(opts, 'PR is already merged without a matching controller merge authorization receipt.');
    }
    if (!validReceipt(beforeState, 'merged', {
      require: ['repository', 'issue', 'pr', 'head', 'requestId', 'responseId', 'mergeAttemptId'],
    })) {
      const authorization = beforeState.stages.merge_authorized;
      recordStage(opts, 'merged', mergeCommand, {
        repository: beforeState.repository,
        requestId: authorization.requestId,
        responseId: authorization.responseId,
        responseUrl: authorization.responseUrl || '',
        responseAt: authorization.responseAt || '',
        responseOutcome: 'clear',
        mergeAttemptId: authorization.mergeAttemptId,
        mergeCommit: remoteTruth.merge_commit_sha || remoteTruth.mergeCommitSha || '',
        mergedHead: remoteTruth.head?.sha || remoteTruth.headRefOid || opts.head,
      });
    }
    return;
  }
  const evidence = reviewEvidenceFromReceipt(beforeState);
  if (!beforeState.repository || !evidence.requestId || !evidence.responseId) {
    emitBlocked({
      stage: 'merge-pr',
      reason: 'Cannot authorize merge without exact repository, current-head review request, and clear response evidence.',
      command: [],
    });
    process.exit(1);
  }
  const mergeAttemptId = crypto.randomUUID();
  recordStage(opts, 'merge_authorized', mergeCommand, {
    repository: beforeState.repository,
    requestId: evidence.requestId,
    responseId: evidence.responseId,
    responseUrl: evidence.responseUrl,
    responseAt: evidence.responseAt,
    responseOutcome: 'clear',
    mergeAttemptId,
  });

  const result = runProcess(mergeCommand);
  if (result.status !== 0) {
    clearMergeAuthorization(opts, mergeAttemptId);
    emitBlocked({
      stage: 'merge-pr',
      reason: `${mergeCommand[0]} exited with status ${result.status ?? 1}`,
      command: [],
      output: compactOutput(result),
    });
    process.exit(result.status ?? 1);
  }
  const merged = parseJsonOutput(result.stdout || '', 'merge-pr-after-gates.sh did not return JSON.');
  if (merged.error || merged.merged !== true) {
    clearMergeAuthorization(opts, mergeAttemptId);
    emitBlocked({
      stage: 'merge-pr',
      reason: merged.error || 'Controller-owned merge did not return merged: true.',
      command: [],
      output: compactOutput(result),
    });
    process.exit(1);
  }
  if (
    String(merged.pr || '') !== String(opts.pr)
    || String(merged.head || '') !== String(opts.head)
    || String(merged.reviewRequestId || '') !== evidence.requestId
    || String(merged.reviewResponseId || '') !== evidence.responseId
    || (evidence.responseUrl && String(merged.reviewResponseUrl || '') !== evidence.responseUrl)
  ) {
    clearMergeAuthorization(opts, mergeAttemptId);
    emitBlocked({
      stage: 'merge-pr',
      reason: 'Controller-owned merge evidence does not match the authorized repository, PR, head, request, or response.',
      command: [],
      output: compactOutput(result),
    });
    process.exit(1);
  }
  recordStage(opts, 'merged', mergeCommand, {
    repository: beforeState.repository,
    requestId: merged.reviewRequestId,
    responseId: merged.reviewResponseId,
    responseUrl: merged.reviewResponseUrl || evidence.responseUrl,
    responseAt: evidence.responseAt,
    responseOutcome: 'clear',
    mergeAttemptId,
    mergeCommit: merged.mergeCommit || '',
    mergedHead: merged.head || '',
  });
}

function emitImplementHandoff(opts, command = []) {
  emitHandoff({
    stage: 'implement-or-open-pr',
    reason: 'Issue is claimed for this driver context and no exact issue-bound PR exists yet. Continue implementation, independent acceptance review, commit, push, and open a ready PR through the core workflow.',
    command,
    state: opts,
  });
}

function recordIssuePrBound(opts, bridge, command) {
  opts.pr = String(bridge.pr || '');
  opts.head = bridge.head || bridge.headRefOid || '';
  opts.explicitPr = true;
  opts.explicitIssue = true;
  recordStage(opts, 'issue_pr_bound', command, {
    issue: String(bridge.issue || opts.issue || ''),
    pr: opts.pr,
    headRefName: bridge.headRefName || '',
    prUrl: bridge.url || '',
    bridgeSource: 'find-issue-pr.sh',
    bridgeReason: bridge.reason || '',
  });
}

function runPostMergeAchievement(opts, truth, command) {
  const archivePath = truth.archivePath || truth.archive_path || '';
  if (!archivePath) {
    emitBlocked({
      stage: 'post-merge-achieve',
      reason: 'verify-achieved-truth requested post-merge achievement but did not return archivePath.',
      command,
    });
    process.exit(1);
  }
  const achieveCommand = [path.join(coreScriptDir, 'mark-achieved-post-merge.sh'), opts.issue, archivePath, opts.pr];
  let result = runProcess(achieveCommand);
  if (result.status !== 0 && safeToRerun(result)) {
    result = runProcess(achieveCommand);
  }
  if (result.status !== 0) {
    emitBlocked({
      stage: 'post-merge-achieve',
      reason: `${achieveCommand[0]} exited with status ${result.status ?? 1}`,
      command: achieveCommand,
      output: compactOutput(result),
    });
    process.exit(result.status ?? 1);
  }
  const verify = runProcess(command);
  if (verify.status !== 0) {
    emitBlocked({
      stage: 'post-merge-achieve',
      reason: `${command[0]} exited with status ${verify.status ?? 1} after post-merge achievement sync`,
      command,
      output: compactOutput(verify),
    });
    process.exit(verify.status ?? 1);
  }
  const verifiedTruth = parseJsonOutput(verify.stdout || '', 'verify-achieved-truth.mjs did not return JSON after post-merge achievement sync.');
  if (verifiedTruth.achieved !== true) {
    emitBlocked({
      stage: 'post-merge-achieve',
      reason: verifiedTruth.reason || 'Post-merge achievement sync completed, but terminal truth is still incomplete.',
      command,
      output: compactOutput(verify),
    });
    process.exit(1);
  }
  recordStage(opts, 'post_merge_achieved', achieveCommand);
  recordStage(opts, 'achieved', achieveCommand);
  emitDone({
    stage: 'mark-achieved-post-merge',
    command: achieveCommand,
    state: opts,
    next: { stage: 'achieved', reason: 'Post-merge achievement sync completed.', command: [] },
    output: compactOutput(result),
  });
}

function printNext(opts) {
  const state = readState(opts);
  const next = commandFor(opts, state, {});
  emitHandoff({ stage: next.stage, reason: next.reason, command: next.command });
  if (!stateMatchesContext(opts, state)) {
    console.log('- state_context: invalid');
  }
  for (const stage of Object.keys(state.stages)) {
    const receipt = state.stages[stage];
    const validity = validReceipt(state, stage) ? 'valid' : 'invalid';
    console.log(`- ${stage}: ${receipt.at}${receipt.head ? ` head=${receipt.head}` : ''} (${validity})`);
  }
}

function runDriver(opts) {
  let lastStage = '';
  const runtime = {};
  for (let i = 0; i < 8; i += 1) {
    const state = readState(opts);
    if (state.stages?.unauthorized_merge && !unauthorizedMergeRecoveryValid(opts, state)) {
      const recovery = recoverUnauthorizedMerge(opts, state);
      if (!recovery.attempted) {
        emitBlocked({
          stage: 'unauthorized-merge',
          reason: state.stages.unauthorized_merge.violationReason || 'PR merged without a matching controller merge authorization receipt; explicit recovery is required.',
        });
        process.exit(1);
      }
      if (!recovery.ok) {
        emitBlocked({ stage: 'unauthorized-merge-recovery', reason: recovery.reason });
        process.exit(1);
      }
      continue;
    }
    const next = commandFor(opts, state, runtime);
    lastStage = next.stage;
    if (next.stage === 'blocked') {
      emitBlocked({ stage: next.stage, reason: next.reason, command: next.command });
      return;
    }
    if (!next.command.length) {
      if (next.stage === 'review-yield') {
        emitDone({
          stage: next.stage,
          command: next.command,
          state: opts,
          next: { stage: 'waiting_review', reason: next.reason, command: [] },
        });
        return;
      }
      emitHandoff({ stage: next.stage, reason: next.reason, command: next.command });
      return;
    }

    for (const precommand of next.precommands || []) {
      const preflight = runProcess(precommand);
      if (preflight.status !== 0) {
        emitBlocked({
          stage: next.stage,
          reason: `${precommand[0]} exited with status ${preflight.status ?? 1}`,
          command: precommand,
          output: compactOutput(preflight),
        });
        process.exit(preflight.status ?? 1);
      }
    }

    const result = runProcess(next.command);
    if (result.status !== 0) {
      emitBlocked({
        stage: next.stage,
        reason: `${next.command[0]} exited with status ${result.status ?? 1}`,
        command: next.command,
        output: compactOutput(result),
      });
      process.exit(result.status ?? 1);
    }

    if (next.stage === 'goal-select') {
      const selection = parseGoalSelection(result.stdout || '');
      if (selection.error) {
        emitBlocked({ stage: next.stage, reason: selection.error, command: next.command, output: compactOutput(result) });
        process.exit(1);
      }
      if (!selection.selected) {
        if (selection.localOnly) {
          opts.change = selection.change;
          opts.noPr = true;
          opts.issue = '';
          opts.pr = '';
          opts.head = '';
          continue;
        }
        emitDone({
          stage: 'no-available-changes',
          command: next.command,
          state: opts,
          next: { stage: '', reason: selection.reason, command: [] },
        });
        return;
      }
      opts.issue = selection.selected;
      opts.change ||= selection.change || '';
      opts.pr = '';
      opts.head = '';
      opts.explicitIssue = true;
      opts.explicitPr = false;
      continue;
    }

    if (next.stage === 'issue-pr-bridge') {
      const bridge = parseJsonOutput(result.stdout || '', 'find-issue-pr.sh did not return JSON.');
      if (bridge.error) {
        emitBlocked({ stage: next.stage, reason: bridge.error, command: next.command, output: compactOutput(result) });
        process.exit(1);
      }
      if (!bridge.pr) {
        emitImplementHandoff(opts, next.command);
        return;
      }
      if (String(bridge.issue || opts.issue) !== String(opts.issue)) {
        emitBlocked({
          stage: next.stage,
          reason: `find-issue-pr.sh returned issue ${bridge.issue}, expected ${opts.issue}.`,
          command: next.command,
          output: compactOutput(result),
        });
        process.exit(1);
      }
      recordIssuePrBound(opts, bridge, next.command);
      continue;
    }

    if (next.stage === 'achieved-truth') {
      const truth = parseJsonOutput(result.stdout || '', 'verify-achieved-truth.mjs did not return JSON.');
      if (truth.error) {
        emitBlocked({ stage: next.stage, reason: truth.error, command: next.command, output: compactOutput(result) });
        process.exit(1);
      }
      if (truth.achieved === true) {
        const currentState = readState(opts);
        if (!postMergeAuthorizationValid(opts, currentState) && !ensureControllerMergedReceipt(opts, currentState)) {
          emitUnauthorizedMerge(opts, 'Achievement truth is terminal for a merged PR, but no matching controller merge authorization receipt exists.');
        }
        recordStage(opts, 'achieved', next.command);
        emitDone({
          stage: 'achieved',
          command: next.command,
          state: opts,
          next: { stage: 'achieved', reason: truth.reason || 'Terminal truth already satisfied.', command: [] },
        });
        return;
      }
      if (truth.next === 'mark-achieved-post-merge') {
        const currentState = readState(opts);
        if (!postMergeAuthorizationValid(opts, currentState) && !ensureControllerMergedReceipt(opts, currentState)) {
          emitUnauthorizedMerge(opts, 'Post-merge achievement was requested for a merged PR without a matching controller merge authorization receipt.');
        }
        runPostMergeAchievement(opts, truth, next.command);
        return;
      }
      if (truth.next === 'merge-pr') {
        runControllerOwnedMerge(opts);
        continue;
      }
      emitBlocked({
        stage: next.stage,
        reason: truth.reason || 'Achievement truth is incomplete and no safe deterministic next step was provided.',
        command: next.command,
        output: compactOutput(result),
      });
      process.exit(1);
    }

    for (const stage of next.records || []) {
      const extras = stage === 'review_clear'
        ? (() => {
          const evidence = reviewEvidenceFromOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
          return {
            responseOutcome: evidence.responseOutcome || 'clear',
            requestId: evidence.requestId,
            responseId: evidence.responseId,
            responseUrl: evidence.responseUrl,
            responseAt: evidence.responseAt,
          };
        })()
        : {};
      recordStage(opts, stage, next.command, extras);
    }

    if (next.stage === 'claim-issue') {
      if (next.claimRecovery) {
        emitDone({
          stage: next.stage,
          command: next.command,
          state: opts,
          next: {
            stage: 'issue-pr-bridge',
            reason: 'Remote claim was reacquired. Rerun the controller to verify the new live claim before looking up an issue-bound PR.',
            command: [path.join(coreScriptDir, 'find-issue-pr.sh'), opts.issue],
          },
        });
        return;
      }
      runtime.liveClaim = {
        ok: true,
        status: 'owned',
        source: 'claim-issue',
        checkedAt: new Date().toISOString(),
      };
    }

    if (next.stage === 'wait-review' && process.env.OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE === 'verify-once') {
      emitDone({
        stage: 'review_clear',
        command: next.command,
        state: opts,
        next: { stage: 'merge-gates', reason: 'verify-once recorded review_clear without running merge gates.', command: [] },
      });
      return;
    }

    if (deterministicStages.has(next.stage)) continue;

    const afterState = readState(opts);
    const after = commandFor(opts, afterState);
    emitDone({
      stage: next.stage,
      command: next.command,
      state: opts,
      next: after,
    });
    return;
  }
  emitBlocked({ stage: 'driver-loop', reason: `Auto driver exceeded its deterministic step limit after stage ${lastStage || 'unknown'}.` });
  process.exit(1);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log('Usage: buddy-auto-driver.mjs [--dry-run] [--goal] [--target-issue N] [--target-pr N] [--issue N] [--pr N] [--change ID] [--head SHA] [--no-pr]');
    return;
  }
  const blocked = directRunBlockedByController();
  if (blocked) {
    emitBlocked({ stage: 'controller-owned', reason: blocked });
    return;
  }
  const opts = inferContext(parsed);
  if (opts.dryRun) printNext(opts);
  else runDriver(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
