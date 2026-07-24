#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildIdentity,
  branchExistsFromRefResult,
  classifyIssueClaim,
  parseChangeMapping,
  parseLiteClaimComment,
} from '../../scripts/lite/contracts.mjs';

const exactRef = 'refs/heads/demo-change';
assert.equal(branchExistsFromRefResult({
  status: 0,
  stdout: JSON.stringify({ ref: exactRef, object: { sha: '1'.repeat(40) } }),
  stderr: '',
}, 'demo-change'), true);
assert.equal(branchExistsFromRefResult({
  status: 0,
  stdout: JSON.stringify([
    { ref: 'refs/heads/demo-change-more', object: { sha: '2'.repeat(40) } },
  ]),
  stderr: '',
}, 'demo-change'), false, 'a prefix-match array is not the requested exact branch');
assert.equal(branchExistsFromRefResult({
  status: 0,
  stdout: JSON.stringify({ ref: 'refs/heads/other-change', object: { sha: '3'.repeat(40) } }),
  stderr: '',
}, 'demo-change'), false, 'a mismatching ref object is not the requested exact branch');
assert.equal(branchExistsFromRefResult({
  status: 1,
  stdout: '',
  stderr: 'gh: Not Found (HTTP 404)',
}, 'demo-change'), false);
assert.throws(() => branchExistsFromRefResult({
  status: 1,
  stdout: '',
  stderr: 'gh: Internal Server Error (HTTP 500)',
}, 'demo-change'), /Could not read claim branch demo-change.*500/i);

const here = path.dirname(fileURLToPath(import.meta.url));
const selector = path.resolve(here, '../../scripts/lite/select-available-issue.mjs');

const hashedIdentity = buildIdentity('codex', '', '/tmp/real-worktree');
assert.deepEqual(hashedIdentity, {
  agent: 'codex/codex',
  viewer: 'codex',
  worktree: `worktree-${createHash('sha256').update('/tmp/real-worktree').digest('hex').slice(0, 12)}`,
});

assert.equal(parseChangeMapping('<!-- openspec-buddy change_id: marker-change -->').changeId, 'marker-change');
assert.equal(parseChangeMapping('<!-- openspec-buddy\nchange_id: hidden-change\n-->').changeId, 'hidden-change');
assert.equal(parseChangeMapping('<!-- openspec-buddy\nchange_id: hidden-change\nseries: alpha\nrisk: low\n-->').changeId, 'hidden-change');
assert.equal(parseChangeMapping('---\nchange_id: front-change\n---\nBody').changeId, 'front-change');
for (const body of [
  '<!-- openspec-buddy change_id: ../marker -->',
  '<!-- openspec-buddy change_id: bad value -->',
  '<!-- openspec-buddy\nchange_id: Hidden_Change\n-->',
  '---\nchange_id: ../front\n---\nBody',
  '---\nchange_id: valid-change\n---\n<!-- openspec-buddy change_id: bad value -->',
  '---\nchange_id:\n---\n<!-- openspec-buddy change_id: valid-change -->',
  '<!-- openspec-buddy\nchange_id: valid-change\nchange_id: bad value\n-->',
  '<!-- openspec-buddy\nchange_id:\nchange_id: valid-change\n-->',
  '---\nchange_id: valid-change\nchange_id: bad value\n---\nBody',
  '---\nchange_id:\nchange_id: valid-change\n---\nBody',
]) {
  const mapping = parseChangeMapping(body);
  assert.equal(mapping.changeId, null);
  assert.equal(mapping.invalid, true);
}
assert.equal(
  parseChangeMapping('---\nchange_id: one\n---\n<!-- openspec-buddy change_id: two -->').conflict,
  true,
);
assert.equal(
  parseChangeMapping('<!-- openspec-buddy change_id: one -->\n<!-- openspec-buddy change_id: two -->').conflict,
  true,
);
assert.equal(
  parseChangeMapping('<!-- openspec-buddy\nchange_id: one\n-->\n<!-- openspec-buddy\nchange_id: two\n-->').conflict,
  true,
);
for (const body of [
  '<!-- openspec-buddy change_id: same -->\n<!-- openspec-buddy change_id: same -->',
  '<!-- openspec-buddy\nchange_id: same\nchange_id: same\n-->',
  '---\nchange_id: same\nchange_id: same\n---\nBody',
]) {
  const mapping = parseChangeMapping(body);
  assert.equal(mapping.changeId, null);
  assert.equal(mapping.duplicate, true);
}

