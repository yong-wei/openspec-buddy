#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(here, '../../scripts/lite/claim-issue.mjs');

function fixture(name, {
  failWrite = '', alias = 'dev1', issueBody = '<!-- openspec-buddy change_id: demo-change -->',
  issueState = 'open', localChange = true, branchResponse = '',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-claim-${name}-`));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'codex@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked'), 'x');
  execFileSync('git', ['add', 'tracked'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  if (localChange) fs.mkdirSync(path.join(root, 'openspec/changes/demo-change'), { recursive: true });
  execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: root });
  if (alias) execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', alias], { cwd: root });
  const state = path.join(root, 'state.json');
  const log = path.join(root, 'calls.log');
  fs.writeFileSync(state, JSON.stringify({ labels: ['status:ready'], assignees: [], comments: [], branch: false, branchResponse, failWrite, issueBody, issueState }));
  fs.writeFileSync(path.join(bin, 'git'), `#!/usr/bin/env node
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const statePath = ${JSON.stringify(state)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
if (args[0] === 'push') { fs.appendFileSync(log, 'git ' + args.join(' ') + '\\n'); process.exit(91); }
process.exit(cp.spawnSync('/usr/bin/git', args, { stdio: 'inherit' }).status ?? 1);
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
if (args[0] === 'api' && args[1] === 'repos/acme/repo/issues/17') return console.log(JSON.stringify({ id: 1700, node_id: 'I_17', number: 17, title: 'Demo', body: state.issueBody, state: state.issueState, html_url: 'https://example.test/issues/17', user: { login: 'author' }, labels: state.labels.map((name) => ({ id: name.length, name, color: 'ededed' })), assignees: state.assignees.map((login) => ({ id: login.length, login })) }));
if (args[0] === 'api' && args[1].includes('/issues/17/comments')) return console.log(JSON.stringify(state.comments.map((comment, index) => ({ id: index + 1, node_id: 'IC_' + (index + 1), html_url: 'https://example.test/comments/' + (index + 1), user: { login: 'commenter' }, ...comment }))));
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/demo-change') {
  if (state.branchResponse === 'prefix-array') return console.log(JSON.stringify([{ ref: 'refs/heads/demo-change-more', object: { sha: '2222222222222222222222222222222222222222' } }]));
  if (state.branchResponse === 'mismatching-object') return console.log(JSON.stringify({ ref: 'refs/heads/other-change', object: { sha: '3333333333333333333333333333333333333333' } }));
  if (state.branchResponse === 'error-500') { console.error('HTTP 500: Internal Server Error'); process.exit(1); }
  if (!state.branch) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/demo-change', node_id: 'REF_demo', url: 'https://api.example.test/ref/demo-change', object: { type: 'commit', sha: '1111111111111111111111111111111111111111', url: 'https://api.example.test/commits/1111' } }));
}
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/integration') {
  return console.log(JSON.stringify({ ref: 'refs/heads/integration', node_id: 'REF_base', url: 'https://api.example.test/ref/integration', object: { type: 'commit', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://api.example.test/commits/aaaa' } }));
}
if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST' && args[3] === 'repos/acme/repo/git/refs') {
  if (state.failWrite === 'branch-race') { state.branch = true; save(); console.error('HTTP 422: Reference already exists'); process.exit(1); }
  state.branch = true; state.branchResponse = ''; save();
  return console.log(JSON.stringify({ ref: 'refs/heads/demo-change', node_id: 'REF_demo', url: 'https://api.example.test/ref/demo-change', object: { type: 'commit', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', url: 'https://api.example.test/commits/aaaa' } }));
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
if (state.failWrite === 'final-mapping-change') { state.issueBody = '<!-- openspec-buddy change_id: other-change -->'; fs.writeFileSync(statePath, JSON.stringify(state)); }
if (state.failWrite === 'final-assignee-change') { state.assignees = []; fs.writeFileSync(statePath, JSON.stringify(state)); }
if (state.failWrite === 'status-after') process.exit(1);
`, { mode: 0o755 });
  return { root, bin, state, log };
}

function run(item, env = {}) {
  return spawnSync(process.execPath, [helper, '17', 'demo-change'], {
    cwd: item.root,
    env: {
      ...process.env,
      PATH: `${item.bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_ENV_FILE: '',
      OPENSPEC_BUDDY_LITE_STATUS_HELPER: path.join(item.bin, 'status-stub'),
      ...env,
    },
    encoding: 'utf8',
  });
}

const projectEnv = fixture('project-env');
fs.writeFileSync(path.join(projectEnv.root, '.env.openspec-buddy'), 'OPENSPEC_BUDDY_BASE_BRANCH=integration\n');
const projectEnvResult = run(projectEnv, { OPENSPEC_BUDDY_BASE_BRANCH: '' });
assert.equal(projectEnvResult.status, 0, projectEnvResult.stderr);
assert.equal(JSON.parse(projectEnvResult.stdout).result, 'claimed');

const missingConfig = fixture('missing-config');
const missingConfigResult = run(missingConfig, { OPENSPEC_BUDDY_BASE_BRANCH: '' });
assert.notEqual(missingConfigResult.status, 0);
assert.match(missingConfigResult.stderr, /Missing OpenSpec Buddy configuration.*OPENSPEC_BUDDY_BASE_BRANCH/s);
assert.doesNotMatch(fs.readFileSync(missingConfig.log, 'utf8'), /api --method POST/);

const item = fixture('success');
const claimed = run(item);
assert.equal(claimed.status, 0, claimed.stderr);
assert.equal(JSON.parse(claimed.stdout).result, 'claimed');
const calls = fs.readFileSync(item.log, 'utf8');
assert.ok(calls.indexOf('api --method POST repos/acme/repo/git/refs -f ref=refs/heads/demo-change -f sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') < calls.indexOf('issue edit'));
assert.doesNotMatch(calls, /git push/);
assert.ok(calls.indexOf('issue edit') < calls.indexOf('issue comment'));
assert.ok(calls.indexOf('issue comment') < calls.indexOf('status 17 claimed'));
const comment = JSON.parse(fs.readFileSync(item.state)).comments[0].body;
assert.match(comment, /issue: 17/);
assert.match(comment, /agent: codex\/alice/);
assert.match(comment, /worktree_alias: dev1/);
assert.doesNotMatch(comment, /head:|claim_id|\/Users\//);

const rerun = run(item);
assert.equal(rerun.status, 0, rerun.stderr);
assert.equal(JSON.parse(rerun.stdout).result, 'current_claim');
assert.equal(fs.readFileSync(item.log, 'utf8').split('\n').filter((line) => /api --method POST|issue edit|issue comment|^status /.test(line)).length, 4);

fs.mkdirSync(path.join(item.root, 'openspec/changes/archive'), { recursive: true });
fs.renameSync(
  path.join(item.root, 'openspec/changes/demo-change'),
  path.join(item.root, 'openspec/changes/archive/demo-change'),
);
const archivedCurrent = run(item);
assert.equal(archivedCurrent.status, 0, archivedCurrent.stderr);
assert.equal(JSON.parse(archivedCurrent.stdout).result, 'current_claim');
fs.rmSync(path.join(item.root, 'openspec/changes/archive/demo-change'), { recursive: true });
const missingCurrent = run(item);
assert.notEqual(missingCurrent.status, 0);
assert.match(missingCurrent.stderr, /does not exist in active or archive paths/i);
fs.mkdirSync(path.join(item.root, 'openspec/changes/demo-change'), { recursive: true });

for (const branchResponse of ['prefix-array', 'mismatching-object']) {
  const refShape = fixture(branchResponse, { branchResponse });
  const result = run(refShape);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, 'claimed');
}

const refApiError = fixture('ref-api-error', { branchResponse: 'error-500' });
const refApiErrorResult = run(refApiError);
assert.notEqual(refApiErrorResult.status, 0);
assert.match(refApiErrorResult.stderr, /Could not read claim branch demo-change.*500/i);
assert.doesNotMatch(fs.readFileSync(refApiError.log, 'utf8'), /api --method POST/,
  'a branch read API error must stop before Claim writes');

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

const raced = fixture('race', { failWrite: 'branch-race' });
const racedResult = run(raced);
assert.notEqual(racedResult.status, 0);
assert.match(racedResult.stderr, /complete Claim reread is partial/);
assert.match(racedResult.stderr, /"branch_exists":true/);
assert.match(racedResult.stderr, /"statuses":\["status:ready"\]/);
const racedCalls = fs.readFileSync(raced.log, 'utf8');
assert.doesNotMatch(racedCalls, /issue edit|issue comment|^status /m, 'losing atomic ref creation must not continue Claim writes');
assert.equal(racedCalls.split('\n').filter((line) => line === 'gh api repos/acme/repo/issues/17').length, 2);

const recovered = fixture('recovered', { failWrite: 'status-after' });
const recoveredResult = run(recovered);
assert.equal(recoveredResult.status, 0, recoveredResult.stderr);
assert.equal(JSON.parse(recoveredResult.stdout).result, 'current_claim');

const foreign = fixture('foreign');
fs.writeFileSync(foreign.state, JSON.stringify({
  ...JSON.parse(fs.readFileSync(foreign.state, 'utf8')),
  labels: ['status:claimed'],
  assignees: ['bob'],
  comments: [{ body: 'OpenSpec Buddy Claim\nissue: 17\nchange_id: demo-change\nbranch: demo-change\nagent: codex/bob\nworktree_alias: dev2' }],
  branch: true,
  failWrite: '',
}));
const foreignResult = run(foreign);
assert.notEqual(foreignResult.status, 0);
assert.match(foreignResult.stderr, /foreign Claim truth/);

const hashedWorktree = fixture('hashed-worktree', { alias: '' });
const hashedResult = run(hashedWorktree);
assert.equal(hashedResult.status, 0, hashedResult.stderr);
const hashedComment = JSON.parse(fs.readFileSync(hashedWorktree.state)).comments[0].body;
assert.match(hashedComment, /worktree_alias: worktree-[0-9a-f]{12}/);
assert.doesNotMatch(hashedComment, new RegExp(hashedWorktree.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const hashedRecovery = run(hashedWorktree);
assert.equal(hashedRecovery.status, 0, hashedRecovery.stderr);
assert.equal(JSON.parse(hashedRecovery.stdout).result, 'current_claim');

for (const invalid of [
  { name: 'changed-mapping-before-write', issueBody: '<!-- openspec-buddy change_id: other-change -->', pattern: /mapping.*demo-change|maps to.*other-change/i },
  { name: 'closed-before-write', issueState: 'closed', pattern: /open issue|issue.*open/i },
  { name: 'missing-local-before-write', localChange: false, pattern: /local change.*does not exist|missing local change/i },
]) {
  const invalidFixture = fixture(invalid.name, invalid);
  const invalidResult = run(invalidFixture);
  assert.notEqual(invalidResult.status, 0, invalid.name);
  assert.match(invalidResult.stderr, invalid.pattern);
  assert.doesNotMatch(fs.readFileSync(invalidFixture.log, 'utf8'), /api --method POST/, 'validation must stop before ref creation');
}

const changedAtFinalRead = fixture('changed-at-final-read', { failWrite: 'final-mapping-change' });
const changedAtFinalResult = run(changedAtFinalRead);
assert.notEqual(changedAtFinalResult.status, 0);
assert.match(changedAtFinalResult.stderr, /mapping.*demo-change|maps to.*other-change/i);

const partialAtFinalRead = fixture('partial-at-final-read', { failWrite: 'final-assignee-change' });
const partialAtFinalResult = run(partialAtFinalRead);
assert.notEqual(partialAtFinalResult.status, 0);
assert.match(partialAtFinalResult.stderr, /complete Claim truth is partial/);
assert.match(partialAtFinalResult.stderr, /"assignees":\[\]/);
assert.match(partialAtFinalResult.stderr, /"branch_exists":true/);

console.log('lite claim tests passed');
