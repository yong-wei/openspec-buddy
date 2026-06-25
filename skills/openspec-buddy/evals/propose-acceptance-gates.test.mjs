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

assert.match(
  buddySkill,
  /EVERY OPENSPEC-BUDDY PHASE MUST START BY RUNNING THE DRIVER SCRIPT/i,
  'openspec-buddy SKILL.md must focus agents on the driver entrypoint',
);
assert.match(
  buddyAutoSkill,
  /EVERY OPENSPEC-BUDDY-AUTO STEP MUST START BY RUNNING THE AUTO DRIVER/i,
  'openspec-buddy-auto SKILL.md must focus agents on the auto driver entrypoint',
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
  /review-response-gate\.sh[\s\S]*request-pr-review\.sh --context-file[\s\S]*Return to the auto driver/i,
  'core apply review-fix loop must require independent review before committing fixes',
);

assert.match(
  buddyAutoSkill,
  /review-fix commits pass independent review/i,
  'auto must forbid implementation threads from checking AC items themselves',
);
assert.match(
  buddyAutoSkill,
  /Receipts do not replace GitHub truth/i,
  'auto must require implementation threads to propose AC satisfaction with evidence',
);
assert.match(
  buddyAutoSkill,
  /buddy-auto-driver\.mjs/,
  'auto review-fix gate must require structured independent review before commit',
);
assert.match(
  executionLoop,
  /Before committing a review-fix diff[\s\S]*independent review/i,
  'execution loop must put independent review before review-fix commits',
);
assert.match(
  executionLoop,
  /check the\s+reviewed AC items in the issue checklist or issue tasks/i,
  'execution loop must allow only reviewer-approved AC/task checkoff after review',
);
assert.match(
  executionLoop,
  /does not block normal OpenSpec `tasks\.md` completion/i,
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

console.log('propose acceptance gates eval passed');