const claim = parseLiteClaimComment(`OpenSpec Buddy Claim

issue: 1
agent: @codex
change_id: demo-change
branch: demo-change
worktree_alias: dev1`);
assert.equal(claim.issue, 1);
assert.equal(claim.viewer, 'codex');
assert.equal(claim.worktree, 'dev1');
assert.equal(
  classifyIssueClaim({ labels: [{ name: 'status:claimed' }], assignees: [] }, [], buildIdentity('codex', 'dev1')),
  'partial',
);
assert.equal(
  classifyIssueClaim(
    { state: 'open', labels: [{ name: 'status:claimed' }], assignees: [{ login: 'codex' }] },
    [{ body: `OpenSpec Buddy Claim\nissue: 1\nstate: active\nagent: @codex\nchange_id: demo\nbranch: demo\nworktree_alias: dev1` }],
    buildIdentity('codex', 'dev1'),
    { branchExists: true, issue: 1, changeId: 'demo', branch: 'demo' },
  ),
  'current',
);
assert.equal(
  classifyIssueClaim(
    { state: 'open', labels: [{ name: 'status:claimed' }], assignees: [{ login: 'codex' }] },
    [
      { body: 'OpenSpec Buddy Claim\nissue: 1\nagent: @other\nchange_id: demo\nbranch: demo\nworktree_alias: old' },
      { body: 'OpenSpec Buddy Claim\nissue: 1\nagent: @codex\nchange_id: demo\nbranch: demo\nworktree_alias: dev1' },
    ],
    buildIdentity('codex', 'dev1'),
    { branchExists: true, issue: 1, changeId: 'demo', branch: 'demo' },
  ),
  'current',
);

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function issue(number, changeId, { state = 'open', status = 'status:ready', body, assignees = [], pullRequest = false } = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state,
    html_url: `https://example.test/issues/${number}`,
    body: body ?? `<!-- openspec-buddy change_id: ${changeId} -->`,
    labels: [{ name: status }],
    assignees: assignees.map((login) => ({ login })),
    ...(pullRequest ? { pull_request: { url: `https://example.test/pulls/${number}` } } : {}),
  };
}

