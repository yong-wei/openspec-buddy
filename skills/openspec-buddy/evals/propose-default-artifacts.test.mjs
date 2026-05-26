import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const skill = read('skills/openspec-buddy/SKILL.md');
const proposeSection = skill.match(/### propose\n(?<body>[\s\S]*?)\n### apply/)?.groups?.body;
assert.ok(proposeSection, 'SKILL.md must contain a propose section before apply');

assert.match(
  proposeSection,
  /Invoke `openspec-propose`[\s\S]*local OpenSpec change under\s+`openspec\/changes\/<change_id>`/,
  'propose must default to creating the local OpenSpec change via openspec-propose',
);
assert.doesNotMatch(
  proposeSection,
  /If the user also asked to create local OpenSpec artifacts/,
  'local OpenSpec artifacts must not be optional in propose mode',
);
assert.match(
  proposeSection,
  /all applicable coordination labels[\s\S]*Project `Status` to `Todo`/,
  'propose-created issues must default to full labels and coordination state',
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

const readme = read('README.md');
assert.match(
  readme,
  /用 `openspec-buddy propose` 默认创建本地 OpenSpec change 并登记 GitHub Issue/,
  'README workflow must describe propose as creating both local OpenSpec change and GitHub Issue',
);

console.log('propose default artifacts eval passed');
