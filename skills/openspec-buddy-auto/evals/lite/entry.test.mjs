#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../../scripts/buddy-auto.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lite-entry-'));
const bin = path.join(root, 'bin');
const stateFile = path.join(root, 'state.json');
const callsFile = path.join(root, 'calls.log');
fs.mkdirSync(bin);
fs.mkdirSync(path.join(root, 'openspec/changes/demo-change'), { recursive: true });
fs.mkdirSync(path.join(root, 'openspec/changes/local-change'), { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: root });
execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: root });
execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', 'dev1'], { cwd: root });
fs.writeFileSync(stateFile, JSON.stringify({
  issues: [
    { number: 11, state: 'open', html_url: 'https://example.test/issues/11', body: '<!-- openspec-buddy change_id: other-change -->', labels: [{ name: 'status:ready' }], assignees: [] },
    { number: 17, state: 'open', html_url: 'https://example.test/issues/17', body: '<!-- openspec-buddy change_id: demo-change -->', labels: [{ name: 'status:ready' }], assignees: [] },
  ],
  comments: [], branch: false,
}));

function executable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

executable(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const stateFile = ${JSON.stringify(stateFile)};
const callsFile = ${JSON.stringify(callsFile)};
const args = process.argv.slice(2);
let state = JSON.parse(fs.readFileSync(stateFile));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
fs.appendFileSync(callsFile, args.join(' ') + '\\n');
if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ nameWithOwner: 'acme/repo' }));
if (args[0] === 'api' && args[1] === 'user') return console.log(JSON.stringify({ login: 'alice' }));
if (args[0] === 'api' && args[1] === 'rate_limit') return console.log(JSON.stringify({ remaining: 5000, reset: 0 }));
if (args[0] === 'api' && String(args[1]).includes('/issues?')) return console.log(JSON.stringify(state.issues));
if (args[0] === 'api' && args[1] === 'graphql') return console.log(JSON.stringify({ data: { repository: { candidate0: { number: 17, blockedBy: { nodes: [], pageInfo: { hasNextPage: false } } } } } }));
if (args[0] === 'api' && String(args[1]).includes('/comments?per_page=100')) {
  const number = Number(args[1].split('/').at(-2));
  return console.log(JSON.stringify(number === 17 ? state.comments : []));
}
if (args[0] === 'api' && args[1] === 'repos/acme/repo/issues/17') return console.log(JSON.stringify(state.issues.find((issue) => issue.number === 17)));
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/demo-change') {
  if (!state.branch) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/demo-change', object: { sha: '1111111111111111111111111111111111111111' } }));
}
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/integration') return console.log(JSON.stringify({ object: { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }));
if (args[0] === 'api' && String(args[1]).includes('/git/ref/heads/')) { console.error('HTTP 404: Not Found'); process.exit(1); }
if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST') { state.branch = true; save(); return console.log('{}'); }
if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--add-assignee')) {
  const issue = state.issues.find((item) => item.number === 17); issue.assignees = [{ login: args[args.indexOf('--add-assignee') + 1] }]; save(); return;
}
if (args[0] === 'issue' && args[1] === 'comment') { state.comments.push({ body: args[args.indexOf('--body') + 1], user: { login: 'alice' } }); save(); return; }
console.error('unexpected gh call: ' + args.join(' ')); process.exit(90);
`);
executable(path.join(bin, 'status-stub'), `#!/usr/bin/env node
const fs = require('node:fs'); const stateFile = ${JSON.stringify(stateFile)};
const state = JSON.parse(fs.readFileSync(stateFile));
state.issues.find((item) => item.number === Number(process.argv[2])).labels = [{ name: 'status:' + process.argv[3] }];
fs.writeFileSync(stateFile, JSON.stringify(state));
`);

function run(args) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_AGENT: 'codex/gpt-5.6-sol',
      OPENSPEC_BUDDY_LITE_STATUS_HELPER: path.join(bin, 'status-stub'),
    },
    encoding: 'utf8',
  });
}

const help = run(['--help']);
assert.equal(help.status, 0, help.stderr);
assert.equal(fs.existsSync(callsFile), false, '--help must not invoke selector or GitHub');
assert.match(help.stdout, /no arguments[^\n]*lite|无参数[^\n]*lite/i);
assert.match(help.stdout, /--issue <number>/);
assert.match(help.stdout, /--change <change_id>/);
assert.match(help.stdout, /--change <change_id> --no-pr[^\n]*local-only/i);
assert.match(help.stdout, /previous[^\n]*no-argument[^\n]*full[^\n]*buddy-auto\.mjs full|旧[^\n]*无参数[^\n]*full[^\n]*buddy-auto\.mjs full/i);

const conflicting = run(['--issue', '17', '--change', 'demo-change']);
assert.notEqual(conflicting.status, 0);
assert.match(conflicting.stderr, /mutually exclusive/i);

for (const args of [
  ['--issue', '17', '--issue', '17'],
  ['--change', 'demo-change', '--change', 'demo-change'],
]) {
  const duplicate = run(args);
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /only once|duplicate/i);
}

const missingIssueValue = run(['--issue', '--no-pr']);
assert.notEqual(missingIssueValue.status, 0);
assert.match(missingIssueValue.stderr, /--issue requires a value/i);

const missingChangeValue = run(['--change', '--no-pr']);
assert.notEqual(missingChangeValue.status, 0);
assert.match(missingChangeValue.stderr, /--change requires a value/i);

const invalidChangeValue = run(['--change', '..', '--no-pr']);
assert.notEqual(invalidChangeValue.status, 0);
assert.match(invalidChangeValue.stderr, /valid change id/i);

const issueNoPr = run(['--issue', '17', '--no-pr']);
assert.notEqual(issueNoPr.status, 0);
assert.match(issueNoPr.stderr, /--no-pr.*local-only/i);
assert.doesNotMatch(fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8') : '', /git\/refs|issue edit|issue comment/);

const untargetedNoPr = run(['--no-pr']);
assert.notEqual(untargetedNoPr.status, 0);
assert.match(untargetedNoPr.stderr, /--no-pr.*--change/i);

const mappedChangeNoPr = run(['--change', 'demo-change', '--no-pr']);
assert.notEqual(mappedChangeNoPr.status, 0);
assert.match(mappedChangeNoPr.stderr, /--no-pr.*local-only/i);

function lastJson(output) {
  return JSON.parse(output.trim().split('\n').filter(Boolean).at(-1));
}

const claimed = run(['--issue', '17']);
assert.equal(claimed.status, 0, claimed.stderr);
assert.deepEqual(lastJson(claimed.stdout), {
  mode: 'lite', result: 'claimed', issue: 17, change_id: 'demo-change', branch: 'demo-change',
});

const current = run(['--issue', '17']);
assert.equal(current.status, 0, current.stderr);
assert.equal(lastJson(current.stdout).result, 'current_claim');

const archivedCurrentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
archivedCurrentState.issues.find((issue) => issue.number === 17).labels = [{ name: 'status:in-review' }];
fs.writeFileSync(stateFile, JSON.stringify(archivedCurrentState));
fs.mkdirSync(path.join(root, 'openspec/changes/archive/2026-07-18-demo-change'), { recursive: true });
fs.rmSync(path.join(root, 'openspec/changes/demo-change'), { recursive: true });
const archivedCurrentExplicit = run(['--issue', '17']);
assert.equal(archivedCurrentExplicit.status, 0, archivedCurrentExplicit.stderr);
assert.equal(lastJson(archivedCurrentExplicit.stdout).result, 'current_claim');
const archivedCurrentUntargeted = run([]);
assert.equal(archivedCurrentUntargeted.status, 0, archivedCurrentUntargeted.stderr);
assert.equal(lastJson(archivedCurrentUntargeted.stdout).result, 'current_claim');

const localOnly = run(['--change', 'local-change', '--no-pr']);
assert.equal(localOnly.status, 0, localOnly.stderr);
assert.deepEqual(lastJson(localOnly.stdout), { mode: 'lite', result: 'local_only', change_id: 'local-change' });

const unknown = run(['--goal']);
assert.notEqual(unknown.status, 0);
assert.match(unknown.stderr, /unknown argument/i);

const exhaustedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
exhaustedState.issues = [];
fs.writeFileSync(stateFile, JSON.stringify(exhaustedState));
const exhausted = run([]);
assert.equal(exhausted.status, 0, exhausted.stderr);
assert.deepEqual(lastJson(exhausted.stdout), { mode: 'lite', result: 'exhausted' });

function makeGuardFixture(name, { issues, localChanges = [], dirty = false }) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-entry-${name}-`));
  const repoDir = path.join(fixtureRoot, 'repo');
  const guardBin = path.join(fixtureRoot, 'bin');
  const guardState = path.join(fixtureRoot, 'state.json');
  const guardCalls = path.join(fixtureRoot, 'calls.log');
  fs.mkdirSync(repoDir);
  fs.mkdirSync(guardBin);
  for (const changeId of localChanges) {
    fs.mkdirSync(path.join(repoDir, 'openspec/changes', changeId), { recursive: true });
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: repoDir });
  execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', 'guardwt'], { cwd: repoDir });
  execFileSync('git', ['config', '--worktree', 'buddy.boundBranch', 'main'], { cwd: repoDir });
  if (dirty) fs.writeFileSync(path.join(repoDir, 'wip-note'), 'unfinished');
  fs.writeFileSync(guardState, JSON.stringify({ issues, comments: [], branch: false }));
  fs.writeFileSync(guardCalls, '');
  executable(path.join(guardBin, 'git'), `#!/usr/bin/env node
const cp = require('node:child_process');
const fs = require('node:fs');
const guardCalls = ${JSON.stringify(guardCalls)};
const args = process.argv.slice(2);
fs.appendFileSync(guardCalls, 'git ' + args.join(' ') + '\\n');
if (args[0] === 'fetch') process.exit(0);
if (args[0] === 'merge') process.exit(0);
if (args[0] === 'rev-list' && args.includes('--left-right')) { console.log('0\\t0'); process.exit(0); }
process.exit(cp.spawnSync('/usr/bin/git', args, { stdio: 'inherit' }).status ?? 1);
`);
  executable(path.join(guardBin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const guardState = ${JSON.stringify(guardState)};
const guardCalls = ${JSON.stringify(guardCalls)};
const args = process.argv.slice(2);
let state = JSON.parse(fs.readFileSync(guardState));
const save = () => fs.writeFileSync(guardState, JSON.stringify(state));
fs.appendFileSync(guardCalls, 'gh ' + args.join(' ') + '\\n');
if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ nameWithOwner: 'acme/repo' }));
if (args[0] === 'api' && args[1] === 'user') return console.log(JSON.stringify({ login: 'alice' }));
if (args[0] === 'api' && args[1] === 'rate_limit') return console.log(JSON.stringify({ remaining: 5000, reset: 0 }));
if (args[0] === 'api' && String(args[1]).includes('/issues?')) return console.log(JSON.stringify(state.issues));
if (args[0] === 'api' && /\\/issues\\/\\d+$/.test(String(args[1]))) {
  const number = Number(args[1].split('/').at(-1));
  return console.log(JSON.stringify(state.issues.find((item) => item.number === number)));
}
if (args[0] === 'api' && String(args[1]).includes('/comments?per_page=100')) return console.log(JSON.stringify(state.comments));
if (args[0] === 'api' && args[1] === 'repos/acme/repo/git/ref/heads/integration') return console.log(JSON.stringify({ object: { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }));
if (args[0] === 'api' && String(args[1]).includes('/git/ref/heads/')) {
  if (!state.branch) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/' + decodeURIComponent(args[1].split('/heads/').at(-1)), object: { sha: '1111111111111111111111111111111111111111' } }));
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const query = (args.find((value) => value.startsWith('query=')) || '').slice('query='.length);
  const repository = {};
  for (const match of query.matchAll(/(candidate\\d+):issue\\(number:(\\d+)\\)/g)) {
    repository[match[1]] = { number: Number(match[2]), blockedBy: { nodes: [], pageInfo: { hasNextPage: false } } };
  }
  return console.log(JSON.stringify({ data: { repository } }));
}
if (args[0] === 'api' && args[1] === '--method' && args[2] === 'POST') { state.branch = true; save(); return console.log('{}'); }
if (args[0] === 'issue' && args[1] === 'edit' && args.includes('--add-assignee')) {
  state.issues[0].assignees = [{ login: args[args.indexOf('--add-assignee') + 1] }]; save(); return;
}
if (args[0] === 'issue' && args[1] === 'comment') { state.comments.push({ body: args[args.indexOf('--body') + 1], user: { login: 'alice' } }); save(); return; }
console.error('unexpected gh call: ' + args.join(' ')); process.exit(90);
`);
  executable(path.join(guardBin, 'status-stub'), `#!/usr/bin/env node
const fs = require('node:fs'); const guardState = ${JSON.stringify(guardState)};
const state = JSON.parse(fs.readFileSync(guardState));
state.issues.find((item) => item.number === Number(process.argv[2])).labels = [{ name: 'status:' + process.argv[3] }];
fs.writeFileSync(guardState, JSON.stringify(state));
`);
  const runGuard = (args) => spawnSync(process.execPath, [entry, ...args], {
    cwd: repoDir,
    env: {
      ...process.env,
      PATH: `${guardBin}:${process.env.PATH}`,
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_AGENT: 'codex/gpt-5.6-sol',
      OPENSPEC_BUDDY_ENV_FILE: '',
      OPENSPEC_BUDDY_LITE_STATUS_HELPER: path.join(guardBin, 'status-stub'),
    },
    encoding: 'utf8',
  });
  return { fixtureRoot, repoDir, guardCalls, runGuard };
}

{
  const guard = makeGuardFixture('enter-guard', {
    issues: [{ number: 21, title: 'Improve docs', state: 'open', html_url: 'https://example.test/issues/21', body: 'No mapping yet', labels: [{ name: 'status:ready' }], assignees: [] }],
  });
  const claimedDirect = guard.runGuard([]);
  assert.equal(claimedDirect.status, 0, claimedDirect.stderr);
  const lines = claimedDirect.stdout.trim().split('\n').filter(Boolean);
  assert.deepEqual(JSON.parse(lines.at(-2)), {
    mode: 'lite', result: 'claimed', issue: 21, change_id: 'issue-21-improve-docs',
    branch: 'issue-21-improve-docs', direct_claim: true,
  });
  const handoff = JSON.parse(lines.at(-1));
  assert.equal(handoff.result, 'direct_claim_handoff');
  assert.equal(handoff.change_id, 'issue-21-improve-docs');
  assert.ok(handoff.next_steps.some((step) => step.includes('<!-- openspec-buddy change_id: issue-21-improve-docs -->')));
  const guardLog = fs.readFileSync(guard.guardCalls, 'utf8');
  assert.ok(guardLog.indexOf('git fetch origin integration') > -1, 'entry must run worktree-base enter before a new claim');
  assert.ok(guardLog.indexOf('git fetch origin integration') < guardLog.indexOf('gh api --method POST'),
    'worktree-base enter must complete before claim writes');

  const resumed = guard.runGuard([]);
  assert.equal(resumed.status, 0, resumed.stderr);
  const resumedLines = resumed.stdout.trim().split('\n').filter(Boolean);
  assert.equal(JSON.parse(resumedLines.at(-2)).result, 'current_claim');
  assert.equal(JSON.parse(resumedLines.at(-1)).result, 'direct_claim_handoff',
    'a resumed direct claim still needs the mapping handoff guidance');
  const fetchCount = fs.readFileSync(guard.guardCalls, 'utf8').split('\n')
    .filter((line) => line.startsWith('git fetch')).length;
  assert.equal(fetchCount, 1, 'resuming a current claim must not rerun worktree-base enter');
}

{
  const guard = makeGuardFixture('enter-dirty', {
    issues: [{ number: 22, title: 'Mapped work', state: 'open', html_url: 'https://example.test/issues/22', body: '<!-- openspec-buddy change_id: mapped-change -->', labels: [{ name: 'status:ready' }], assignees: [] }],
    localChanges: ['mapped-change'],
    dirty: true,
  });
  const result = guard.runGuard(['--issue', '22']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /clean/i);
  assert.doesNotMatch(fs.readFileSync(guard.guardCalls, 'utf8'), /gh api --method POST/,
    'a dirty worktree must stop the entry before claim writes');
}

console.log('lite public entry tests passed');
