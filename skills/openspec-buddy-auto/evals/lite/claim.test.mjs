#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(here, '../../scripts/lite/claim-issue.mjs');

function fixture(name, { failWrite = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-claim-${name}-`));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'codex@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked'), 'x');
  execFileSync('git', ['add', 'tracked'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: root });
  execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', 'dev1'], { cwd: root });
  const state = path.join(root, 'state.json');
  const log = path.join(root, 'calls.log');
  fs.writeFileSync(state, JSON.stringify({ labels: ['status:ready'], assignees: [], comments: [], branch: false, failWrite }));
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const statePath = ${JSON.stringify(state)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
if (args[0] !== 'push') process.exit(cp.spawnSync('/usr/bin/git', args, { stdio: 'inherit' }).status ?? 1);
fs.appendFileSync(log, 'git ' + args.join(' ') + '\\n');
const state = JSON.parse(fs.readFileSync(statePath));
if (state.failWrite === 'branch') process.exit(1);
state.branch = true;
fs.writeFileSync(statePath, JSON.stringify(state));
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const statePath = ${JSON.stringify(state)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
let state = JSON.parse(fs.readFileSync(statePath));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
fs.appendFileSync(log, 'gh ' + args.join(' ') + '\\n');
if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ nameWithOwner: 'acme/repo' }));
if (args[0] === 'api' && args[1] === 'user') return console.log(JSON.stringify({ login: 'alice' }));
if (args[0] === 'api' && args[1] === 'repos/acme/repo/issues/17') return console.log(JSON.stringify({ number: 17, state: 'open', labels: state.labels.map((name) => ({ name })), assignees: state.assignees.map((login) => ({ login })) }));
if (args[0] === 'api' && args[1].includes('/issues/17/comments')) return console.log(JSON.stringify(state.comments));
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/demo-change') {
  if (!state.branch) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/demo-change' }));
}
if (args[0] === 'issue' && args[1] === 'edit') {
  if (state.failWrite === 'assignee') process.exit(1);
  state.assignees = [args[args.indexOf('--add-assignee') + 1]]; save(); return;
}
if (args[0] === 'issue' && args[1] === 'comment') {
  if (state.failWrite === 'comment') process.exit(1);
  state.comments.push({ body: args[args.indexOf('--body') + 1] }); save(); return;
}
console.error('unexpected gh call: ' + args.join(' '));
process.exit(90);
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'status-stub'), `#!/usr/bin/env node
const fs = require('node:fs'); const statePath = ${JSON.stringify(state)}; const log = ${JSON.stringify(log)};
const state = JSON.parse(fs.readFileSync(statePath)); fs.appendFileSync(log, 'status ' + process.argv.slice(2).join(' ') + '\\n');
if (state.failWrite === 'status') process.exit(1);
state.labels = ['status:' + process.argv[3]]; fs.writeFileSync(statePath, JSON.stringify(state));
if (state.failWrite === 'status-after') process.exit(1);
`, { mode: 0o755 });
  return { root, bin, state, log };
}

function run(item) {
  return spawnSync(process.execPath, [helper, '17', 'demo-change'], {
    cwd: item.root,
    env: { ...process.env, PATH: `${item.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, OPENSPEC_BUDDY_LITE_STATUS_HELPER: path.join(item.bin, 'status-stub') },
    encoding: 'utf8',
  });
}

const item = fixture('success');
const claimed = run(item);
assert.equal(claimed.status, 0, claimed.stderr);
assert.equal(JSON.parse(claimed.stdout).result, 'claimed');
const calls = fs.readFileSync(item.log, 'utf8');
assert.ok(calls.indexOf('git push origin HEAD:refs/heads/demo-change') < calls.indexOf('issue edit'));
assert.ok(calls.indexOf('issue edit') < calls.indexOf('issue comment'));
assert.ok(calls.indexOf('issue comment') < calls.indexOf('status 17 claimed'));
const comment = JSON.parse(fs.readFileSync(item.state)).comments[0].body;
assert.match(comment, /issue: 17/);
assert.match(comment, /agent: codex\/alice/);
assert.match(comment, /worktree_alias: dev1/);
assert.match(comment, /head: [0-9a-f]{7,}/);
assert.doesNotMatch(comment, /claim_id|\/Users\//);

const rerun = run(item);
assert.equal(rerun.status, 0, rerun.stderr);
assert.equal(JSON.parse(rerun.stdout).result, 'current_claim');
assert.equal(fs.readFileSync(item.log, 'utf8').split('\n').filter((line) => /git push|issue edit|issue comment|^status /.test(line)).length, 4);

fs.writeFileSync(path.join(item.root, 'tracked'), 'changed');
execFileSync('/usr/bin/git', ['add', 'tracked'], { cwd: item.root });
execFileSync('/usr/bin/git', ['commit', '-qm', 'advance worktree'], { cwd: item.root });
const advanced = run(item);
assert.equal(advanced.status, 0, advanced.stderr);
assert.equal(JSON.parse(advanced.stdout).result, 'current_claim');

const failed = fixture('failed', { failWrite: 'comment' });
const failure = run(failed);
assert.notEqual(failure.status, 0);
const readsAfterFailure = fs.readFileSync(failed.log, 'utf8').split('\n').filter((line) => line === 'gh api repos/acme/repo/issues/17').length;
assert.equal(readsAfterFailure, 2, 'claim truth must be read once initially and exactly once after the failed write');
assert.equal(JSON.parse(fs.readFileSync(failed.state)).branch, true, 'failed claim must not delete its branch');

const recovered = fixture('recovered', { failWrite: 'status-after' });
const recoveredResult = run(recovered);
assert.equal(recoveredResult.status, 0, recoveredResult.stderr);
assert.equal(JSON.parse(recoveredResult.stdout).result, 'current_claim');

const foreign = fixture('foreign');
fs.writeFileSync(foreign.state, JSON.stringify({
  labels: ['status:claimed'],
  assignees: ['alice'],
  comments: [{ body: 'OpenSpec Buddy Claim\nissue: 17\nchange_id: demo-change\nbranch: demo-change\nagent: codex/bob\nworktree_alias: dev2\nhead: abc1234' }],
  branch: true,
  failWrite: '',
}));
const foreignResult = run(foreign);
assert.notEqual(foreignResult.status, 0);
assert.match(foreignResult.stderr, /foreign Claim truth/);

console.log('lite claim tests passed');
