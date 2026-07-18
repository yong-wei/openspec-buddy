#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildIdentity,
  classifyClaim,
  classifyIssueClaim,
  parseChangeMapping,
  parseLiteClaimComment,
} from '../../scripts/lite/contracts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const selector = path.resolve(here, '../../scripts/lite/select-available-issue.mjs');

assert.equal(parseChangeMapping('<!-- openspec-buddy change_id: marker-change -->').changeId, 'marker-change');
assert.equal(parseChangeMapping('<!-- openspec-buddy\nchange_id: hidden-change\n-->').changeId, 'hidden-change');
assert.equal(parseChangeMapping('---\nchange_id: front-change\n---\nBody').changeId, 'front-change');
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

const claim = parseLiteClaimComment(`OpenSpec Buddy Claim

claim_id: claim-1
state: active
agent: @codex
change_id: demo-change
worktree_alias: dev1`);
assert.equal(claim.claimId, 'claim-1');
assert.equal(claim.viewer, 'codex');
assert.equal(claim.worktree, 'dev1');
assert.equal(claim.head, undefined);
assert.equal(classifyClaim(null, buildIdentity('codex', 'dev1')), 'unclaimed');
assert.equal(classifyClaim(claim, buildIdentity('codex', 'dev1')), 'current');
assert.equal(classifyClaim(claim, buildIdentity('other', 'dev1')), 'foreign');
assert.equal(classifyClaim({ ...claim, worktree: '' }, buildIdentity('codex', 'dev1')), 'partial');
const released = parseLiteClaimComment(`OpenSpec Buddy Claim Release

claim_id: claim-1
state: released
agent: @codex
change_id: demo-change`);
assert.equal(released.state, 'released');
assert.equal(classifyClaim(released, buildIdentity('codex', 'dev1')), 'unclaimed');
assert.equal(
  classifyIssueClaim({ labels: [{ name: 'status:claimed' }], assignees: [] }, [], buildIdentity('codex', 'dev1')),
  'partial',
);
assert.equal(
  classifyIssueClaim(
    { labels: [{ name: 'status:claimed' }], assignees: [{ login: 'codex' }] },
    [{ body: `OpenSpec Buddy Claim\nclaim_id: c1\nstate: active\nagent: @codex\nchange_id: demo\nworktree_alias: dev1` }],
    buildIdentity('codex', 'dev1'),
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

function makeFixture(name, { issues, comments = {}, blockedBy = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-${name}-`));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'issues.json'), JSON.stringify(issues));
  fs.writeFileSync(path.join(root, 'comments.json'), JSON.stringify(comments));
  fs.writeFileSync(path.join(root, 'blocked.json'), JSON.stringify(blockedBy));
  writeExecutable(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(root)};
const args = process.argv.slice(2);
const issues = JSON.parse(fs.readFileSync(path.join(root, 'issues.json')));
if (args[0] === 'api' && args[1] === 'user') return console.log(JSON.stringify({ login: 'codex' }));
if (args[0] === 'repo' && args[1] === 'view') return console.log(JSON.stringify({ nameWithOwner: 'acme/repo' }));
if (args[0] === 'api' && String(args[1]).includes('/issues?')) return console.log(JSON.stringify(issues));
if (args[0] === 'api' && String(args[1]).endsWith('/comments?per_page=100')) {
  const number = args[1].split('/').at(-2);
  const comments = JSON.parse(fs.readFileSync(path.join(root, 'comments.json')));
  return console.log(JSON.stringify(comments[number] || []));
}
if (args[0] === 'api' && args[1] === 'graphql') {
  const numberArg = args.find((value) => value.startsWith('number='));
  const number = numberArg ? numberArg.slice('number='.length) : '';
  const blocked = JSON.parse(fs.readFileSync(path.join(root, 'blocked.json')));
  const configured = blocked[number] || [];
  const pages = Array.isArray(configured) ? [configured] : configured.pages;
  const afterArg = args.find((value) => value.startsWith('after='));
  const index = afterArg && afterArg !== 'after=' ? Number(afterArg.slice('after=page-'.length)) : 0;
  const hasNextPage = index < pages.length - 1;
  return console.log(JSON.stringify({ data: { repository: { issue: { blockedBy: {
    nodes: pages[index] || [],
    ...(configured.omitPageInfo ? {} : { pageInfo: { hasNextPage, endCursor: hasNextPage ? 'page-' + (index + 1) : null } }),
  } } } } }));
}
console.error('unexpected gh call: ' + args.join(' '));
process.exit(90);
`);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', '--local', 'extensions.worktreeConfig', 'true'], { cwd: root });
  execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', 'dev1'], { cwd: root });
  return { root, bin };
}

function addChange(root, changeId) {
  fs.mkdirSync(path.join(root, 'openspec', 'changes', changeId), { recursive: true });
}

function runSelector(fixture, args = []) {
  return spawnSync(process.execPath, [selector, ...args], {
    cwd: fixture.root,
    env: { ...process.env, PATH: `${fixture.bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

{
  const fixture = makeFixture('smallest', {
    issues: [issue(22, 'later'), issue(11, 'earlier')],
  });
  addChange(fixture.root, 'later');
  addChange(fixture.root, 'earlier');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'lite', result: 'issue', issue: 11, change_id: 'earlier', url: 'https://example.test/issues/11',
  });
}

{
  const fixture = makeFixture('target-issue', { issues: [issue(11, 'earlier'), issue(22, 'later')] });
  addChange(fixture.root, 'earlier');
  addChange(fixture.root, 'later');
  const result = runSelector(fixture, ['--issue', '22']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 22);
}

{
  const fixture = makeFixture('local-only', { issues: [] });
  addChange(fixture.root, 'local-change');
  const result = runSelector(fixture, ['--change', 'local-change']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'lite', result: 'local_only', change_id: 'local-change',
  });
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
    issues: [issue(11, 'claimed')],
    comments: {
      11: [[{ body: 'OpenSpec Buddy Claim\nclaim_id: c1\nstate: active\nagent: @other\nchange_id: claimed\nworktree_alias: dev2' }]],
    },
  });
  addChange(fixture.root, 'claimed');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /foreign claim state/i);
}

{
  const fixture = makeFixture('paginated-blocker', {
    issues: [issue(11, 'paged-blocked')],
    blockedBy: { 11: { pages: [[{ number: 6, state: 'CLOSED' }], [{ number: 7, state: 'OPEN' }]] } },
  });
  addChange(fixture.root, 'paged-blocked');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked by open issue #7/i);
}

{
  const fixture = makeFixture('missing-page-info', {
    issues: [issue(11, 'unsafe-page')],
    blockedBy: { 11: { pages: [[{ number: 6, state: 'CLOSED' }]], omitPageInfo: true } },
  });
  addChange(fixture.root, 'unsafe-page');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /safely paginate blockedBy/i);
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
  const current = 'OpenSpec Buddy Claim\nclaim_id: current-1\nstate: active\nagent: @codex\nchange_id: current\nworktree_alias: dev1';
  const foreign = 'OpenSpec Buddy Claim\nclaim_id: foreign-1\nstate: active\nagent: @other\nchange_id: foreign\nworktree_alias: dev2';
  const fixture = makeFixture('skip-foreign-default', {
    issues: [issue(4, 'current', { status: 'status:claimed', assignees: ['codex'] }), issue(5, 'foreign'), issue(10, 'available')],
    comments: { 4: [{ body: current }], 5: [{ body: foreign }] },
  });
  addChange(fixture.root, 'current');
  addChange(fixture.root, 'foreign');
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 10);
  const explicit = runSelector(fixture, ['--issue', '5']);
  assert.notEqual(explicit.status, 0);
  assert.match(explicit.stderr, /foreign claim state/i);
  const explicitCurrent = runSelector(fixture, ['--issue', '4']);
  assert.notEqual(explicitCurrent.status, 0);
}

{
  const fixture = makeFixture('partial-still-blocks-default', {
    issues: [issue(5, 'partial', { status: 'status:claimed' }), issue(10, 'available')],
  });
  addChange(fixture.root, 'partial');
  addChange(fixture.root, 'available');
  const result = runSelector(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial claim state/i);
}

console.log('lite selector tests passed');
