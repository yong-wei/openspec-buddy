import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const buddySkill = read('skills/openspec-buddy/SKILL.md');
const buddyAutoSkill = read('skills/openspec-buddy-auto/SKILL.md');
const coreLifecycle = read('skills/openspec-buddy/references/core-lifecycle.md');
const autoDriverStates = read('skills/openspec-buddy-auto/references/driver-states.md');
const executionLoop = read('skills/openspec-buddy-auto/references/execution-loop.md');
const issueTemplate = read('skills/openspec-buddy/references/issue-template.md');
const issueRelationships = read('skills/openspec-buddy/references/issue-relationships.md');
const projectCoordination = read('skills/openspec-buddy/references/project-coordination.md');
const readme = read('README.md');
const exploreRoutingPath = 'skills/openspec-buddy/references/explore-routing.md';
const buddyDriver = read('skills/openspec-buddy/scripts/buddy-driver.mjs');
const autoDriver = read('skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs');
const autoEvals = JSON.parse(read('skills/openspec-buddy-auto/evals/evals.json'));

const testingStrategyTemplate = `## Testing Strategy
Change class: behavioral | medium-risk | high-risk | documentation | mechanical
Seam status: required | not-applicable
Public behavior: <observable behavior or none>
Public seam: <highest public seam or explicit verification method>
Existing seam reused: <existing test seam or none>
AC coverage: AC-1: public seam evidence; AC-2: integration seam evidence
Manual-only acceptance: AC-3: reason
Rationale: <why this seam is sufficient or why no public seam applies>`;

assert.ok(
  fs.existsSync(path.join(repoRoot, exploreRoutingPath)),
  'manual Buddy must document native explore routing',
);

const exploreRouting = read(exploreRoutingPath);

assert.match(
  buddyDriver,
  /validate-issue-body\.mjs[\s\S]*validate-proposal-shape\.mjs[\s\S]*validate-testing-strategy\.mjs[\s\S]*design\.md/,
  'manual propose must validate the approved testing strategy after issue-body and proposal-shape validation',
);
assert.doesNotMatch(
  autoDriver,
  /validate-testing-strategy\.mjs/,
  'testing strategy validation must not alter Buddy Auto compatibility paths',
);
assert.ok(
  issueTemplate.includes(testingStrategyTemplate),
  'issue template reference must include the exact single-line Testing Strategy contract',
);
assert.match(
  coreLifecycle,
  /behavioral, `medium-risk`, and `high-risk`[\s\S]*`Seam status: required`[\s\S]*documentation and mechanical[\s\S]*`not-applicable`[\s\S]*verification method[\s\S]*rationale/i,
  'propose guidance must define the testing strategy applicability matrix',
);
assert.match(
  coreLifecycle,
  /Every issue AC[\s\S]*exactly once[\s\S]*`AC coverage`[\s\S]*`Manual-only acceptance`[\s\S]*semicolon/i,
  'propose guidance must explain the exact mutually exclusive AC maps',
);
assert.match(
  coreLifecycle,
  /already approved[\s\S]*public seam[\s\S]*(?:must not|never)[\s\S]*product-level seam selection/i,
  'apply must consume the approved seam without selecting it again',
);
assert.match(
  coreLifecycle,
  /Matt TDD[\s\S]*implementation method only[\s\S]*red-before-green[\s\S]*public-interface tests[\s\S]*one vertical cycle at a time[\s\S]*minimal\s+implementation/i,
  'apply must document optional Matt TDD and the Buddy-native fallback',
);
assert.match(
  executionLoop,
  /approved testing seam[\s\S]*(?:must not|never)[\s\S]*product-level seam selection/i,
  'Auto must consume the approved testing seam without restarting selection',
);
assert.match(
  executionLoop,
  /provider availability[\s\S]*(?:must not|never)[\s\S]*Buddy state[\s\S]*receipts[\s\S]*artifacts[\s\S]*gates/i,
  'optional TDD provider availability must not alter deterministic Auto state',
);
assert.doesNotMatch(
  `${coreLifecycle}\n${executionLoop}`,
  /all refactoring (?:must )?waits? for review/i,
  'Matt refactoring guidance must not become a Buddy lifecycle gate',
);
assert.ok(
  autoEvals.evals.some(({ expected_output: output }) =>
    /approved testing seam/i.test(output)
    && /never restarts product-level seam selection/i.test(output)
    && /provider availability/i.test(output)
    && /receipts/i.test(output)),
  'Auto eval contract must preserve approved seam selection and provider-neutral receipts',
);

