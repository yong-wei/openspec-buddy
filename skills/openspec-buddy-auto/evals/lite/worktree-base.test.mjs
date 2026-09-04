#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../scripts/lite/worktree-base.sh');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lite-worktree-base-'));
const remote = path.join(root, 'origin.git');
const seed = path.join(root, 'seed');
const work = path.join(root, 'work');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

execFileSync('git', ['init', '-q', '--bare', '-b', 'integration', remote]);
execFileSync('git', ['init', '-q', '-b', 'integration', seed]);
git(seed, ['config', 'user.email', 'codex@example.test']);
git(seed, ['config', 'user.name', 'Codex']);
fs.writeFileSync(path.join(seed, 'base-file'), 'a');
git(seed, ['add', 'base-file']);
git(seed, ['commit', '-qm', 'base']);
git(seed, ['remote', 'add', 'origin', remote]);
git(seed, ['push', '-q', 'origin', 'integration']);
execFileSync('git', ['clone', '-q', remote, work]);
git(work, ['config', '--local', 'extensions.worktreeConfig', 'true']);

function run(args) {
  return spawnSync('bash', [script, ...args], {
    cwd: work,
    env: {
      ...process.env,
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_ENV_FILE: path.join(root, 'missing-env-file'),
    },
    encoding: 'utf8',
  });
}

function advanceOrigin(message) {
  fs.appendFileSync(path.join(seed, 'base-file'), message);
  git(seed, ['commit', '-qam', message]);
  git(seed, ['push', '-q', 'origin', 'integration']);
  return git(seed, ['rev-parse', 'HEAD']);
}

const usage = run([]);
assert.notEqual(usage.status, 0);
assert.match(usage.stderr, /Usage: worktree-base\.sh/);

const legacy = run(['enter']);
assert.equal(legacy.status, 0, legacy.stderr);
assert.match(legacy.stderr, /No buddy\.boundBranch configured/);
assert.equal(legacy.stdout, '', 'the legacy hint must stay out of the JSON stdout stream');
assert.equal(git(work, ['branch', '--show-current']), 'integration',
  'enter without a bound branch must not switch branches');

{
  const invalidEnv = spawnSync('bash', [script, 'enter'], {
    cwd: work,
    env: {
      ...process.env,
      OPENSPEC_BUDDY_BASE_BRANCH: 'bad..branch',
      OPENSPEC_BUDDY_ENV_FILE: path.join(root, 'missing-env-file'),
    },
    encoding: 'utf8',
  });
  assert.notEqual(invalidEnv.status, 0);
  assert.match(invalidEnv.stderr, /Invalid OPENSPEC_BUDDY_BASE_BRANCH/);
}

git(work, ['config', '--worktree', 'buddy.boundBranch', 'bound-main']);
git(work, ['branch', 'bound-main', 'origin/integration']);
const behindHead = advanceOrigin('advance base');

{
  const result = run(['enter']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Switched to bound branch bound-main/);
  assert.match(result.stderr, /Aligned bound-main with origin\/integration/);
  assert.equal(result.stdout, '', 'enter must keep human-readable output out of stdout');
  assert.equal(git(work, ['branch', '--show-current']), 'bound-main');
  assert.equal(git(work, ['rev-parse', 'HEAD']), behindHead,
    'enter must fast-forward the bound branch to the bound base');
}

{
  git(work, ['switch', '-q', 'integration']);
  fs.writeFileSync(path.join(work, 'wip'), 'unfinished');
  const result = run(['enter']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /commit or stash/i);
  assert.equal(git(work, ['branch', '--show-current']), 'integration',
    'a dirty worktree must stop before switching branches');
  fs.rmSync(path.join(work, 'wip'));
}

{
  git(work, ['switch', '-q', 'bound-main']);
  fs.writeFileSync(path.join(work, 'bound-file'), 'local');
  git(work, ['add', 'bound-file']);
  git(work, ['commit', '-qm', 'local ahead']);
  const result = run(['enter']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ahead=1/);
  git(work, ['reset', '-q', '--hard', 'origin/integration']);
}

