import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const skill = read('skills/openspec-buddy/SKILL.md');
const lifecycle = read('skills/openspec-buddy/references/core-lifecycle.md');
const driver = read('skills/openspec-buddy/scripts/buddy-driver.mjs');
const template = read('skills/openspec-buddy/references/issue-template.md');
const projectCoordination = read('skills/openspec-buddy/references/project-coordination.md');
const statusFlow = read('skills/openspec-buddy/references/status-flow.md');
const evals = JSON.parse(read('skills/openspec-buddy/evals/evals.json'));

assert.match(skill, /one stable `change_id` mapping/i);
assert.match(skill, /buddy-driver\.mjs --mode propose --change <change_id>/i);
assert.match(lifecycle, /commit and push[\s\S]*configured base[\s\S]*branch[\s\S]*Create one open GitHub Issue/i);
assert.match(lifecycle, /contains exactly[\s\S]*one mapping marker/i);
assert.match(lifecycle, /`type:change` and `status:ready`/i);
assert.match(lifecycle, /native `blockedBy` relationship/i);
assert.match(lifecycle, /concurrent duplicate[\s\S]*close the newly created Issue/i);
assert.match(lifecycle, /lightweight single-line marker[\s\S]*legacy hidden metadata[\s\S]*YAML front[\s\S]*matter/i);
assert.match(template, /lightweight marker, legacy hidden metadata, and YAML front matter/i);
assert.match(lifecycle, /not default propose gates/i);
assert.match(projectCoordination, /default lightweight[\s\S]*does not require Project/i);
assert.match(statusFlow, /default lightweight propose[\s\S]*does not require[\s\S]*Project/i);
assert.match(statusFlow, /lightweight `change_id` mapping/i);
assert.match(template, /<!-- openspec-buddy change_id: example-change-id -->/);
assert.doesNotMatch(driver, /validate-(?:triage|issue-body|proposal-shape|testing-strategy)\.mjs/);

const propose = evals.evals.find((entry) => entry.prompt.includes('openspec-buddy propose：'));
assert.ok(propose);
assert.match(propose.expected_output, /先提交并推送到基础分支/);
assert.match(propose.expected_output, /只要求 type:change 与 status:ready/);
assert.match(propose.expected_output, /不使用 Project 或完整标签矩阵/);

console.log('propose default artifacts eval passed');
