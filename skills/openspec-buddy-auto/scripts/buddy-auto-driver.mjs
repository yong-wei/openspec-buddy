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
  'merged',
  'achieved',
]);

function parseArgs(argv) {
  const opts = {
    issue: '',
    pr: '',
    change: '',
    head: process.env.OPENSPEC_BUDDY_AUTO_HEAD || '',
    noPr: false,
    runNext: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--issue') opts.issue = argv[++i] || '';
    else if (arg === '--pr') opts.pr = argv[++i] || '';
    else if (arg === '--change') opts.change = argv[++i] || '';
    else if (arg === '--head') opts.head = argv[++i] || '';
    else if (arg === '--no-pr') opts.noPr = true;
    else if (arg === '--run-next') opts.runNext = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
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
    return { version: 1, key: stateKey(opts), issue: opts.issue || '', pr: opts.pr || '', change: opts.change || '', stages: {} };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
    return {
      stage: 'select-or-claim',
      command: [path.join(coreScriptDir, 'claim-issue.sh')],
      reason: 'No issue or PR context was supplied. Select or claim the smallest executable issue first.',
    };
  }

  if (!opts.pr) {
    return {
      stage: 'implement-or-open-pr',
      command: [],
      reason: 'No PR was supplied. Continue implementation, independent acceptance review, commit, push, and open a ready PR through the core workflow.',
    };
  }

  if (!opts.issue) {
    return {
      stage: 'blocked',
      command: [],
      reason: 'PR review phases require --issue so coordination can be verified against the origin issue.',
    };
  }

  const contextMatches = stateMatchesContext(opts, state);
  const markReviewPassed = contextMatches && validReceipt(state, 'mark_review_passed');
  const reviewRequested = contextMatches && validReceipt(state, 'review_requested');
  const reviewClear = contextMatches && validReceipt(state, 'review_clear');

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

  return {
    stage: 'merge-gates',
    command: [path.join(coreScriptDir, 'verify-review-clear.sh'), opts.pr],
    reason: 'Current state has review_clear. Run final merge gates, merge, then mark achieved through core helpers.',
  };
}

function printNext(opts) {
  const state = readState(opts);
  const next = commandFor(opts, state);
  console.log('OpenSpec Buddy Auto Driver');
  console.log(`state_file: ${statePath(opts)}`);
  console.log(`stage: ${next.stage}`);
  console.log(`reason: ${next.reason}`);
  console.log('');
  if (next.command.length) {
    console.log('NEXT LEGAL COMMAND');
    console.log(commandLine(next.command));
  } else {
    console.log('NEXT LEGAL ACTION');
    console.log(next.reason);
  }
  console.log('');
  console.log('Receipts');
  if (!stateMatchesContext(opts, state)) {
    console.log('- state_context: invalid');
  }
  for (const stage of Object.keys(state.stages)) {
    const receipt = state.stages[stage];
    const validity = validReceipt(state, stage) ? 'valid' : 'invalid';
    console.log(`- ${stage}: ${receipt.at}${receipt.head ? ` head=${receipt.head}` : ''} (${validity})`);
  }
  console.log('');
  console.log('Rules: run this driver before every auto phase; do not replace its command with manual gh, git, or sleep polling.');
}

function runNext(opts) {
  const state = readState(opts);
  const next = commandFor(opts, state);
  if (!next.command.length) {
    printNext(opts);
    return;
  }

  const result = spawnSync(next.command[0], next.command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);

  for (const stage of next.records || []) {
    recordStage(opts, stage, next.command);
  }
  printNext(opts);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: buddy-auto-driver.mjs [--issue N] [--pr N] [--change ID] [--head SHA] [--no-pr] [--run-next]');
    return;
  }
  if (opts.runNext) runNext(opts);
  else printNext(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
