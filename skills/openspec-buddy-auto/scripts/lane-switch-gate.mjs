#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreScriptDir = path.resolve(scriptDir, '../../openspec-buddy/scripts');
const coreScriptDir = process.env.OPENSPEC_BUDDY_CORE_SCRIPT_DIR || defaultCoreScriptDir;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    if (options.optional) return '';
    const error = new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
    error.status = result.status ?? 1;
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const opts = { mode: '', issue: '', pr: '', branch: '', head: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--safe-yield') opts.mode = 'safe-yield';
    else if (arg === '--resume') opts.mode = 'resume';
    else if (arg === '--issue') opts.issue = argv[++i] || '';
    else if (arg === '--pr') opts.pr = argv[++i] || '';
    else if (arg === '--branch') opts.branch = argv[++i] || '';
    else if (arg === '--head') opts.head = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function requireCleanWorktree() {
  const status = run('git', ['status', '--porcelain']);
  if (status) throw new Error('worktree is dirty; refusing lane switch');
}

function requireCurrentBranch(expected) {
  const branch = run('git', ['branch', '--show-current']);
  if (!branch) throw new Error('detached HEAD is not allowed for lane switching');
  if (expected && branch !== expected) {
    throw new Error(`wrong branch: expected ${expected}, got ${branch}`);
  }
  return branch;
}

function requireHead(expected) {
  const head = run('git', ['rev-parse', 'HEAD']);
  if (expected && head !== expected) {
    throw new Error(`wrong HEAD: expected ${expected}, got ${head}`);
  }
  return head;
}

function requirePrTruth({ pr, branch, head }) {
  if (!pr) return {};
  const raw = run('gh', ['pr', 'view', String(pr), '--json', 'headRefName,headRefOid,state,number']);
  const data = JSON.parse(raw);
  if (String(data.state || '').toUpperCase() !== 'OPEN') {
    throw new Error(`PR ${pr} is not open`);
  }
  if (branch && data.headRefName !== branch) {
    throw new Error(`PR ${pr} head branch mismatch: expected ${branch}, got ${data.headRefName || ''}`);
  }
  if (head && data.headRefOid !== head) {
    throw new Error(`PR ${pr} head mismatch: expected ${head}, got ${data.headRefOid || ''}`);
  }
  return data;
}

function requireRemoteBranch(branch) {
  if (!branch) return;
  const output = run('git', ['ls-remote', '--heads', 'origin', branch]);
  if (!output) throw new Error(`remote branch origin/${branch} is missing`);
}

function requireClaimGuard({ issue, pr }) {
  const args = [];
  if (issue) args.push('--issue', String(issue));
  if (pr) args.push('--pr', String(pr));
  if (args.length === 0) return;
  run(path.join(coreScriptDir, 'verify-claim-worktree.sh'), args);
}

export function verifySafeYield(opts) {
  requireCleanWorktree();
  const branch = requireCurrentBranch(opts.branch);
  const head = requireHead(opts.head);
  requireClaimGuard(opts);
  requirePrTruth({ ...opts, branch, head: opts.head || head });
  requireRemoteBranch(opts.branch || branch);
  if (opts.pr) {
    run(path.join(coreScriptDir, 'verify-current-head-review-request.sh'), [String(opts.pr)]);
  }
  return { ok: true, branch, head };
}

export function verifyResume(opts) {
  requireCleanWorktree();
  if (opts.branch) {
    const current = run('git', ['branch', '--show-current'], { optional: true });
    if (current !== opts.branch) {
      run('git', ['switch', opts.branch]);
    }
  }
  const branch = requireCurrentBranch(opts.branch);
  const head = requireHead(opts.head);
  requireClaimGuard(opts);
  requirePrTruth({ ...opts, branch, head: opts.head || head });
  return { ok: true, branch, head };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.mode) {
    console.log('Usage: lane-switch-gate.mjs --safe-yield|--resume --issue N --pr N --branch BRANCH [--head SHA]');
    return;
  }
  const result = opts.mode === 'resume' ? verifyResume(opts) : verifySafeYield(opts);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(error.status || 1);
  }
}
