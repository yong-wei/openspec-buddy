#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const selector = path.join(scriptDir, 'lite/select-available-issue.mjs');
const claim = path.join(scriptDir, 'lite/claim-issue.mjs');
const worktreeBase = path.join(scriptDir, 'lite/worktree-base.sh');
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
  let issueCount = 0;
  let changeCount = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--issue' || arg === '--change') {
      if (arg === '--issue') issueCount += 1;
      else changeCount += 1;
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
  if (issueCount > 1) throw new Error('--issue may be specified only once.');
  if (changeCount > 1) throw new Error('--change may be specified only once.');
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
    if (!result.current_claim) {
      const guard = spawnSync('bash', [worktreeBase, 'enter'], {
        cwd: process.cwd(), env: process.env, stdio: 'inherit',
      });
      if (guard.status !== 0 || guard.signal) finish(guard);
    }
    const claimed = spawnSync(process.execPath, [claim, String(result.issue), result.change_id], {
      cwd: process.cwd(), env: process.env, stdio: 'inherit',
    });
    if (claimed.status === 0 && result.direct_claim) {
      process.stdout.write(`${JSON.stringify({
        mode: 'lite',
        result: 'direct_claim_handoff',
        issue: result.issue,
        change_id: result.change_id,
        next_steps: [
          '保持该 claim 活跃：不删除远端 claim branch，不释放 assignee 或 status:claimed',
          '用 OpenSpec Explore 只读评估原 Issue 与仓库事实',
          `用 openspec-propose 以同一 change_id ${result.change_id} 创建并验证本地 change（openspec validate ${result.change_id} --strict），提交并推送提案到配置的 base 分支`,
          `向 Issue #${result.issue} body 写入恰好一个 <!-- openspec-buddy change_id: ${result.change_id} --> 标记并回读确认`,
          '重新运行本入口开始实施',
        ],
      })}\n`);
    }
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
