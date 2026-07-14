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
const projectCoordination = read('skills/openspec-buddy/references/project-coordination.md');
const readme = read('README.md');
const exploreRoutingPath = 'skills/openspec-buddy/references/explore-routing.md';

assert.ok(
  fs.existsSync(path.join(repoRoot, exploreRoutingPath)),
  'manual Buddy must document native explore routing',
);

const exploreRouting = read(exploreRoutingPath);

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

assert.match(
  exploreRouting,
  /unclear intent[\s\S]*grilling[\s\S]*one-question clarification[\s\S]*missing facts[\s\S]*research[\s\S]*primary-source investigation[\s\S]*undecidable interaction or state[\s\S]*prototype[\s\S]*throwaway experiment[\s\S]*active change design issue[\s\S]*openspec-explore/i,
  'explore routing must map intent, facts, solution uncertainty, and active-change design issues',
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
assert.match(
  coreLifecycle,
  /## Explore[\s\S]*read-only[\s\S]*references\/explore-routing\.md/i,
  'core lifecycle must define explore as read-only and route to the detailed reference',
);

console.log('propose acceptance gates eval passed');
