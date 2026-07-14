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
  const result = run(['--dry-run', '--mode', 'propose', '--change', 'add-driver-gate']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HANDOFF/);
  assert.match(result.stdout, /validate-issue-body\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/\.buddy\/issue\.md/);
  assert.match(result.stdout, /validate-proposal-shape\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/\.buddy\/proposal-review\.yaml/);
  assert.match(result.stdout, /validate-testing-strategy\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/design\.md/);
  assert.ok(
    result.stdout.indexOf('validate-issue-body.mjs') < result.stdout.indexOf('validate-proposal-shape.mjs'),
    'proposal shape validation must immediately follow issue body validation',
  );
  assert.ok(
    result.stdout.indexOf('validate-proposal-shape.mjs') < result.stdout.indexOf('validate-testing-strategy.mjs'),
    'testing strategy validation must follow proposal shape validation',
  );
  assert.match(result.stdout, /independent proposal review/i);
}

{
  const result = run(['--dry-run', '--mode', 'propose', '--change', 'local-change', '--no-issue']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check-config\.sh local/);
  assert.match(result.stdout, /validate-proposal-shape\.mjs/);
  assert.match(result.stdout, /validate-testing-strategy\.mjs/);
  assert.doesNotMatch(result.stdout, /--local-only/);
}

for (const missingArtifact of ['design', 'section']) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-driver-propose-missing-testing-${missingArtifact}-`));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  const changeDir = path.join(tmp, 'openspec/changes/missing-testing');
  fs.mkdirSync(path.join(changeDir, '.buddy'), { recursive: true });
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  fs.copyFileSync(
    path.join(path.dirname(helper), 'validate-testing-strategy.mjs'),
    path.join(scriptDir, 'validate-testing-strategy.mjs'),
  );
  const logFile = path.join(tmp, 'commands.log');
  const githubLog = path.join(tmp, 'github.log');
  makeExecutable(path.join(scriptDir, 'check-config.sh'), `#!/usr/bin/env bash\necho check-config >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-issue-body.mjs'), `#!/usr/bin/env bash\necho validate-issue-body >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-proposal-shape.mjs'), `#!/usr/bin/env bash\necho validate-proposal-shape >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(tmp, 'gh'), `#!/usr/bin/env bash\necho gh >> ${JSON.stringify(githubLog)}\n`);
  fs.writeFileSync(path.join(changeDir, '.buddy/issue.md'), '- [ ] AC-1: Outcome.\n');
  if (missingArtifact === 'section') {
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design\n\nNo testing contract.\n');
  }
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'missing-testing'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${tmp}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, missingArtifact === 'design' ? /design\.md not found/ : /Testing Strategy section missing/);
  assert.match(result.stdout, /before any GitHub Issue mutation/i);
  assert.equal(fs.existsSync(githubLog), false, 'proposal validation failure must not invoke GitHub mutation');
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), [
    'check-config',
    'validate-issue-body',
    'validate-proposal-shape',
  ].join('\n'));
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-propose-missing-manifest-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  makeExecutable(path.join(scriptDir, 'check-config.sh'), `#!/usr/bin/env bash\necho check-config >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-issue-body.mjs'), `#!/usr/bin/env bash\necho validate-issue-body >> ${JSON.stringify(logFile)}\n`);
  fs.copyFileSync(
    path.join(path.dirname(helper), 'validate-proposal-shape.mjs'),
    path.join(scriptDir, 'validate-proposal-shape.mjs'),
  );
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'missing-manifest'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, /proposal-review\.yaml not found/);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), ['check-config', 'validate-issue-body'].join('\n'));
}

{
  const result = run(['--dry-run', '--mode', 'claim', '--issue', '123']);
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
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--mode claim\|propose\|explore\|apply\|achieve/);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-explore-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  fs.cpSync(path.join(path.dirname(helper), 'detect-method-skills.mjs'), path.join(scriptDir, 'detect-method-skills.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  for (const name of ['check-config.sh', 'claim-issue.sh', 'sync-base-branch.sh', 'mark-in-progress.sh']) {
    makeExecutable(path.join(scriptDir, name), `#!/usr/bin/env bash\necho ${name} >> ${JSON.stringify(logFile)}\n`);
  }
  const skillRoot = path.join(tmp, 'method-skills');
  fs.mkdirSync(path.join(skillRoot, 'research'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'research', 'SKILL.md'), '# research\n');
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'explore', '--explore-question', 'facts'], {
    cwd: tmp,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.join(tmp, 'home'),
      OPENSPEC_BUDDY_SKILL_ROOTS: skillRoot,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, /^mode: explore$/m);
  assert.match(result.stdout, /^mutation_allowed: false$/m);
  assert.match(result.stdout, /^coordination_state: none$/m);
  assert.match(result.stdout, /^method_provider: matt$/m);
  assert.match(result.stdout, /^recommended_method: research$/m);
  assert.match(result.stdout, /^next_transition: propose \| continue-explore$/m);
  assert.equal(fs.existsSync(logFile), false);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-explore-fallback-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'explore', '--explore-question', 'interaction-state'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, HOME: path.join(tmp, 'home'), OPENSPEC_BUDDY_SKILL_ROOTS: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^method_provider: buddy-native$/m);
  assert.match(result.stdout, /^recommended_method: native-throwaway-experiment$/m);
}

{
  const result = run(['--mode', 'explore']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--explore-question is required/);
}

{
  const result = run(['--mode', 'explore', '--explore-question', 'unknown']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported explore question/);
}

for (const [question, method] of [
  ['intent', 'native-one-question-clarification'],
  ['facts', 'native-primary-source-investigation'],
  ['interaction-state', 'native-throwaway-experiment'],
  ['active-change-design', 'openspec-explore'],
]) {
  const result = run(['--dry-run', '--mode', 'explore', '--explore-question', question], {
    env: {
      HOME: path.join(os.tmpdir(), 'missing-buddy-method-home'),
      OPENSPEC_BUDDY_SKILL_ROOTS: path.join(os.tmpdir(), 'missing-buddy-method-skills'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^explore_question: ${question}$`, 'm'));
  assert.match(result.stdout, new RegExp(`^recommended_method: ${method}$`, 'm'));
}

{
  const skill = fs.readFileSync(path.resolve(__dirname, '../SKILL.md'), 'utf8');
  assert.match(skill, /<EXTREMELY_IMPORTANT>/);
  assert.match(skill, /buddy-driver\.mjs/);
  assert.match(skill, /DO NOT OUTPUT/);
  assert.match(skill, /WAIT SILENTLY/);
  assert.ok(skill.split('\n').length < 140, 'openspec-buddy SKILL.md should stay focused on the driver entrypoint');
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-no-context-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  makeExecutable(path.join(scriptDir, 'check-config.sh'), `#!/usr/bin/env bash\necho check >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'claim-issue.sh'), `#!/usr/bin/env bash\necho claim >> ${JSON.stringify(logFile)}\n`);
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs')], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF/m);
  assert.match(result.stdout, /context-needed/);
  assert.equal(fs.existsSync(logFile), false);
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
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /BLOCKED/);
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
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'apply', '--issue', '9'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DONE/m);
  assert.doesNotMatch(result.stdout, /^sync$/m);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), [
    'sync',
    'claim-change 9',
    'mark-in-progress 9',
  ].join('\n'));
}

console.log('buddy-driver tests passed');
