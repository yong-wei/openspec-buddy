#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    mode: '',
    issue: '',
    pr: '',
    change: '',
    noIssue: false,
    noPr: false,
    runNext: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') opts.mode = argv[++i] || '';
    else if (arg === '--issue') opts.issue = argv[++i] || '';
    else if (arg === '--pr') opts.pr = argv[++i] || '';
    else if (arg === '--change') opts.change = argv[++i] || '';
    else if (arg === '--no-issue') opts.noIssue = true;
    else if (arg === '--no-pr') opts.noPr = true;
    else if (arg === '--run-next') opts.runNext = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (options.optional) return '';
    const stderr = result.stderr.trim();
    throw new Error(stderr || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(command) {
  return command.map(shellQuote).join(' ');
}

function repoState() {
  return {
    root: run('git', ['rev-parse', '--show-toplevel'], { optional: true }) || process.cwd(),
    branch: run('git', ['branch', '--show-current'], { optional: true }) || '(detached)',
    dirty: Boolean(run('git', ['status', '--porcelain'], { optional: true })),
  };
}

function inferMode(opts) {
  if (opts.mode) return opts.mode;
  if (opts.noIssue || opts.change) return 'propose';
  if (opts.pr) return 'achieve';
  if (opts.issue) return 'claim';
  return 'claim';
}

function describeNext(opts) {
  const mode = inferMode(opts);
  const commands = [];
  const notes = [];

  if (opts.noPr) {
    throw new Error('--no-pr is not a core Buddy option. It is valid only in openspec-buddy-auto for explicit local-only --change runs.');
  }

  if (mode === 'claim') {
    commands.push([path.join(scriptDir, 'check-config.sh')]);
    commands.push([path.join(scriptDir, 'claim-issue.sh'), ...(opts.issue ? [opts.issue] : [])]);
    notes.push('Claim uses the minimal lock and post-write GitHub truth verification before branch, Project, or Development-link mutations.');
  } else if (mode === 'propose') {
    commands.push([path.join(scriptDir, 'check-config.sh'), opts.noIssue ? 'local' : 'core']);
    if (opts.change) {
      commands.push([path.join(scriptDir, 'validate-issue-body.mjs'), `openspec/changes/${opts.change}/.buddy/issue.md`]);
    } else {
      notes.push('Pass --change <change_id> to get the exact issue-body validation command.');
    }
    notes.push('Create openspec/changes/<change_id>/.buddy/issue.md before any GitHub issue mutation.');
    notes.push('Run an independent proposal review before creating or updating the GitHub Issue.');
  } else if (mode === 'apply') {
    commands.push([path.join(scriptDir, 'sync-base-branch.sh')]);
    if (opts.issue) commands.push([path.join(scriptDir, 'claim-change.sh'), opts.issue]);
    commands.push([path.join(scriptDir, 'mark-in-progress.sh'), opts.issue || '<issue-number>']);
    notes.push('Do not edit implementation files until the claim/worktree guard passes and the issue is in progress.');
  } else if (mode === 'achieve') {
    commands.push([path.join(scriptDir, 'verify-review-clear.sh'), opts.pr || '<pr-number-or-url>']);
    commands.push([path.join(scriptDir, 'mark-achieved.sh'), opts.issue || '<issue-number>', '<archive-path>', opts.pr || '<pr-number-or-url>']);
    notes.push('Achieve only after PR merge truth, archived tasks, review clearance, and worktree claim ownership are verified.');
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  return { mode, commands, notes };
}

function printPlan(opts) {
  const state = repoState();
  const { mode, commands, notes } = describeNext(opts);
  console.log('OpenSpec Buddy Driver');
  console.log(`mode: ${mode}`);
  console.log(`repo: ${state.root}`);
  console.log(`branch: ${state.branch}`);
  console.log(`dirty: ${state.dirty ? 'yes' : 'no'}`);
  console.log('');
  console.log('NEXT LEGAL ACTION');
  commands.forEach((command, index) => {
    console.log(`${index + 1}. ${commandLine(command)}`);
  });
  if (notes.length) {
    console.log('');
    console.log('NOTES');
    notes.forEach((note) => console.log(`- ${note}`));
  }
  console.log('');
  console.log('Reference: skills/openspec-buddy/references/core-lifecycle.md');
}

function runNext(opts) {
  const { commands } = describeNext(opts);
  const command = commands[0];
  if (!command) throw new Error('No command available to run.');
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: buddy-driver.mjs [--mode claim|propose|apply|achieve] [--issue N] [--pr PR] [--change ID] [--no-issue] [--run-next]');
    return;
  }
  if (!fs.existsSync(scriptDir)) throw new Error(`Missing script directory: ${scriptDir}`);
  if (opts.runNext) runNext(opts);
  else printPlan(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
