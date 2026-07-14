import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const skill = read('skills/openspec-buddy/SKILL.md');
const lifecycle = read('skills/openspec-buddy/references/core-lifecycle.md');
const driver = read('skills/openspec-buddy/scripts/buddy-driver.mjs');

assert.match(
  skill,
  /EVERY OPENSPEC-BUDDY PHASE MUST START BY RUNNING THE DRIVER SCRIPT[\s\S]*buddy-driver\.mjs/i,
  'main skill must direct agents to the Buddy driver before detailed propose flow',
);
assert.doesNotMatch(
  skill,
  /If the user also asked to create local OpenSpec artifacts/,
  'local OpenSpec artifacts must not be optional in propose mode',
);
assert.match(
  lifecycle,
  /Use propose to create a local OpenSpec change and, by default, the matching\s+GitHub issue/i,
  'propose must default to creating the local OpenSpec change and GitHub issue',
);
assert.match(
  driver,
  /validate-issue-body\.mjs[\s\S]*validate-proposal-shape\.mjs/,
  'propose must validate proposal shape immediately after the issue body',
);
assert.doesNotMatch(
  driver,
  /validate-proposal-shape\.mjs[\s\S]*--allow-missing/,
  'new propose runs must not fabricate or silently accept a missing proposal-review manifest',
);
assert.match(
  lifecycle,
  /openspec\/changes\/<change_id>\/\.buddy\/issue\.md/,
  'propose must require a local intermediate GitHub issue body artifact',
);
assert.match(
  lifecycle,
  /validate-issue-body\.mjs/,
  'propose must validate the issue body before GitHub issue mutation',
);
assert.match(
  lifecycle,
  /independent reviewer/i,
  'propose must keep checklist approval independent from the implementation thread',
);

const evals = JSON.parse(read('skills/openspec-buddy/evals/evals.json'));
const proposeEval = evals.evals.find((item) => item.prompt.includes('openspec-buddy propose'));
assert.ok(proposeEval, 'evals.json must include a propose eval');
assert.match(
  proposeEval.expected_output,
  /默认调用 openspec-propose 创建本地 OpenSpec change/,
  'propose eval must require local OpenSpec change creation by default',
);
assert.match(
  proposeEval.expected_output,
  /GitHub Issue 默认包含完整协作标签和协调状态/,
  'propose eval must require full issue labels and coordination state by default',
);
assert.match(
  proposeEval.expected_output,
  /通过 verify-issue-relationships\.sh 批量验证父子和依赖关系/,
  'propose eval must require batch relationship verification',
);

const readme = read('README.md');
assert.match(
  readme,
  /用 `openspec-buddy propose` 默认创建本地 OpenSpec change 并登记 GitHub Issue/,
  'README workflow must describe propose as creating both local OpenSpec change and GitHub Issue',
);

console.log('propose default artifacts eval passed');
