import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const helper = path.resolve(__dirname, '../scripts/buddy-driver.mjs');

function run(args, options = {}) {
  const result = spawnSync('node', [helper, ...args], {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
  return result;
}

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

{
  const result = run(['--mode', 'propose', '--change', 'add-driver-gate']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OpenSpec Buddy Driver/);
  assert.match(result.stdout, /validate-issue-body\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/\.buddy\/issue\.md/);
  assert.match(result.stdout, /independent proposal review/i);
}

{
  const result = run(['--mode', 'propose', '--change', 'local-change', '--no-issue']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check-config\.sh local/);
  assert.doesNotMatch(result.stdout, /--local-only/);
}

{
  const result = run(['--mode', 'claim', '--issue', '123']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claim-issue\.sh 123/);
  assert.match(result.stdout, /minimal lock/i);
}

{
  const result = run(['--mode', 'apply', '--issue', '9', '--no-pr']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--no-pr is not a core Buddy option/);
}

{
  const skill = fs.readFileSync(path.resolve(__dirname, '../SKILL.md'), 'utf8');
  assert.match(skill, /<EXTREMELY_IMPORTANT>/);
  assert.match(skill, /buddy-driver\.mjs/);
  assert.ok(skill.split('\n').length < 140, 'openspec-buddy SKILL.md should stay focused on the driver entrypoint');
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-'));
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'README.md'), 'x\n');
  spawnSync('git', ['add', 'README.md'], { cwd: tmp });
  spawnSync('git', ['commit', '-q', '-m', 'init'], {
    cwd: tmp,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  const result = run(['--mode', 'apply', '--issue', '7'], { cwd: tmp });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dirty: no/);
  assert.match(result.stdout, /mark-in-progress\.sh 7/);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-run-next-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  makeExecutable(path.join(scriptDir, 'sync-base-branch.sh'), `#!/usr/bin/env bash\necho sync >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'claim-change.sh'), `#!/usr/bin/env bash\necho claim-change "$@" >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'mark-in-progress.sh'), `#!/usr/bin/env bash\necho mark-in-progress "$@" >> ${JSON.stringify(logFile)}\n`);
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'apply', '--issue', '9', '--run-next'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), 'sync');
}

console.log('buddy-driver tests passed');
