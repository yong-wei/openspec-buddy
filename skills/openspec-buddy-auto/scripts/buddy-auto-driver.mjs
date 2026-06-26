#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const autoScriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(autoScriptDir, '../../openspec-buddy/scripts');
const coreScriptDir = process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;

const stages = new Set([
  'claimed',
  'in_progress',
  'pr_opened',
  'mark_review_passed',
  'review_requested',
  'review_clear',
  'merge_gates_passed',
  'merged',
  'achieved',
]);

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
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

function emitDone({ stage, command = [], state, next, output = '' }) {
  outputBlock('DONE', [
    ['stage', stage],
    ['state_file', statePath(state)],
    ['command', command.length ? commandLine(command) : ''],
    ['next_stage', next?.stage || ''],
    ['next_action', next?.reason || ''],
    ['next_command', next?.command?.length ? commandLine(next.command) : ''],
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
    ['command', command.length ? commandLine(command) : ''],
  ]);
  if (output) {
    console.log('diagnostic:');
    console.log(output);
  }
}

function emitHandoff({ stage, reason, command = [] }) {
  outputBlock('HANDOFF', [
    ['stage', stage],
    ['required_action', reason],
    ['command', command.length ? commandLine(command) : ''],
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

function stateKey(opts) {
  if (opts.pr) return `pr-${opts.pr}`;
  if (opts.issue) return `issue-${opts.issue}`;
  if (opts.change) return `change-${opts.change}`;
  return 'worktree';
}

function statePath(opts) {
  return path.join(stateDir(), `${stateKey(opts)}.json`);
}

function secretPath() {
  return path.join(stateDir(), '.receipt-secret');
}

function receiptSecret({ create = false } = {}) {
  const file = secretPath();
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  if (!create) return '';
  fs.mkdirSync(stateDir(), { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function receiptPayload(state, stage, receipt) {
  return [
    state.key || '',
    state.issue || '',
    state.pr || '',
    state.change || '',
    stage,
    receipt.at || '',
    receipt.head || '',
    receipt.command || '',
    receipt.source || '',
  ].join('\0');
}

function signReceipt(state, stage, receipt) {
  const secret = receiptSecret({ create: true });
  return crypto.createHmac('sha256', secret).update(receiptPayload(state, stage, receipt)).digest('hex');
}

function validReceipt(state, stage) {
  const receipt = state.stages?.[stage];
  if (!receipt?.signature || receipt.source !== 'buddy-auto-driver/run-next') return false;
  if (state.pr && receipt.head !== state.head) return false;
  const secret = receiptSecret();
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(receiptPayload(state, stage, receipt)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(receipt.signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function stateMatchesContext(opts, state) {
  if ((state.key || '') !== stateKey(opts)) return false;
  if ((opts.issue || '') !== (state.issue || '')) return false;
  if ((opts.pr || '') !== (state.pr || '')) return false;
  if ((opts.change || '') !== (state.change || '')) return false;
  return true;
}

function readState(opts) {
  const file = statePath(opts);
  if (!fs.existsSync(file)) {
    return { version: 1, key: stateKey(opts), issue: opts.issue || '', pr: opts.pr || '', change: opts.change || '', head: opts.head || '', stages: {} };
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.head = opts.head || '';
  return state;
}

function writeState(opts, state) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(opts), `${JSON.stringify(state, null, 2)}\n`);
}

function recordStage(opts, stage, command = []) {
  if (!stages.has(stage)) throw new Error(`Unknown stage: ${stage}`);
  const state = readState(opts);
  state.issue ||= opts.issue || '';
  state.pr ||= opts.pr || '';
  state.change ||= opts.change || '';
  state.head = opts.head || '';
  const receipt = {
    at: new Date().toISOString(),
    head: opts.head || '',
    command: command.length ? commandLine(command) : '',
    source: 'buddy-auto-driver/run-next',
  };
  receipt.signature = signReceipt(state, stage, receipt);
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

function commandFor(opts, state) {
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
    const claimed = contextMatches && validReceipt(state, 'claimed');
    if (!claimed) {
      return {
        stage: 'claim-issue',
        command: [path.join(coreScriptDir, 'claim-issue.sh'), opts.issue],
        reason: 'Explicit issue target must be claimed by the driver before implementation or PR work.',
        records: ['claimed'],
      };
    }
    return {
      stage: 'implement-or-open-pr',
      command: [],
      reason: 'Issue is claimed for this driver context. Continue implementation, independent acceptance review, commit, push, and open a ready PR through the core workflow.',
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
  const reviewClear = contextMatches && validReceipt(state, 'review_clear');
  const mergeGatesPassed = contextMatches && validReceipt(state, 'merge_gates_passed');

  if (!markReviewPassed || !reviewRequested) {
    return {
      stage: 'mark-review',
      command: [path.join(coreScriptDir, 'mark-review.sh'), opts.issue, opts.pr],
      reason: 'PR must pass metadata coordination, review request, and in-review sync before any review wait.',
      records: ['mark_review_passed', 'review_requested'],
    };
  }

  if (!reviewClear) {
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
    stage: 'merge-or-achieve',
    command: [],
    reason: 'Review and merge gates passed. Merge the PR, archive the local change, then mark achieved through core helpers.',
  };
}

function printNext(opts) {
  const state = readState(opts);
  const next = commandFor(opts, state);
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

function shouldContinue(stage) {
  return stage === 'mark-review';
}

function runProcess(command) {
  return spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runDriver(opts) {
  for (let i = 0; i < 4; i += 1) {
    const state = readState(opts);
    const next = commandFor(opts, state);
    if (next.stage === 'blocked') {
      emitBlocked({ stage: next.stage, reason: next.reason, command: next.command });
      return;
    }
    if (!next.command.length) {
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

    for (const stage of next.records || []) {
      recordStage(opts, stage, next.command);
    }

    if (shouldContinue(next.stage)) continue;

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
  emitBlocked({ stage: 'driver-loop', reason: 'Auto driver exceeded its deterministic step limit.' });
  process.exit(1);
}

function main() {
  const opts = inferContext(parseArgs(process.argv.slice(2)));
  if (opts.help) {
    console.log('Usage: buddy-auto-driver.mjs [--dry-run] [--goal] [--target-issue N] [--target-pr N] [--issue N] [--pr N] [--change ID] [--head SHA] [--no-pr]');
    return;
  }
  if (opts.dryRun) printNext(opts);
  else runDriver(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