{
  git(work, ['switch', '-qc', 'issue-9-demo-thing']);
  const result = run(['leave', 'issue-9-demo-thing']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Switched from claim branch issue-9-demo-thing to bound-main/);
  assert.match(result.stderr, /Deleted local claim branch issue-9-demo-thing/);
  assert.match(result.stderr, /Aligned bound-main with origin\/integration/);
  assert.equal(git(work, ['branch', '--show-current']), 'bound-main');
  assert.equal(git(work, ['branch', '--list', 'issue-9-demo-thing']), '');

  const gone = run(['leave', 'issue-9-demo-thing']);
  assert.equal(gone.status, 0, gone.stderr);
  assert.doesNotMatch(gone.stderr, /Deleted local claim branch/,
    'leave must tolerate an already deleted claim branch');

  git(work, ['switch', '-qc', 'issue-10-other']);
  fs.writeFileSync(path.join(work, 'wip'), 'unfinished');
  const dirty = run(['leave', 'issue-10-other']);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /clean/i);
  assert.equal(git(work, ['branch', '--show-current']), 'issue-10-other');
  fs.rmSync(path.join(work, 'wip'));
  const clean = run(['leave', 'issue-10-other']);
  assert.equal(clean.status, 0, clean.stderr);
}

{
  git(work, ['switch', '-qc', 'issue-12-unpushed']);
  fs.writeFileSync(path.join(work, 'claim-file'), 'pushed');
  git(work, ['add', 'claim-file']);
  git(work, ['commit', '-qm', 'pushed claim work']);
  git(work, ['push', '-q', 'origin', 'issue-12-unpushed']);
  fs.appendFileSync(path.join(work, 'claim-file'), 'unpushed');
  git(work, ['commit', '-qam', 'unpushed claim work']);
  const refused = run(['leave', 'issue-12-unpushed']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /not present on origin\/issue-12-unpushed/i);
  assert.notEqual(git(work, ['branch', '--list', 'issue-12-unpushed']), '',
    'leave must keep a local claim branch with unpushed commits');
  git(work, ['push', '-q', 'origin', '--delete', 'issue-12-unpushed']);
  const squashMerged = run(['leave', 'issue-12-unpushed']);
  assert.equal(squashMerged.status, 0, squashMerged.stderr);
  assert.match(squashMerged.stderr, /no longer exists/i,
    'a deleted remote claim branch must warn and still allow deletion (squash-merge closeout)');
  assert.equal(git(work, ['branch', '--list', 'issue-12-unpushed']), '');
}

{
  git(work, ['config', '--worktree', '--unset', 'buddy.boundBranch']);
  git(work, ['switch', '-qc', 'issue-11-legacy']);
  const result = run(['leave', 'issue-11-legacy']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Switched from claim branch issue-11-legacy to integration/);
  assert.equal(git(work, ['branch', '--show-current']), 'integration',
    'leave without a bound branch must return to the configured base branch');
  assert.equal(git(work, ['branch', '--list', 'issue-11-legacy']), '');
  git(work, ['config', '--worktree', 'buddy.boundBranch', 'bound-main']);
}

{
  git(work, ['config', '--worktree', 'buddy.boundBranch', '-oops']);
  const invalidBound = run(['enter']);
  assert.notEqual(invalidBound.status, 0);
  assert.match(invalidBound.stderr, /Invalid buddy\.boundBranch/);
  git(work, ['config', '--worktree', 'buddy.boundBranch', 'bound-main']);
  git(work, ['config', '--worktree', 'buddy.boundBase', 'bad..base']);
  const invalidBase = run(['enter']);
  assert.notEqual(invalidBase.status, 0);
  assert.match(invalidBase.stderr, /Invalid buddy\.boundBase/);
  git(work, ['config', '--worktree', '--unset', 'buddy.boundBase']);
  const recovered = run(['enter']);
  assert.equal(recovered.status, 0, recovered.stderr);
}

const invalidChange = run(['leave', '../escape']);
assert.notEqual(invalidChange.status, 0);
assert.match(invalidChange.stderr, /Usage: worktree-base\.sh leave/);

console.log('lite worktree-base tests passed');