function makeFixture(name, {
  issues, comments = {}, blockedBy = {}, branches = [], refResponses = {}, alias = 'dev1',
  graphqlError = false, partialGraphql = false, incompleteBlockedBy = [], oversizedBlockedBy = [],
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-${name}-`));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'issues.json'), JSON.stringify(issues));
  fs.writeFileSync(path.join(root, 'comments.json'), JSON.stringify(comments));
  fs.writeFileSync(path.join(root, 'blocked.json'), JSON.stringify(blockedBy));
  fs.writeFileSync(path.join(root, 'branches.json'), JSON.stringify(branches));
  fs.writeFileSync(path.join(root, 'ref-responses.json'), JSON.stringify(refResponses));
  fs.writeFileSync(path.join(root, 'graphql-options.json'), JSON.stringify({ graphqlError, partialGraphql, incompleteBlockedBy, oversizedBlockedBy }));
  fs.writeFileSync(path.join(root, 'calls.log'), '');
  writeExecutable(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.log'), JSON.stringify(args) + '\\n');
const issues = JSON.parse(fs.readFileSync(path.join(root, 'issues.json')));
if (args[0] === 'api' && args[1] === 'user') return console.log(JSON.stringify({ login: 'codex' }));
if (args[0] === 'api' && args[1] === 'rate_limit') return console.log(JSON.stringify({ remaining: 5000, reset: 0 }));
if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ nameWithOwner: 'acme/repo' }));
if (args[0] === 'api' && String(args[1]).includes('/issues?')) {
  const url = new URL('https://api.github.test/' + args[1]);
  const state = url.searchParams.get('state');
  const label = url.searchParams.get('labels');
  const perPage = Number(url.searchParams.get('per_page') || 30);
  const page = Number(url.searchParams.get('page') || 1);
  const filtered = issues
    .filter((item) => !state || state === 'all' || String(item.state).toLowerCase() === state)
    .filter((item) => !label || item.labels.some((entry) => entry.name === label))
    .sort((left, right) => Number(left.number) - Number(right.number));
  return console.log(JSON.stringify(filtered.slice((page - 1) * perPage, page * perPage)));
}
if (args[0] === 'api' && /\\/issues\\/\\d+$/.test(String(args[1]))) {
  const number = Number(args[1].split('/').at(-1));
  const found = issues.find((item) => Number(item.number) === number);
  if (!found) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify(found));
}
if (args[0] === 'api' && String(args[1]).endsWith('/comments?per_page=100')) {
  const number = args[1].split('/').at(-2);
  const comments = JSON.parse(fs.readFileSync(path.join(root, 'comments.json')));
  return console.log(JSON.stringify(comments[number] || []));
}
if (args[0] === 'api' && String(args[1]).includes('/git/ref/heads/')) {
  const branch = decodeURIComponent(args[1].split('/heads/').at(-1));
  const refResponses = JSON.parse(fs.readFileSync(path.join(root, 'ref-responses.json')));
  if (Object.hasOwn(refResponses, branch)) {
    const response = refResponses[branch];
    if (response.status) { console.error(response.stderr || ('HTTP ' + response.status)); process.exit(1); }
    return console.log(JSON.stringify(response.body));
  }
  const branches = JSON.parse(fs.readFileSync(path.join(root, 'branches.json')));
  if (!branches.includes(branch)) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/' + branch, object: { sha: '1111111111111111111111111111111111111111' } }));
}

if (args[0] === 'api' && args[1] === 'graphql') {
  const options = JSON.parse(fs.readFileSync(path.join(root, 'graphql-options.json')));
  if (options.graphqlError) { console.error('HTTP 500: GraphQL failed'); process.exit(1); }
  const queryArg = args.find((value) => value.startsWith('query=')) || '';
  const query = queryArg.slice('query='.length);
  const blocked = JSON.parse(fs.readFileSync(path.join(root, 'blocked.json')));
  const repository = {};
  for (const match of query.matchAll(/(candidate\\d+):issue\\(number:(\\d+)\\)/g)) {
    const [, alias, number] = match;
    if (options.incompleteBlockedBy.map(String).includes(number)) {
      repository[alias] = { number: Number(number), blockedBy: { nodes: blocked[number] || [] } };
    } else {
      repository[alias] = { number: Number(number), blockedBy: {
        nodes: blocked[number] || [],
        pageInfo: { hasNextPage: options.oversizedBlockedBy.map(String).includes(number) },
      } };
    }
  }
  return console.log(JSON.stringify({ data: { repository }, ...(options.partialGraphql ? { errors: [{ message: 'partial result' }] } : {}) }));
}
console.error('unexpected gh call: ' + args.join(' '));
process.exit(90);
`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: root });
  if (alias) execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', alias], { cwd: root });
  return { root, bin };
}

function addChange(root, changeId) {
  fs.mkdirSync(path.join(root, 'openspec', 'changes', changeId), { recursive: true });
}

