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

function initializeGit(directory) {
  spawnSync('git', ['init', '-q'], { cwd: directory });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: directory });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: directory });
  fs.writeFileSync(path.join(directory, '.git-seed'), 'seed\n');
  spawnSync('git', ['add', '.git-seed'], { cwd: directory });
  spawnSync('git', ['commit', '-qm', 'seed'], { cwd: directory });
}

{
  const result = run(['--dry-run', '--mode', 'propose', '--change', 'add-driver-gate']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HANDOFF/);
  assert.match(result.stdout, /validate-triage\.mjs/);
  assert.match(result.stdout, /validate-triage\.mjs[^\n]*--issue local --change-id add-driver-gate --base-sha [0-9a-f]{7,64}/);
  assert.match(result.stdout, /validate-issue-body\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/\.buddy\/issue\.md/);
  assert.match(result.stdout, /validate-proposal-shape\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/\.buddy\/proposal-review\.yaml/);
  assert.match(result.stdout, /validate-testing-strategy\.mjs/);
  assert.match(result.stdout, /openspec\/changes\/add-driver-gate\/design\.md/);
  assert.ok(
    result.stdout.indexOf('validate-triage.mjs') < result.stdout.indexOf('validate-issue-body.mjs'),
    'triage validation must precede existing proposal gates',
  );
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-stale-triage-base-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  const buddyDir = path.join(tmp, 'openspec/changes/stale-triage/.buddy');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(buddyDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  fs.copyFileSync(path.join(path.dirname(helper), 'validate-triage.mjs'), path.join(scriptDir, 'validate-triage.mjs'));
  makeExecutable(path.join(scriptDir, 'check-config.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.writeFileSync(path.join(buddyDir, 'triage.json'), `${JSON.stringify({
    subject: { issue: null, change_id: 'stale-triage' },
    truth: { problem_reproduced: 'yes', evidence: ['Observed repository behavior'] },
    duplication: { existing_implementation: 'none', conflicting_specs: [], active_changes: [], superseded_by: null },
    readiness: { information: 'sufficient', disposition: 'executable', reason: 'Evidence supports execution' },
    binding: { issue_updated_at: null, base_sha: 'deadbee', generated_at: '2026-07-14T10:00:00Z' },
  }, null, 2)}\n`);
  initializeGit(tmp);
  const configuredBase = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['update-ref', 'refs/remotes/origin/integration', configuredBase], { cwd: tmp });
  fs.writeFileSync(path.join(tmp, 'seed'), 'seed\n');
  spawnSync('git', ['add', 'seed'], { cwd: tmp });
  spawnSync('git', ['commit', '-qm', 'seed'], { cwd: tmp });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).stdout.trim();
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'stale-triage'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, OPENSPEC_BUDDY_BASE_BRANCH: 'integration' },
  });
  assert.notEqual(head, configuredBase, 'fixture must distinguish local HEAD from configured origin base');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /^BLOCKED$/m);
  assert.match(result.stdout, new RegExp(`validate-triage\\.mjs[^\\n]*--base-sha ${head}`));

  const wrongIdentity = JSON.parse(fs.readFileSync(path.join(buddyDir, 'triage.json'), 'utf8'));
  wrongIdentity.subject.issue = 42;
  wrongIdentity.binding.issue_updated_at = '2026-07-14T10:00:00Z';
  wrongIdentity.binding.base_sha = head;
  fs.writeFileSync(path.join(buddyDir, 'triage.json'), `${JSON.stringify(wrongIdentity, null, 2)}\n`);
  const identityResult = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'stale-triage'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, OPENSPEC_BUDDY_BASE_BRANCH: 'integration' },
  });
  assert.notEqual(identityResult.status, 0);
  assert.match(identityResult.stdout, /^BLOCKED$/m);
  assert.match(identityResult.stdout, /--issue local --change-id stale-triage/);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-missing-head-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  spawnSync('git', ['init', '-q'], { cwd: tmp });
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--dry-run', '--mode', 'propose', '--change', 'no-head'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, OPENSPEC_BUDDY_BASE_BRANCH: 'integration' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unable to resolve proposal base SHA from HEAD/);
}

for (const mismatch of ['issue', 'change']) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `buddy-driver-local-identity-${mismatch}-`));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  const buddyDir = path.join(tmp, 'openspec/changes/local-identity/.buddy');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(buddyDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  fs.copyFileSync(path.join(path.dirname(helper), 'validate-triage.mjs'), path.join(scriptDir, 'validate-triage-real.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  const githubLog = path.join(tmp, 'github.log');
  makeExecutable(path.join(scriptDir, 'check-config.sh'), `#!/usr/bin/env bash\necho check-config >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-triage.mjs'), `#!/usr/bin/env bash\necho validate-triage >> ${JSON.stringify(logFile)}\nexec node ${JSON.stringify(path.join(scriptDir, 'validate-triage-real.mjs'))} "$@"\n`);
  for (const name of ['validate-issue-body.mjs', 'validate-proposal-shape.mjs', 'validate-testing-strategy.mjs']) {
    makeExecutable(path.join(scriptDir, name), `#!/usr/bin/env bash\necho ${name} >> ${JSON.stringify(logFile)}\n`);
  }
  makeExecutable(path.join(tmp, 'gh'), `#!/usr/bin/env bash\necho gh >> ${JSON.stringify(githubLog)}\nexit 99\n`);
  initializeGit(tmp);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).stdout.trim();
  const triage = {
    subject: { issue: mismatch === 'issue' ? 31 : null, change_id: mismatch === 'change' ? 'other-change' : 'local-identity' },
    truth: { problem_reproduced: 'yes', evidence: ['Observed repository behavior'] },
    duplication: { existing_implementation: 'none', conflicting_specs: [], active_changes: [], superseded_by: null },
    readiness: { information: 'sufficient', disposition: 'executable', reason: 'Evidence supports execution' },
    binding: { issue_updated_at: mismatch === 'issue' ? '2026-07-14T10:00:00Z' : null, base_sha: head, generated_at: '2026-07-14T10:00:00Z' },
  };
  fs.writeFileSync(path.join(buddyDir, 'triage.json'), `${JSON.stringify(triage)}\n`);
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'local-identity', '--no-issue'], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${tmp}:${process.env.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /^BLOCKED$/m);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), ['check-config', 'validate-triage'].join('\n'));
  assert.equal(fs.existsSync(githubLog), false, 'identity mismatch must stop before GitHub mutation');
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
  makeExecutable(path.join(scriptDir, 'validate-triage.mjs'), `#!/usr/bin/env bash\necho validate-triage >> ${JSON.stringify(logFile)}\necho '{"disposition":"executable"}'\n`);
  makeExecutable(path.join(scriptDir, 'validate-issue-body.mjs'), `#!/usr/bin/env bash\necho validate-issue-body >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-proposal-shape.mjs'), `#!/usr/bin/env bash\necho validate-proposal-shape >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(tmp, 'gh'), `#!/usr/bin/env bash\necho gh >> ${JSON.stringify(githubLog)}\n`);
  fs.writeFileSync(path.join(changeDir, '.buddy/issue.md'), '- [ ] AC-1: Outcome.\n');
  if (missingArtifact === 'section') {
    fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design\n\nNo testing contract.\n');
  }
  initializeGit(tmp);
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
    'validate-triage',
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
  makeExecutable(path.join(scriptDir, 'validate-triage.mjs'), `#!/usr/bin/env bash\necho validate-triage >> ${JSON.stringify(logFile)}\necho '{"disposition":"executable"}'\n`);
  makeExecutable(path.join(scriptDir, 'validate-issue-body.mjs'), `#!/usr/bin/env bash\necho validate-issue-body >> ${JSON.stringify(logFile)}\n`);
  fs.copyFileSync(
    path.join(path.dirname(helper), 'validate-proposal-shape.mjs'),
    path.join(scriptDir, 'validate-proposal-shape.mjs'),
  );
  initializeGit(tmp);
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'missing-manifest'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, /proposal-review\.yaml not found/);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), ['check-config', 'validate-triage', 'validate-issue-body'].join('\n'));
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-driver-propose-triage-disposition-'));
  const scriptDir = path.join(tmp, 'skills/openspec-buddy/scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.cpSync(helper, path.join(scriptDir, 'buddy-driver.mjs'));
  const logFile = path.join(tmp, 'commands.log');
  makeExecutable(path.join(scriptDir, 'check-config.sh'), `#!/usr/bin/env bash\necho check-config >> ${JSON.stringify(logFile)}\n`);
  makeExecutable(path.join(scriptDir, 'validate-triage.mjs'), `#!/usr/bin/env bash\necho validate-triage >> ${JSON.stringify(logFile)}\necho '{"disposition":"needs-human"}'\n`);
  makeExecutable(path.join(scriptDir, 'validate-issue-body.mjs'), `#!/usr/bin/env bash\necho issue-mutation >> ${JSON.stringify(logFile)}\n`);
  initializeGit(tmp);
  const result = spawnSync('node', [path.join(scriptDir, 'buddy-driver.mjs'), '--mode', 'propose', '--change', 'triaged'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^HANDOFF$/m);
  assert.match(result.stdout, /^triage_disposition: needs-human$/m);
  assert.match(result.stdout, /status:needs-human/);
  assert.equal(fs.readFileSync(logFile, 'utf8').trim(), ['check-config', 'validate-triage'].join('\n'));
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
  initializeGit(tmp);
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
  initializeGit(tmp);
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
  initializeGit(tmp);
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
  initializeGit(tmp);
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
  initializeGit(tmp);
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