assert.match(
  buddySkill,
  /EVERY OPENSPEC-BUDDY PHASE MUST START BY RUNNING THE DRIVER SCRIPT/i,
  'openspec-buddy SKILL.md must focus agents on the driver entrypoint',
);
assert.match(
  buddyAutoSkill,
  /EVERY OPENSPEC-BUDDY-AUTO STEP MUST START BY RUNNING THE AUTO CONTROLLER/i,
  'openspec-buddy-auto SKILL.md must focus agents on the auto controller entrypoint',
);

assert.match(
  issueTemplate,
  /## Acceptance Checklist[\s\S]*AC-1[\s\S]*Owner: independent reviewer/i,
  'issue template must require numbered AC checklist items owned by an independent reviewer',
);
assert.match(
  issueTemplate,
  /## Tasks[\s\S]*Covers: AC-[0-9][\s\S]*Evidence:[\s\S]*Reviewer Check:/i,
  'issue template tasks must bind to AC ids and include evidence plus reviewer checks',
);
assert.match(
  coreLifecycle,
  /every task has `Covers: AC-\*`, `Acceptance:`, `Evidence:`, and\s+`Reviewer Check:`/i,
  'propose must require task-to-AC binding',
);
assert.match(
  coreLifecycle,
  /validate-issue-body\.mjs[\s\S]*Acceptance Checklist[\s\S]*task-to-AC/i,
  'propose must require machine validation of the Buddy issue body, not metadata parsing only',
);
assert.match(
  coreLifecycle,
  /openspec\/changes\/<change_id>\/\.buddy\/issue\.md[\s\S]*exact GitHub issue body/i,
  'propose must materialize the GitHub issue body as a local intermediate artifact before creation',
);
assert.match(
  coreLifecycle,
  /only an independent reviewer may approve which checklist items are checked/i,
  'propose must keep AC unchecked until implementation evidence is independently reviewed',
);
for (const field of [
  'split_status',
  'vertical_slice_status',
  'blocking_edges_status',
  'wide_refactor_strategy',
  'children',
]) {
  assert.match(
    coreLifecycle,
    new RegExp(`\\b${field}\\b`),
    `proposal review guidance must document ${field}`,
  );
}
assert.match(
  coreLifecycle,
  /independently claimable,\s+testable,\s+reviewable,\s+and deliverable as one PR/i,
  'each series child must pass the independence test',
);
assert.match(
  coreLifecycle,
  /database, API, UI, and test steps[\s\S]*same change/i,
  'vertical implementation steps may remain tasks within one change',
);
assert.match(
  coreLifecycle,
  /expand-migrate-contract[\s\S]*pseudo-slices[\s\S]*pass independently/i,
  'broad mechanical migrations must use the explicit strategy instead of invalid pseudo-slices',
);
assert.match(
  issueRelationships,
  /series-required[\s\S]*tracking parent[\s\S]*child changes/i,
  'series-required proposals must create a tracking parent and executable child changes',
);
assert.match(
  issueRelationships,
  /native GitHub `blockedBy`[\s\S]*authoritative[\s\S]*metadata[\s\S]*mirror/i,
  'native blockedBy relationships must remain authoritative over Buddy metadata',
);
assert.match(
  issueTemplate,
  /\.buddy\/proposal-review\.yaml[\s\S]*split_status:[\s\S]*vertical_slice_status:[\s\S]*blocking_edges_status:[\s\S]*wide_refactor_strategy:[\s\S]*children:/i,
  'issue template reference must include a complete proposal-review manifest example',
);
const issueFrontMatter = issueTemplate.match(/```markdown\n---\n([\s\S]*?)\n---/)?.[1] ?? '';
for (const field of [
  'split_status',
  'vertical_slice_status',
  'blocking_edges_status',
  'wide_refactor_strategy',
  'children',
]) {
  assert.doesNotMatch(
    issueFrontMatter,
    new RegExp(`^${field}:`, 'm'),
    `${field} belongs in proposal-review.yaml, not Issue front matter`,
  );
}
assert.match(
  buddySkill,
  /Do not check Acceptance Checklist items from the implementation thread/i,
  'propose must require an independent proposal review direction for scope, AC binding, and split decisions',
);
assert.match(
  buddySkill,
  /references\/core-lifecycle\.md/,
  'main skill must link to the detailed lifecycle reference',
);
assert.match(
  buddyAutoSkill,
  /review-fix commits pass independent review/i,
  'core apply must require independent AC review before the first implementation commit',
);
assert.match(
  autoDriverStates,
  /review-fix-handoff -> response-gate -> current-head-review-request -> review-wait/i,
  'core apply review-fix loop must require response gate before current-head review waiting',
);

assert.match(
  buddyAutoSkill,
  /review-fix commits pass independent review/i,
  'auto must forbid implementation threads from checking AC items themselves',
);
assert.match(
  buddyAutoSkill,
  /These files do not replace GitHub truth/i,
  'auto must require implementation threads to propose AC satisfaction with evidence',
);
assert.match(
  buddyAutoSkill,
  /buddy-auto\.mjs/,
  'auto review-fix gate must route through the controller entrypoint',
);
assert.match(
  executionLoop,
  /must obtain independent review before committing the review-fix diff/i,
  'execution loop must put independent review before review-fix commits',
);
assert.match(
  executionLoop,
  /Independent review decides\s+which AC items may be checked/i,
  'execution loop must allow only reviewer-approved AC/task checkoff after review',
);
assert.match(
  executionLoop,
  /OpenSpec task progress must reach `remaining: 0`/i,
  'execution loop must distinguish issue AC checkoff from OpenSpec tasks.md completion',
);

assert.match(
  projectCoordination,
  /complete code review[\s\S]*correctness[\s\S]*regression[\s\S]*maintainability/i,
  'review request guidance must preserve broad code-review scope',
);
assert.match(
  projectCoordination,
  /additional checks[\s\S]*Acceptance Checklist[\s\S]*unregistered requirement/i,
  'review request guidance must add AC and scope checks as additional reviewer duties',
);
assert.doesNotMatch(
  projectCoordination,
  /only check|只检查/i,
  'review request guidance must not narrow Codex to checklist-only review',
);
assert.match(
  readme,
  /完整代码审查[\s\S]*Acceptance Checklist[\s\S]*未登记需求/,
  'README review request example must preserve full review and add AC/scope checks',
);

for (const route of [
  '| Unclear intent | `intent` | `grilling` | Native one-question clarification |',
  '| Missing facts | `facts` | `research` | Native primary-source investigation |',
  '| Undecidable interaction or state | `interaction-state` | `prototype` | Native throwaway experiment |',
  '| Active change design issue | `active-change-design` | Native `openspec-explore` | Native `openspec-explore` |',
]) {
  assert.ok(exploreRouting.includes(route), `explore routing must include exact route: ${route}`);
}
assert.ok(
  exploreRouting.includes('buddy-driver.mjs --mode explore --explore-question <intent|facts|interaction-state|active-change-design>'),
  'explore routing must document the legal driver invocation',
);
assert.match(
  exploreRouting,
  /unavailable[\s\S]*native fallback/i,
  'every optional discovery method must have a native fallback',
);
assert.match(
  exploreRouting,
  /read-only[\s\S]*(?:must not|do not)[\s\S]*(?:mutate|write|create|edit|commit|push)/i,
  'explore must explicitly remain read-only',
);
assert.match(
  exploreRouting,
  /Buddy Auto[\s\S]*(?:excluded|does not|must not)[\s\S]*explore/i,
  'Buddy Auto must be explicitly excluded from explore routing',
);
assert.match(
  buddySkill,
  /references\/explore-routing\.md/,
  'main skill must link to the explore routing reference',
);
assert.ok(coreLifecycle.includes('## Explore'), 'core lifecycle must define Explore');
assert.ok(
  coreLifecycle.includes('buddy-driver.mjs --mode explore --explore-question <intent|facts|interaction-state|active-change-design>'),
  'core lifecycle must document the legal Explore invocation',
);
assert.match(coreLifecycle, /Explore is a read-only manual Buddy phase/i, 'core lifecycle must keep Explore read-only');
assert.ok(
  coreLifecycle.includes('`references/explore-routing.md`'),
  'core lifecycle must route to the detailed Explore reference',
);

console.log('propose acceptance gates eval passed');
