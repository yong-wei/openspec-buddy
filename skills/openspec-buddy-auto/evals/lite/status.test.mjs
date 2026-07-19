#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(here, '../../scripts/lite/set-issue-status.sh');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lite-status-'));
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
const state = path.join(root, 'labels.json');
const log = path.join(root, 'calls.log');
fs.writeFileSync(state, JSON.stringify(['status:ready', 'status:blocked', 'type:change']));
fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const state = ${JSON.stringify(state)};
const log = ${JSON.stringify(log)};
const args = process.argv.slice(2);
fs.appendFileSync(log, args.join(' ') + '\\n');
let labels = JSON.parse(fs.readFileSync(state));
if (args[0] === 'issue' && args[1] === 'view') {
  console.log(JSON.stringify({ labels: labels.map((name) => ({ name })) }));
  process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'edit') {
  const removeAt = args.indexOf('--remove-label');
  if (removeAt >= 0) labels = labels.filter((name) => !args[removeAt + 1].split(',').includes(name));
  const addAt = args.indexOf('--add-label');
  if (addAt >= 0 && !labels.includes(args[addAt + 1])) labels.push(args[addAt + 1]);
  fs.writeFileSync(state, JSON.stringify(labels));
  process.exit(0);
}
console.error('unexpected gh call: ' + args.join(' '));
process.exit(90);
`, { mode: 0o755 });

function run(status) {
  return spawnSync(helper, ['17', status], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

const changed = run('claimed');
assert.equal(changed.status, 0, changed.stderr || changed.error?.message || 'status helper failed');
assert.deepEqual(JSON.parse(fs.readFileSync(state)), ['type:change', 'status:claimed']);
assert.match(fs.readFileSync(log, 'utf8'), /issue edit 17 --remove-label status:ready,status:blocked\nissue edit 17 --add-label status:claimed/);

const idempotent = run('claimed');
assert.equal(idempotent.status, 0, idempotent.stderr);
assert.equal(fs.readFileSync(log, 'utf8').split('\n').filter((line) => line.includes('issue edit')).length, 2);

fs.writeFileSync(state, JSON.stringify(['status:claimed', 'status:blocked', 'type:change']));
const targetAmongOldStatuses = run('claimed');
assert.equal(targetAmongOldStatuses.status, 0, targetAmongOldStatuses.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(state)), ['type:change', 'status:claimed']);
assert.match(fs.readFileSync(log, 'utf8'), /issue edit 17 --remove-label status:claimed,status:blocked\nissue edit 17 --add-label status:claimed/);

for (const allowed of ['ready', 'in-progress', 'in-review', 'archived', 'claimed']) {
  const result = run(allowed);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(state)).filter((label) => label.startsWith('status:')).join(','), `status:${allowed}`);
}

for (const invalid of ['status:ready', 'blocked', 'merged']) {
  const result = run(invalid);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ready, claimed, in-progress, in-review, archived/);
}

function failureFixture(name, behavior) {
  const failureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-lite-status-${name}-`));
  const failureBin = path.join(failureRoot, 'bin');
  const failureState = path.join(failureRoot, 'state.json');
  const failureLog = path.join(failureRoot, 'calls.log');
  fs.mkdirSync(failureBin);
  fs.writeFileSync(failureState, JSON.stringify({ labels: ['status:ready'], behavior }));
  fs.writeFileSync(path.join(failureBin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = ${JSON.stringify(failureState)}; const log = ${JSON.stringify(failureLog)};
const args = process.argv.slice(2); const state = JSON.parse(fs.readFileSync(file));
fs.appendFileSync(log, args.join(' ') + '\\n');
if (args[0] === 'issue' && args[1] === 'view') { console.log(JSON.stringify({ labels: state.labels.map((name) => ({ name })) })); process.exit(0); }
if (args[0] === 'issue' && args[1] === 'edit') {
  const removeAt = args.indexOf('--remove-label'); const addAt = args.indexOf('--add-label');
  if (removeAt >= 0 && state.behavior !== 'remove-fail') state.labels = state.labels.filter((name) => !args[removeAt + 1].split(',').includes(name));
  if (addAt >= 0 && state.behavior !== 'add-fail' && !state.labels.includes(args[addAt + 1])) state.labels.push(args[addAt + 1]);
  if (state.behavior === 'remove-applied-fail' && removeAt >= 0) state.labels = state.labels.filter((name) => !args[removeAt + 1].split(',').includes(name));
  if (state.behavior === 'add-applied-fail' && addAt >= 0 && !state.labels.includes(args[addAt + 1])) state.labels.push(args[addAt + 1]);
  fs.writeFileSync(file, JSON.stringify(state));
  if ((state.behavior === 'remove-fail' || state.behavior === 'remove-applied-fail') && removeAt >= 0) { console.error('remove response failed'); process.exit(1); }
  if ((state.behavior === 'add-fail' || state.behavior === 'add-applied-fail') && addAt >= 0) { console.error('add response failed'); process.exit(1); }
  process.exit(0);
}
process.exit(90);
`, { mode: 0o755 });
  return {
    state: failureState,
    log: failureLog,
    run: () => spawnSync(helper, ['17', 'claimed'], {
      cwd: failureRoot,
      env: { ...process.env, PATH: `${failureBin}:${process.env.PATH}` },
      encoding: 'utf8',
    }),
  };
}

for (const behavior of ['remove-fail', 'add-fail']) {
  const item = failureFixture(behavior, behavior);
  const result = item.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`${behavior.split('-')[0]} response failed`, 'i'));
  assert.match(result.stderr, /expected status:claimed, observed/i);
  assert.equal(fs.readFileSync(item.log, 'utf8').split('\n').filter((line) => line.startsWith('issue view')).length, 2,
    'a failed write must still perform exactly one final truth read');
}

for (const behavior of ['remove-applied-fail', 'add-applied-fail']) {
  const item = failureFixture(behavior, behavior);
  const result = item.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(item.state)).labels, ['status:claimed']);
  assert.equal(fs.readFileSync(item.log, 'utf8').split('\n').filter((line) => line.startsWith('issue view')).length, 2);
}

console.log('lite status tests passed');
