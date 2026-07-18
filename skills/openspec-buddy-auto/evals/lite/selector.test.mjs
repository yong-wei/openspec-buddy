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
  classifyClaim,
  classifyIssueClaim,
  parseChangeMapping,
  parseLiteClaimComment,
} from '../../scripts/lite/contracts.mjs';

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
    { state: 'open', labels: [{ name: 'status:claimed' }], assignees: [{ login: 'codex' }] },
    [{ body: `OpenSpec Buddy Claim\nissue: 1\nstate: active\nagent: @codex\nchange_id: demo\nbranch: demo\nworktree_alias: dev1` }],
    buildIdentity('codex', 'dev1'),
    { branchExists: true, issue: 1, changeId: 'demo', branch: 'demo' },
  ),
  'current',
);

const historicalClaim = `OpenSpec Buddy Claim

issue: 1
claim_id: claim-1
state: active
agent: @codex
change_id: demo
branch: demo
worktree_alias: dev1`;
const releaseForHistoricalClaim = `OpenSpec Buddy Claim Release

claim_id: claim-1
state: released
agent: @codex
change_id: demo
branch: demo`;
for (const terminalState of ['released', 'abandoned', 'lost']) {
  const terminal = terminalState === 'released'
    ? releaseForHistoricalClaim
    : `OpenSpec Buddy Claim

claim_id: claim-1
state: ${terminalState}`;
  assert.equal(
    classifyIssueClaim(
      { state: 'open', labels: [{ name: 'status:ready' }], assignees: [] },
      [{ body: historicalClaim }, { body: terminal }],
      buildIdentity('codex', 'dev1'),
      { branchExists: false, issue: 1, changeId: 'demo', branch: 'demo' },
    ),
    'unclaimed',
    `${terminalState} must retire only its matching historical Claim`,
  );
}
assert.equal(
  classifyIssueClaim(
    { state: 'open', labels: [{ name: 'status:claimed' }], assignees: [{ login: 'other' }] },
    [
      { body: historicalClaim },
      { body: `OpenSpec Buddy Claim

issue: 1
claim_id: claim-2
state: active
agent: @other
change_id: demo
branch: demo
worktree_alias: dev2` },
      { body: releaseForHistoricalClaim },
    ],
    buildIdentity('codex', 'dev1'),
    { branchExists: true, issue: 1, changeId: 'demo', branch: 'demo' },
  ),
  'foreign',
  'releasing one Claim must not hide another active foreign Claim',
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

function makeFixture(name, { issues, comments = {}, blockedBy = {}, branches = [], alias = 'dev1' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-${name}-`));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'issues.json'), JSON.stringify(issues));
  fs.writeFileSync(path.join(root, 'comments.json'), JSON.stringify(comments));
  fs.writeFileSync(path.join(root, 'blocked.json'), JSON.stringify(blockedBy));
  fs.writeFileSync(path.join(root, 'branches.json'), JSON.stringify(branches));
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
if (args[0] === 'api' && String(args[1]).includes('/git/ref/heads/')) {
  const branch = decodeURIComponent(args[1].split('/heads/').at(-1));
  const branches = JSON.parse(fs.readFileSync(path.join(root, 'branches.json')));
  if (!branches.includes(branch)) { console.error('HTTP 404: Not Found'); process.exit(1); }
  return console.log(JSON.stringify({ ref: 'refs/heads/' + branch, object: { sha: '1111111111111111111111111111111111111111' } }));
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
  if (alias) execFileSync('git', ['config', '--worktree', 'buddy.worktreeAlias', alias], { cwd: root });
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
  const fixture = makeFixture('released-claim-is-ready-again', {
    issues: [issue(11, 'released-ready')],
    comments: {
      11: [
        { body: historicalClaim.replaceAll('issue: 1', 'issue: 11').replaceAll('demo', 'released-ready') },
        { body: releaseForHistoricalClaim.replaceAll('demo', 'released-ready') },
      ],
    },
  });
  addChange(fixture.root, 'released-ready');
  const result = runSelector(fixture, ['--issue', '11']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).issue, 11);
}

{
  const fixture = makeFixture('duplicate-target-args', { issues: [issue(11, 'earlier')] });
  addChange(fixture.root, 'earlier');
  const duplicateIssue = runSelector(fixture, ['--issue', '11', '--issue', '11']);
  assert.notEqual(duplicateIssue.status, 0);
  assert.match(duplicateIssue.stderr, /--issue.*only once|duplicate --issue/i);
  const duplicateChange = runSelector(fixture, ['--change', 'earlier', '--change', 'earlier']);
  assert.notEqual(duplicateChange.status, 0);
  assert.match(duplicateChange.stderr, /--change.*only once|duplicate --change/i);
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
