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
if (args[0] === 'issue' && args[1] === 'comment') { state.comments.push({ body: args[args.indexOf('--body') + 1] }); save(); return; }
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

const claimed = run(['--issue', '17']);
assert.equal(claimed.status, 0, claimed.stderr);
assert.deepEqual(JSON.parse(claimed.stdout), {
  mode: 'lite', result: 'claimed', issue: 17, change_id: 'demo-change', branch: 'demo-change',
});

const current = run(['--issue', '17']);
assert.equal(current.status, 0, current.stderr);
assert.equal(JSON.parse(current.stdout).result, 'current_claim');

const archivedCurrentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
archivedCurrentState.issues.find((issue) => issue.number === 17).labels = [{ name: 'status:in-review' }];
fs.writeFileSync(stateFile, JSON.stringify(archivedCurrentState));
fs.mkdirSync(path.join(root, 'openspec/changes/archive/demo-change'), { recursive: true });
fs.rmSync(path.join(root, 'openspec/changes/demo-change'), { recursive: true });
const archivedCurrentExplicit = run(['--issue', '17']);
assert.equal(archivedCurrentExplicit.status, 0, archivedCurrentExplicit.stderr);
assert.equal(JSON.parse(archivedCurrentExplicit.stdout).result, 'current_claim');
const archivedCurrentUntargeted = run([]);
assert.equal(archivedCurrentUntargeted.status, 0, archivedCurrentUntargeted.stderr);
assert.equal(JSON.parse(archivedCurrentUntargeted.stdout).result, 'current_claim');

const localOnly = run(['--change', 'local-change', '--no-pr']);
assert.equal(localOnly.status, 0, localOnly.stderr);
assert.deepEqual(JSON.parse(localOnly.stdout), { mode: 'lite', result: 'local_only', change_id: 'local-change' });

const unknown = run(['--goal']);
assert.notEqual(unknown.status, 0);
assert.match(unknown.stderr, /unknown argument/i);

const exhaustedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
exhaustedState.issues = [];
fs.writeFileSync(stateFile, JSON.stringify(exhaustedState));
const exhausted = run([]);
assert.equal(exhausted.status, 0, exhausted.stderr);
assert.deepEqual(JSON.parse(exhausted.stdout), { mode: 'lite', result: 'exhausted' });

console.log('lite public entry tests passed');
