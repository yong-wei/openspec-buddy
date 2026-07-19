import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const helper = path.join(repoRoot, 'skills/openspec-buddy/scripts/buddy-driver.mjs');

function run(args) {
  return spawnSync('node', [helper, ...args], {
    cwd: repoRoot,
    env: { ...process.env, OPENSPEC_BUDDY_BASE_BRANCH: 'integration' },
    encoding: 'utf8',
  });
}

for (const args of [
  ['--dry-run', '--mode', 'propose', '--change', 'lightweight-change'],
  ['--dry-run', '--mode', 'propose', '--change', 'local-change', '--no-issue'],
]) {
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, /check-config\.sh local/);
  assert.doesNotMatch(result.stdout, /validate-(?:triage|issue-body|proposal-shape|testing-strategy)/);
  assert.doesNotMatch(result.stdout, /Project|independent proposal review/i);
}

{
  const result = run(['--dry-run', '--mode', 'propose', '--change', 'lightweight-change']);
  assert.match(result.stdout, /exactly one openspec-buddy change_id marker/i);
  assert.match(result.stdout, /type:change plus status:ready/i);
  assert.match(result.stdout, /native GitHub blockedBy/i);
  assert.match(result.stdout, /does not claim/i);
}

for (const invalid of ['Bad/ID', 'UPPER', 'ends-']) {
  const result = run(['--dry-run', '--mode', 'propose', '--change', invalid]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /kebab-case OpenSpec change id/);
}

{
  const result = run(['--dry-run', '--mode', 'propose', '--change', 'local-change', '--no-issue']);
  assert.match(result.stdout, /Keep this change local-only/i);
  assert.doesNotMatch(result.stdout, /type:change plus status:ready/i);
}

{
  const result = run(['--dry-run', '--mode', 'claim', '--issue', '123']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claim-issue\.sh 123/);
  assert.match(result.stdout, /minimal lock/i);
}

{
  const result = run(['--dry-run', '--mode', 'apply', '--issue', '9']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sync-base-branch\.sh/);
  assert.match(result.stdout, /mark-in-progress\.sh 9/);
}

{
  const result = run(['--mode', 'apply', '--issue', '9', '--no-pr']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--no-pr is not a core Buddy option/);
}

{
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode claim\|propose\|explore\|apply\|achieve/);
}

console.log('buddy driver tests passed');
