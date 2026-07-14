import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const validator = path.join(repoRoot, "skills/openspec-buddy/scripts/validate-issue-body.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-issue-body-"));

function writeBody(name, body) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, body);
  return file;
}

function runValidator(file) {
  return spawnSync(process.execPath, [validator, file], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENSPEC_BUDDY_BASE_BRANCH: "integration",
    },
  });
}

function runValidatorDirect(file, extraEnv = {}) {
  return spawnSync(validator, [file], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENSPEC_BUDDY_BASE_BRANCH: "integration",
      ...extraEnv,
    },
  });
}

const validBody = `---
change_id: checklist-gate
claim_branch: checklist-gate
series: workflow
coupling_group: none
execution_mode: isolated
base_branch: integration
required_branch:
depends_on: []
parent_issue:
blocked_by: []
blocking: []
openspec_path: openspec/changes/checklist-gate
risk: medium
area: tooling
---

## Goal

Make checklist omissions machine-detectable.

## Scope

- Validate proposed Buddy issue bodies.

## Out of Scope

- Rewrite legacy issues.

## Acceptance Checklist

- [ ] AC-1: Proposed issues have reviewer-owned acceptance criteria. Owner: independent reviewer.
  Evidence: validate-issue-body.mjs accepts this body.

## Tasks

- [ ] Task 1: Add the issue-body validator.
  Covers: AC-1
  Acceptance: the validator rejects missing task-to-AC binding.
  Evidence: node skills/openspec-buddy/evals/propose-issue-body-validation.test.mjs
  Reviewer Check: confirm AC-1 is only checkable after independent review.
`;

const valid = runValidator(writeBody("valid.md", validBody));
assert.equal(valid.status, 0, valid.stderr);
assert.match(valid.stdout, /Buddy issue body validation passed/);

const direct = runValidatorDirect(writeBody("valid-direct.md", validBody));
assert.equal(direct.status, 0, direct.stderr);
assert.match(direct.stdout, /Buddy issue body validation passed/);

const issueTemplate = fs.readFileSync(path.join(repoRoot, "skills/openspec-buddy/references/issue-template.md"), "utf8");
const markdownFences = [...issueTemplate.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map((match) => match[1]);
assert.match(markdownFences[0] ?? "", /^## Testing Strategy\n/, "Testing Strategy may precede the Issue body fence");
const templateBody = markdownFences.find((body) => /^---\n[\s\S]*?^change_id:/m.test(body));
assert.ok(templateBody, "issue template must contain a markdown Issue body fence with change_id front matter");
assert.match(templateBody, /^---\n/, "Issue body fixture must select YAML front matter, not the Testing Strategy fence");
assert.doesNotMatch(templateBody, /^## Testing Strategy\n/, "Testing Strategy fence must not be validated as the Issue body");
const templateValidation = runValidatorDirect(writeBody("template.md", templateBody), {
  OPENSPEC_BUDDY_BASE_BRANCH: "example-base-branch",
});
assert.equal(templateValidation.status, 0, templateValidation.stderr);

const missingChecklist = runValidator(writeBody("missing-checklist.md", validBody.replace(/## Acceptance Checklist[\s\S]*?## Tasks/, "## Tasks")));
assert.notEqual(missingChecklist.status, 0);
assert.match(missingChecklist.stderr, /Missing required section: Acceptance Checklist/);

const missingCovers = runValidator(writeBody("missing-covers.md", validBody.replace(/\n  Covers: AC-1/, "")));
assert.notEqual(missingCovers.status, 0);
assert.match(missingCovers.stderr, /Task 1 missing Covers/);

const unknownAc = runValidator(writeBody("unknown-ac.md", validBody.replace("Covers: AC-1", "Covers: AC-2")));
assert.notEqual(unknownAc.status, 0);
assert.match(unknownAc.stderr, /Task 1 references unknown AC-2/);

const missingTaskEvidence = runValidator(writeBody("missing-task-evidence.md", validBody.replace(/\n  Evidence: node skills\/openspec-buddy\/evals\/propose-issue-body-validation\.test\.mjs/, "")));
assert.notEqual(missingTaskEvidence.status, 0);
assert.match(missingTaskEvidence.stderr, /Task 1 missing Evidence/);

const checkedAc = runValidator(writeBody("checked-ac.md", validBody.replace("- [ ] AC-1:", "- [x] AC-1:")));
assert.notEqual(checkedAc.status, 0);
assert.match(checkedAc.stderr, /AC-1 must remain unchecked during propose/);

const orphanAcBody = validBody.replace(
  "- [ ] AC-1: Proposed issues have reviewer-owned acceptance criteria. Owner: independent reviewer.\n  Evidence: validate-issue-body.mjs accepts this body.",
  "- [ ] AC-1: Proposed issues have reviewer-owned acceptance criteria. Owner: independent reviewer.\n  Evidence: validate-issue-body.mjs accepts this body.\n- [ ] AC-2: Every AC is covered by at least one task. Owner: independent reviewer.\n  Evidence: validator rejects orphan ACs.",
);
const orphanAc = runValidator(writeBody("orphan-ac.md", orphanAcBody));
assert.notEqual(orphanAc.status, 0);
assert.match(orphanAc.stderr, /AC-2 is not covered by any task/);

const duplicateAcBody = validBody.replace(
  "- [ ] AC-1: Proposed issues have reviewer-owned acceptance criteria. Owner: independent reviewer.\n  Evidence: validate-issue-body.mjs accepts this body.",
  "- [ ] AC-1: Proposed issues have reviewer-owned acceptance criteria. Owner: independent reviewer.\n  Evidence: validate-issue-body.mjs accepts this body.\n- [ ] AC-1: Duplicate acceptance criterion. Owner: independent reviewer.\n  Evidence: validator rejects duplicates.",
);
const duplicateAc = runValidator(writeBody("duplicate-ac.md", duplicateAcBody));
assert.notEqual(duplicateAc.status, 0);
assert.match(duplicateAc.stderr, /Duplicate AC id: AC-1/);

const nonSequentialAcBody = validBody.replaceAll("AC-1", "AC-3");
const nonSequentialAc = runValidator(writeBody("non-sequential-ac.md", nonSequentialAcBody));
assert.notEqual(nonSequentialAc.status, 0);
assert.match(nonSequentialAc.stderr, /Expected AC-1 but found AC-3/);

console.log("propose issue body validation tests passed");
