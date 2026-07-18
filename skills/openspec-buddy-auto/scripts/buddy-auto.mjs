#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const selector = path.join(scriptDir, 'lite/select-available-issue.mjs');
const claim = path.join(scriptDir, 'lite/claim-issue.mjs');
const fullController = path.join(scriptDir, 'full/buddy-auto.mjs');

function helpText() {
  return `OpenSpec Buddy Auto

Usage:
  buddy-auto.mjs                         无参数默认使用 lite
  buddy-auto.mjs --issue <number>        使用 lite 处理指定 Issue
  buddy-auto.mjs --change <change_id>    使用 lite 处理指定 change
  buddy-auto.mjs --change <change_id> --no-pr  仅用于 Local-only change
  buddy-auto.mjs full [full options]      进入 Full Mode

迁移：旧版无参数 full 调用改为 buddy-auto.mjs full。
`;
}

function finish(result) {
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}

function runFull(args) {
  finish(spawnSync(process.execPath, [fullController, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  }));
}

function parseLiteArgs(argv) {
  const selectorArgs = [];
  let noPr = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--issue' || arg === '--change') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      selectorArgs.push(arg, value);
      index += 1;
    } else if (arg === '--no-pr') {
      noPr = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (selectorArgs.includes('--issue') && selectorArgs.includes('--change')) {
    throw new Error('--issue and --change are mutually exclusive.');
  }
  if (noPr && !selectorArgs.includes('--change')) {
    throw new Error('--no-pr requires an explicit local-only --change target.');
  }
  return { selectorArgs, noPr };
}

function runLite(argv) {
  const { selectorArgs, noPr } = parseLiteArgs(argv);
  const selected = spawnSync(process.execPath, [selector, ...selectorArgs], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
  });
  if (selected.stderr) process.stderr.write(selected.stderr);
  if (selected.status !== 0 || selected.signal) {
    if (selected.stdout) process.stdout.write(selected.stdout);
    finish(selected);
  }

  const result = JSON.parse(selected.stdout);
  if (result.result === 'issue') {
    if (noPr) throw new Error('--no-pr is only valid for a local-only --change target.');
    const claimed = spawnSync(process.execPath, [claim, String(result.issue), result.change_id], {
      cwd: process.cwd(), env: process.env, stdio: 'inherit',
    });
    finish(claimed);
  }
  if (selected.stdout) process.stdout.write(selected.stdout);
}

try {
  const args = process.argv.slice(2);
  if (args[0] === '--help') process.stdout.write(helpText());
  else if (args[0] === 'full') runFull(args.slice(1));
  else runLite(args);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
