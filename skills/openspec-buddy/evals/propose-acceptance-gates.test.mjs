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
const executionLoop = read('skills/openspec-buddy-auto/references/execution-loop.md');
const issueTemplate = read('skills/openspec-buddy/references/issue-template.md');
const projectCoordination = read('skills/openspec-buddy/references/project-coordination.md');
const readme = read('README.md');

const proposeSection = buddySkill.match(/### propose\n(?<body>[\s\S]*?)\n### apply/)?.groups?.body;
assert.ok(proposeSection, 'openspec-buddy SKILL.md must contain a propose section');
const applySection = buddySkill.match(/### apply\n(?<body>[\s\S]*?)\n### achieve/)?.groups?.body;
assert.ok(applySection, 'openspec-buddy SKILL.md must contain an apply section');

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
  proposeSection,
  /Each task\s+must reference one or more numbered items such as `AC-[0-9]+`/i,
  'propose must require task-to-AC binding',
);
assert.match(
  proposeSection,
  /Acceptance Checklist[\s\S]*task-to-AC[\s\S]*validate-issue-body\.mjs/i,
  'propose must require machine validation of the Buddy issue body, not metadata parsing only',
);
assert.match(
  proposeSection,
  /openspec\/changes\/<change_id>\/\.buddy\/issue\.md[\s\S]*exact body to validate[\s\S]*gh issue create/i,
  'propose must materialize the GitHub issue body as a local intermediate artifact before creation',
);
assert.match(
  proposeSection,
  /Do not mark an AC\s+complete during `propose`/i,
  'propose must keep AC unchecked until implementation evidence is independently reviewed',
);
assert.match(
  proposeSection,
  /independent proposal review[\s\S]*single-scope[\s\S]*task-to-AC[\s\S]*split/i,
  'propose must require an independent proposal review direction for scope, AC binding, and split decisions',
);
assert.match(
  proposeSection,
  /Compatibility[\s\S]*existing active[\s\S]*archived/i,
  'propose rules must document compatibility with existing active and archived changes',
);
assert.match(
  applySection,
  /Before the first implementation commit[\s\S]*approved_to_commit[\s\S]*approved_ac[\s\S]*rejected_ac[\s\S]*scope_status[\s\S]*regression_risk[\s\S]*required_fixes/i,
  'core apply must require independent AC review before the first implementation commit',
);
assert.match(
  applySection,
  /Before committing a review-fix diff[\s\S]*approved_to_commit[\s\S]*approved_ac[\s\S]*rejected_ac[\s\S]*scope_status[\s\S]*regression_risk[\s\S]*required_fixes[\s\S]*review-response-gate\.sh[\s\S]*isResolved=true/i,
  'core apply review-fix loop must require independent review before committing fixes',
);

assert.match(
  buddyAutoSkill,
  /implementation thread\s+must not check Acceptance Checklist items/i,
  'auto must forbid implementation threads from checking AC items themselves',
);
assert.match(
  buddyAutoSkill,
  /Proposed satisfied: AC-/i,
  'auto must require implementation threads to propose AC satisfaction with evidence',
);
assert.match(
  buddyAutoSkill,
  /approved_to_commit[\s\S]*approved_ac[\s\S]*rejected_ac/i,
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