function runSelector(fixture, args = [], cwd = fixture.root) {
  return spawnSync(process.execPath, [selector, ...args], {
    cwd,
    env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

function graphqlCalls(fixture) {
  return fs.readFileSync(path.join(fixture.root, 'calls.log'), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter((args) => args[0] === 'api' && args[1] === 'graphql');
}

function issueReadCalls(fixture) {
  return fs.readFileSync(path.join(fixture.root, 'calls.log'), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse)
    .filter((args) => args[0] === 'api' && String(args[1]).includes('/issues'));
}

for (const [name, body] of [
  ['prefix-array', [{ ref: 'refs/heads/claimed-more', object: { sha: '1'.repeat(40) } }]],
  ['mismatching-object', { ref: 'refs/heads/other', object: { sha: '2'.repeat(40) } }],
]) {
  const current = 'OpenSpec Buddy Claim\nissue: 5\nstate: active\nagent: @codex\nchange_id: claimed\nbranch: claimed\nworktree_alias: dev1';
  const fixture = makeFixture(`ref-${name}`, {
    issues: [issue(5, 'claimed', { status: 'status:claimed', assignees: ['codex'] })],
    comments: { 5: [{ body: current }] },
    refResponses: { claimed: { body } },
  });
  addChange(fixture.root, 'claimed');
  const result = runSelector(fixture, ['--issue', '5']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial claim state/i);
  assert.match(result.stderr, /"branch_exists":false/);
}

{
  const fixture = makeFixture('ref-api-error', {
    issues: [issue(5, 'claimed')],
    refResponses: { claimed: { status: 500, stderr: 'HTTP 500: Internal Server Error' } },
  });
  addChange(fixture.root, 'claimed');
  const result = runSelector(fixture, ['--issue', '5']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not read claim branch claimed.*500/i);
}

{
  const fixture = makeFixture('smallest', {
    issues: [issue(22, 'later'), issue(11, 'earlier')],
  });
  addChange(fixture.root, 'later');
  addChange(fixture.root, 'earlier');
  const subdirectory = path.join(fixture.root, 'nested');
  fs.mkdirSync(subdirectory);
  const result = runSelector(fixture, [], subdirectory);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'lite', result: 'issue', issue: 11, change_id: 'earlier', url: 'https://example.test/issues/11',
  });
  const calls = graphqlCalls(fixture);
  assert.equal(calls.length, 1, 'all ready candidates must share one blockedBy query');
  assert.match(calls[0].find((value) => value.startsWith('query=')), /issue\(number:11\).*issue\(number:22\)/);
  const reads = issueReadCalls(fixture).filter((args) => String(args[1]).includes('/issues?'));
  assert.equal(reads.length, 4, 'untargeted selection must issue one bounded query per active Buddy status');
  for (const args of reads) {
    assert.match(args[1], /state=open/);
    assert.match(args[1], /per_page=50/);
    assert.doesNotMatch(args.join(' '), /--paginate/);
  }
}

{
  const fixture = makeFixture('target-issue', { issues: [issue(11, 'earlier'), issue(22, 'later')] });
  addChange(fixture.root, 'earlier');
  addChange(fixture.root, 'later');
  const result = runSelector(fixture, ['--issue', '22']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 22);
  const reads = issueReadCalls(fixture);
  assert.ok(reads.some((args) => String(args[1]).endsWith('/issues/22')));
  assert.ok(reads.filter((args) => String(args[1]).includes('/issues?'))
    .every((args) => /per_page=50/.test(args[1]) && !args.includes('--paginate')));
}

{
  const fixture = makeFixture('candidate-limit', {
    issues: Array.from({ length: 51 }, (_, index) => issue(index + 1, `change-${index + 1}`)),
  });
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /more than 50 open Buddy issues/i);
  assert.ok(issueReadCalls(fixture).every((args) => !args.includes('--paginate')));
}

{
  const pullRequests = Array.from(
    { length: 50 },
    (_, index) => issue(index + 2, `pull-${index + 2}`, { pullRequest: true }),
  );
  const fixture = makeFixture('pull-request-noise', {
    issues: [issue(1, 'available'), ...pullRequests],
  });
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 1);
  const readyReads = issueReadCalls(fixture)
    .filter((args) => String(args[1]).includes('labels=status%3Aready'));
  assert.equal(readyReads.length, 2, 'PR-only overflow must not count against the Issue candidate limit');
}

{
  const fixture = makeFixture('invalid-usage', { issues: [] });
  const result = runSelector(fixture, ['--unknown', 'value']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/i);
}

for (const invalidChange of ['..', '../demo', 'Demo', 'demo_change', '-demo', 'demo-']) {
  const fixture = makeFixture(`invalid-change-${invalidChange.replaceAll('/', '-')}`, { issues: [] });
  const result = runSelector(fixture, ['--change', invalidChange]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid change id/i);
  assert.equal(fs.readFileSync(path.join(fixture.root, 'calls.log'), 'utf8'), '', 'invalid change must stop before GitHub reads');
}

{
  const fixture = makeFixture('local-only', { issues: [] });
  addChange(fixture.root, 'local-change');
  const subdirectory = path.join(fixture.root, 'nested');
  fs.mkdirSync(subdirectory);
  const result = runSelector(fixture, ['--change', 'local-change'], subdirectory);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'lite', result: 'local_only', change_id: 'local-change',
  });
}

