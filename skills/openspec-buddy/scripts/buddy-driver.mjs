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
    exploreQuestion: '',
    noIssue: false,
    noPr: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') opts.mode = argv[++i] || '';
    else if (arg === '--issue') opts.issue = argv[++i] || '';
    else if (arg === '--pr') opts.pr = argv[++i] || '';
    else if (arg === '--change') opts.change = argv[++i] || '';
    else if (arg === '--explore-question') opts.exploreQuestion = argv[++i] || '';
    else if (arg === '--no-issue') opts.noIssue = true;
    else if (arg === '--no-pr') opts.noPr = true;
    else if (arg === '--run-next') continue;
    else if (arg === '--dry-run') opts.dryRun = true;
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

function emitDone({ mode, commands, state, output = '' }) {
  outputBlock('DONE', [
    ['mode', mode],
    ['repo', state.root],
    ['branch', state.branch],
    ['dirty', state.dirty ? 'yes' : 'no'],
    ['commands', commands.map(commandLine).join(' && ')],
    ['next_action', 'Continue only with the driver-provided phase result; run the driver again after agent-owned work or external state changes.'],
  ]);
  if (output) {
    console.log('output_excerpt:');
    console.log(output);
  }
}

function emitBlocked({ mode, command = [], reason, output = '' }) {
  outputBlock('BLOCKED', [
    ['mode', mode],
    ['reason', reason],
    ['command', command.length ? commandLine(command) : ''],
  ]);
  if (output) {
    console.log('diagnostic:');
    console.log(output);
  }
}

function emitHandoff({ mode, commands, notes, fields = [] }) {
  outputBlock('HANDOFF', [
    ['mode', mode],
    ...fields,
    ['required_action', notes.join(' ')],
    ['commands', commands.map(commandLine).join(' && ')],
  ]);
}

const exploreRoutes = {
  intent: { optional: 'grilling', native: 'native-one-question-clarification' },
  facts: { optional: 'research', native: 'native-primary-source-investigation' },
  'interaction-state': { optional: 'prototype', native: 'native-throwaway-experiment' },
  'active-change-design': { optional: '', native: 'openspec-explore' },
};

function exploreRecommendation(question) {
  const route = exploreRoutes[question];
  if (!route) throw new Error(`Unsupported explore question: ${question}`);
  if (!route.optional) return { provider: 'buddy-native', method: route.native };
  try {
    const output = run(process.execPath, [path.join(scriptDir, 'detect-method-skills.mjs')], { optional: true });
    const detected = JSON.parse(output);
    if (detected[route.optional] === 'available') {
      return { provider: 'matt', method: route.optional };
    }
  } catch {
    // Optional method discovery must never prevent native exploration.
  }
  return { provider: 'buddy-native', method: route.native };
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
  return 'context-needed';
}

function describeNext(opts) {
  const mode = inferMode(opts);
  const commands = [];
  const notes = [];
  const fields = [];

  if (opts.noPr) {
    throw new Error('--no-pr is not a core Buddy option. It is valid only in openspec-buddy-auto for explicit local-only --change runs.');
  }

  if (mode === 'context-needed') {
    notes.push('No phase context was inferred. Do not claim or mutate GitHub state until the agent or caller provides a concrete phase context.');
  } else if (mode === 'explore') {
    if (!opts.exploreQuestion) {
      throw new Error('--explore-question is required for explore mode.');
    }
    const recommendation = exploreRecommendation(opts.exploreQuestion);
    fields.push(
      ['mutation_allowed', 'false'],
      ['coordination_state', 'none'],
      ['explore_question', opts.exploreQuestion],
      ['method_provider', recommendation.provider],
      ['recommended_method', recommendation.method],
      ['next_transition', 'propose | continue-explore'],
    );
    notes.push('Explore is read-only. Use the recommended method when relevant, or continue with the native exploration contract.');
  } else if (mode === 'claim') {
    commands.push([path.join(scriptDir, 'check-config.sh')]);
    commands.push([path.join(scriptDir, 'claim-issue.sh'), ...(opts.issue ? [opts.issue] : [])]);
    notes.push('Claim uses the minimal lock and post-write GitHub truth verification before branch, Project, or Development-link mutations.');
  } else if (mode === 'propose') {
    commands.push([path.join(scriptDir, 'check-config.sh'), 'local']);
    notes.push('Create and validate the local OpenSpec change, then commit and push it to the configured base branch.');
    if (opts.noIssue) {
      notes.push('Keep this change local-only. Do not create GitHub coordination state.');
    } else {
      notes.push('Create one open GitHub Issue containing exactly one openspec-buddy change_id marker and labels type:change plus status:ready.');
      notes.push('Record only real dependencies with native GitHub blockedBy relationships, then read the Issue and relationships back once.');
    }
    notes.push('Propose does not claim the Issue or start implementation.');
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

  return { mode, commands, notes, fields };
}

function printPlan(opts) {
  const { mode, commands, notes, fields } = describeNext(opts);
  emitHandoff({ mode, commands, notes, fields });
}

function runDriver(opts) {
  const state = repoState();
  const { mode, commands, notes, fields } = describeNext(opts);
  if (!commands.length) {
    emitHandoff({ mode, commands, notes, fields });
    return;
  }
  for (const command of commands) {
    const result = spawnSync(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (result.status !== 0) {
      const output = compactOutput(result);
      emitBlocked({
        mode,
        command,
        reason: `${command[0]} exited with status ${result.status ?? 1}`,
        output,
      });
      process.exit(result.status ?? 1);
    }
  }
  if (mode === 'propose') {
    emitHandoff({ mode, commands: [], notes, fields });
    return;
  }
  emitDone({ mode, commands, state });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: buddy-driver.mjs [--dry-run] [--mode claim|propose|explore|apply|achieve] [--explore-question intent|facts|interaction-state|active-change-design] [--issue N] [--pr PR] [--change ID] [--no-issue]');
    return;
  }
  if (!fs.existsSync(scriptDir)) throw new Error(`Missing script directory: ${scriptDir}`);
  if (opts.dryRun) printPlan(opts);
  else runDriver(opts);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