{
  const filler = Array.from({ length: 50 }, (_, index) => issue(index + 1, '', { body: 'No mapping' }));
  const fixture = makeFixture('target-change-bounded-pages', {
    issues: [...filler, issue(51, 'paged-change')],
  });
  addChange(fixture.root, 'paged-change');
  const result = runSelector(fixture, ['--change', 'paged-change']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 51);
  const reads = issueReadCalls(fixture).filter((args) => String(args[1]).includes('/issues?'));
  assert.equal(reads.length, 2);
  assert.ok(reads.every((args) => /per_page=50/.test(args[1]) && !args.includes('--paginate')));
}

{
  const fixture = makeFixture('open-blocker', {
    issues: [issue(11, 'blocked')],
    blockedBy: { 11: [{ number: 7, state: 'OPEN' }, { number: 6, state: 'CLOSED' }] },
  });
  addChange(fixture.root, 'blocked');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked by open issue #7/i);
  assert.equal(result.stdout, '');
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 11\nstate: active\nagent: @codex\nchange_id: blocked-current\nbranch: blocked-current\nworktree_alias: dev1';
  const fixture = makeFixture('blocked-current', {
    issues: [issue(11, 'blocked-current', { status: 'status:claimed', assignees: ['codex'] })],
    comments: { 11: [{ body: current }] },
    branches: ['blocked-current'],
    blockedBy: { 11: [{ number: 7, state: 'OPEN' }] },
  });
  addChange(fixture.root, 'blocked-current');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked by open issue #7/i);
  assert.equal(graphqlCalls(fixture).length, 1);
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 11\nstate: active\nagent: @codex\nchange_id: closed-blocker-current\nbranch: closed-blocker-current\nworktree_alias: dev1';
  const fixture = makeFixture('closed-blocker-current', {
    issues: [issue(11, 'closed-blocker-current', { status: 'status:claimed', assignees: ['codex'] })],
    comments: { 11: [{ body: current }] },
    branches: ['closed-blocker-current'],
    blockedBy: { 11: [{ number: 7, state: 'CLOSED' }] },
  });
  addChange(fixture.root, 'closed-blocker-current');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 11);
  assert.equal(graphqlCalls(fixture).length, 1);
}

for (const [name, body] of [
  ['invalid-hidden-mapping', '<!-- openspec-buddy\nchange_id: ../demo\n-->'],
  ['invalid-front-mapping', '---\nchange_id: Demo_Change\n---\nBody'],
]) {
  const fixture = makeFixture(name, { issues: [issue(11, '', { body })] });
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid change mapping/i);
}

{
  const fixture = makeFixture('malformed-first', {
    issues: [issue(10, '', { body: 'No mapping' }), issue(20, 'valid')],
  });
  addChange(fixture.root, 'valid');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ready issue #10.*mapping/i);
  assert.equal(result.stdout, '');
}

{
  const fixture = makeFixture('closed-mapping', {
    issues: [issue(9, 'old', { state: 'closed' })],
  });
  addChange(fixture.root, 'old');
  const result = runSelector(fixture, ['--change', 'old']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only closed issue/i);
}

{
  const fixture = makeFixture('conflicting-target-mapping', {
    issues: [issue(9, 'one', { body: '---\nchange_id: one\n---\n<!-- openspec-buddy change_id: two -->' })],
  });
  addChange(fixture.root, 'one');
  const result = runSelector(fixture, ['--change', 'one']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicting.*mapping/i);
}

{
  const fixture = makeFixture('ignore-pull-request', {
    issues: [issue(3, 'pull-change', { pullRequest: true }), issue(7, 'issue-change')],
  });
  addChange(fixture.root, 'pull-change');
  addChange(fixture.root, 'issue-change');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 7);
}

{
  const fixture = makeFixture('exhausted', { issues: [] });
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: 'lite', result: 'exhausted' });
}

{
  const fixture = makeFixture('paginated-foreign-claim', {
    issues: [issue(11, 'claimed', { status: 'status:claimed', assignees: ['other'] })],
    comments: {
      11: [[{ body: 'OpenSpec Buddy Claim\nissue: 11\nstate: active\nagent: @other\nchange_id: claimed\nbranch: claimed\nworktree_alias: dev2' }]],
    },
    branches: ['claimed'],
  });
  addChange(fixture.root, 'claimed');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /foreign claim state/i);
}

{
  const fixture = makeFixture('incomplete-blocked-by', {
    issues: [issue(11, 'unsafe-page')],
    blockedBy: { 11: [{ number: 6, state: 'CLOSED' }] },
    incompleteBlockedBy: [11],
  });
  addChange(fixture.root, 'unsafe-page');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete blockedBy data/i);
}

{
  const fixture = makeFixture('blocked-by-query-error', {
    issues: [issue(11, 'query-error')],
    graphqlError: true,
  });
  addChange(fixture.root, 'query-error');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GraphQL failed|HTTP 500/i);
}

{
  const fixture = makeFixture('blocked-by-partial-result', {
    issues: [issue(11, 'partial-result')],
    partialGraphql: true,
  });
  addChange(fixture.root, 'partial-result');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete blockedBy data/i);
}

{
  const fixture = makeFixture('blocked-by-invalid-node', {
    issues: [issue(11, 'invalid-node')],
    blockedBy: { 11: [{ number: 7 }] },
  });
  addChange(fixture.root, 'invalid-node');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete blockedBy data/i);
}

{
  const fixture = makeFixture('too-many-blockers', {
    issues: [issue(11, 'too-many')],
    oversizedBlockedBy: [11],
  });
  addChange(fixture.root, 'too-many');
  const result = runSelector(fixture, ['--change', 'too-many']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /more than 100 blockers|batch is incomplete/i);
  assert.equal(graphqlCalls(fixture).length, 1);
}

{
  const fixture = makeFixture('open-closed-duplicate', {
    issues: [issue(11, 'duplicate'), issue(12, 'duplicate', { state: 'closed' })],
  });
  addChange(fixture.root, 'duplicate');
  const result = runSelector(fixture, ['--change', 'duplicate']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate.*mapping/i);
}

{
  const fixture = makeFixture('target-issue-duplicate', {
    issues: [issue(11, 'duplicate-target'), issue(12, 'duplicate-target', { state: 'closed' })],
  });
  addChange(fixture.root, 'duplicate-target');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate issue mappings/i);
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 4\nstate: active\nagent: @codex\nchange_id: current\nbranch: current\nworktree_alias: dev1';
  const foreign = 'OpenSpec Buddy Claim\nissue: 5\nstate: active\nagent: @other\nchange_id: foreign\nbranch: foreign\nworktree_alias: dev2';
  const fixture = makeFixture('skip-foreign-default', {
    issues: [issue(4, 'current', { status: 'status:claimed', assignees: ['codex'] }), issue(5, 'foreign', { status: 'status:claimed', assignees: ['other'] }), issue(10, 'available')],
    comments: { 4: [{ body: current }], 5: [{ body: foreign }] },
    branches: ['current', 'foreign'],
  });
  addChange(fixture.root, 'current');
  addChange(fixture.root, 'foreign');
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 4, 'untargeted auto must resume its complete current Claim');
  const explicit = runSelector(fixture, ['--issue', '5']);
  assert.notEqual(explicit.status, 0);
  assert.match(explicit.stderr, /foreign claim state/i);
  const explicitCurrent = runSelector(fixture, ['--issue', '4']);
  assert.equal(explicitCurrent.status, 0, explicitCurrent.stderr);
  assert.equal(JSON.parse(explicitCurrent.stdout).issue, 4);
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 20\nstate: active\nagent: @codex\nchange_id: archived-current\nbranch: archived-current\nworktree_alias: dev1';
  const fixture = makeFixture('archived-current-missing-local-change', {
    issues: [
      issue(10, 'missing-ready'),
      issue(20, 'archived-current', { status: 'status:in-review', assignees: ['codex'] }),
    ],
    comments: { 20: [{ body: current }] },
    branches: ['archived-current'],
  });
  const missing = runSelector(fixture, ['--issue', '20']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /active or dated archive paths/i);
  fs.mkdirSync(path.join(fixture.root, 'openspec', 'changes', 'archive', '2026-07-18-archived-current'), { recursive: true });
  const untargeted = runSelector(fixture);
  assert.equal(untargeted.status, 0, untargeted.stderr);
  assert.equal(JSON.parse(untargeted.stdout).issue, 20,
    'an archived current Claim must win over a smaller ready Issue with no active change directory');
  const explicit = runSelector(fixture, ['--issue', '20']);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(JSON.parse(explicit.stdout).issue, 20);
}

{
  const fixture = makeFixture('ready-missing-local-change', {
    issues: [issue(10, 'missing-ready')],
  });
  const result = runSelector(fixture, ['--issue', '10']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing local change/i);
}

{
  const foreign = 'OpenSpec Buddy Claim\nissue: 5\nstate: active\nagent: @other\nchange_id: archived-foreign\nbranch: archived-foreign\nworktree_alias: dev2';
  const fixture = makeFixture('foreign-missing-local-change', {
    issues: [
      issue(5, 'archived-foreign', { status: 'status:in-review', assignees: ['other'] }),
      issue(10, 'available'),
    ],
    comments: { 5: [{ body: foreign }] },
    branches: ['archived-foreign'],
  });
  addChange(fixture.root, 'available');
  const untargeted = runSelector(fixture);
  assert.equal(untargeted.status, 0, untargeted.stderr);
  assert.equal(JSON.parse(untargeted.stdout).issue, 10,
    'an archived foreign Claim must remain excluded rather than becoming selectable');
  const explicit = runSelector(fixture, ['--issue', '5']);
  assert.notEqual(explicit.status, 0);
  assert.match(explicit.stderr, /foreign claim state/i);
  assert.doesNotMatch(explicit.stderr, /missing local change/i);
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 20\nstate: active\nagent: @codex\nchange_id: current-later\nbranch: current-later\nworktree_alias: dev1';
  const fixture = makeFixture('resume-current-before-smaller-ready', {
    issues: [issue(10, 'available-first'), issue(20, 'current-later', { status: 'status:claimed', assignees: ['codex'] })],
    comments: { 20: [{ body: current }] },
    branches: ['current-later'],
  });
  addChange(fixture.root, 'available-first');
  addChange(fixture.root, 'current-later');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 20, 'an existing current Claim must win over taking any ready Issue');
}


{
  const currentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-seed-'));
  const realRoot = fs.realpathSync(currentRoot);
  const worktree = `worktree-${createHash('sha256').update(realRoot).digest('hex').slice(0, 12)}`;
  const current = `OpenSpec Buddy Claim\nissue: 4\nchange_id: current\nbranch: current\nagent: codex/codex\nworktree_alias: ${worktree}`;
  const fixture = makeFixture('no-alias-current', {
    issues: [issue(4, 'current', { status: 'status:claimed', assignees: ['codex'] }), issue(10, 'available')],
    comments: { 4: [{ body: current }] },
    branches: ['current'],
    alias: '',
  });
  const fixtureRealRoot = fs.realpathSync(fixture.root);
  const fixtureWorktree = `worktree-${createHash('sha256').update(fixtureRealRoot).digest('hex').slice(0, 12)}`;
  const comments = JSON.parse(fs.readFileSync(path.join(fixture.root, 'comments.json')));
  comments['4'][0].body = comments['4'][0].body.replace(worktree, fixtureWorktree);
  fs.writeFileSync(path.join(fixture.root, 'comments.json'), JSON.stringify(comments));
  addChange(fixture.root, 'current');
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 4);
}

for (const scenario of [
  { name: 'missing-branch', branches: [], assignees: ['codex'], statuses: ['status:claimed'] },
  { name: 'extra-assignee', branches: ['claimed'], assignees: ['codex', 'other'], statuses: ['status:claimed'] },
  { name: 'duplicate-status', branches: ['claimed'], assignees: ['codex'], statuses: ['status:claimed', 'status:ready'] },
]) {
  const current = 'OpenSpec Buddy Claim\nissue: 5\nchange_id: claimed\nbranch: claimed\nagent: codex/codex\nworktree_alias: dev1';
  const claimedIssue = issue(5, 'claimed', { status: scenario.statuses[0], assignees: scenario.assignees });
  claimedIssue.labels = scenario.statuses.map((name) => ({ name }));
  const fixture = makeFixture(scenario.name, {
    issues: [claimedIssue, issue(10, 'available')],
    comments: { 5: [{ body: current }] },
    branches: scenario.branches,
  });
  addChange(fixture.root, 'claimed');
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0, scenario.name);
  assert.match(result.stderr, /partial claim state/i);
}

for (const activeStatus of ['status:claimed', 'status:in-progress', 'status:in-review']) {
  const suffix = activeStatus.slice('status:'.length);
  const currentComment = `OpenSpec Buddy Claim\nissue: 20\nstate: active\nagent: codex/codex\nchange_id: current-${suffix}\nbranch: current-${suffix}\nworktree_alias: dev1`;
  const currentFixture = makeFixture(`current-${suffix}`, {
    issues: [
      issue(10, `ready-${suffix}`),
      issue(20, `current-${suffix}`, { status: activeStatus, assignees: ['codex'] }),
    ],
    comments: { 20: [{ body: currentComment }] },
    branches: [`current-${suffix}`],
  });
  addChange(currentFixture.root, `ready-${suffix}`);
  addChange(currentFixture.root, `current-${suffix}`);
  const untargetedCurrent = runSelector(currentFixture);
  assert.equal(untargetedCurrent.status, 0, untargetedCurrent.stderr);
  assert.equal(JSON.parse(untargetedCurrent.stdout).issue, 20,
    `${activeStatus} current Claim must take priority over ready work`);
  const explicitCurrent = runSelector(currentFixture, ['--issue', '20']);
  assert.equal(explicitCurrent.status, 0, explicitCurrent.stderr);
  assert.equal(JSON.parse(explicitCurrent.stdout).issue, 20);

  const foreignComment = `OpenSpec Buddy Claim\nissue: 20\nstate: active\nagent: codex/other\nchange_id: foreign-${suffix}\nbranch: foreign-${suffix}\nworktree_alias: dev2`;
  const foreignFixture = makeFixture(`foreign-${suffix}`, {
    issues: [
      issue(10, `ready-${suffix}`),
      issue(20, `foreign-${suffix}`, { status: activeStatus, assignees: ['other'] }),
    ],
    comments: { 20: [{ body: foreignComment }] },
    branches: [`foreign-${suffix}`],
  });
  addChange(foreignFixture.root, `ready-${suffix}`);
  addChange(foreignFixture.root, `foreign-${suffix}`);
  const untargetedForeign = runSelector(foreignFixture);
  assert.equal(untargetedForeign.status, 0, untargetedForeign.stderr);
  assert.equal(JSON.parse(untargetedForeign.stdout).issue, 10,
    `${activeStatus} foreign Claim must be skipped in untargeted selection`);
  const explicitForeign = runSelector(foreignFixture, ['--issue', '20']);
  assert.notEqual(explicitForeign.status, 0);
  assert.match(explicitForeign.stderr, /foreign claim state/i);
}

{
  const foreignComment = 'OpenSpec Buddy Claim\nissue: 20\nstate: active\nagent: codex/other\nchange_id: foreign-only\nbranch: foreign-only\nworktree_alias: dev2';
  const fixture = makeFixture('foreign-exhausted', {
    issues: [issue(20, 'foreign-only', { status: 'status:in-review', assignees: ['other'] })],
    comments: { 20: [{ body: foreignComment }] },
    branches: ['foreign-only'],
  });
  addChange(fixture.root, 'foreign-only');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { mode: 'lite', result: 'exhausted' });
}

{
  const fixture = makeFixture('partial-still-blocks-default', {
    issues: [issue(5, 'partial', { status: 'status:claimed' }), issue(10, 'available')],
  });
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial claim state/i);
  assert.doesNotMatch(result.stderr, /missing local change/i);
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 5\nstate: active\nagent: @codex\nchange_id: archived-current\nbranch: archived-current\nworktree_alias: dev1';
  const fixture = makeFixture('later-partial-still-blocks-current', {
    issues: [
      issue(5, 'archived-current', { status: 'status:in-review', assignees: ['codex'] }),
      issue(20, 'partial', { status: 'status:claimed' }),
    ],
    comments: { 5: [{ body: current }] },
    branches: ['archived-current'],
  });
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial claim state/i,
    'a smaller current Claim must not hide a later partial Claim');
}

{
  const current = 'OpenSpec Buddy Claim\nissue: 5\nstate: active\nagent: @codex\nchange_id: archived-current\nbranch: archived-current\nworktree_alias: dev1';
  const fixture = makeFixture('ready-partial-still-blocks-current', {
    issues: [
      issue(5, 'archived-current', { status: 'status:in-review', assignees: ['codex'] }),
      issue(20, 'dirty-ready', { assignees: ['other'] }),
    ],
    comments: { 5: [{ body: current }] },
    branches: ['archived-current'],
  });
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial claim state/i,
    'a current Claim must not hide a ready-labeled partial Claim');
}

console.log('lite selector tests passed');
