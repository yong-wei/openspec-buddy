import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const validator = path.join(repoRoot, "skills/openspec-buddy/scripts/validate-testing-strategy.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-testing-strategy-"));

function files(name, strategy, issue = "- [ ] AC-1: First outcome.\n- [ ] AC-2: Second outcome.\n") {
  const designPath = path.join(tmpDir, `${name}-design.md`);
  const issuePath = path.join(tmpDir, `${name}-issue.md`);
  fs.writeFileSync(designPath, `# Design\n\n## Testing Strategy\n${strategy}\n\n## Risks\n\nNone.\n`);
  fs.writeFileSync(issuePath, issue);
  return [designPath, issuePath];
}

function run(name, strategy, issue) {
  return spawnSync(process.execPath, [validator, ...files(name, strategy, issue)], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const required = (changeClass = "behavioral") => `Change class: ${changeClass}
Seam status: required
Public behavior: CLI rejects invalid testing contracts
Public seam: node skills/openspec-buddy/evals/validate-testing-strategy.test.mjs
Existing seam reused: Node assertion eval runner
AC coverage: AC-1: public CLI test; AC-2: integration seam test
Manual-only acceptance: none
Rationale: Exercises the public CLI exit status and diagnostics`;

for (const changeClass of ["behavioral", "medium-risk", "high-risk"]) {
  const result = run(`${changeClass}-required`, required(changeClass));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Testing strategy valid/);
}

for (const changeClass of ["documentation", "mechanical"]) {
  const result = run(`${changeClass}-not-applicable`, `Change class: ${changeClass}
Seam status: not-applicable
Public behavior: none
Public seam: rtk git diff --check
Existing seam reused: none
AC coverage: AC-1: verified by diff inspection; AC-2: verified by diff inspection
Manual-only acceptance: none
Rationale: The change only updates static text or mechanical synchronization`);
  assert.equal(result.status, 0, result.stderr);
}

const missingSeam = run("missing-seam", required().replace(/Public seam:.*\n/, "Public seam:\n"));
assert.equal(missingSeam.status, 1);
assert.match(missingSeam.stderr, /Public seam.*must not be blank/i);

const missingCoverage = run("missing-coverage", required().replace("; AC-2: integration seam test", ""));
assert.equal(missingCoverage.status, 1);
assert.match(missingCoverage.stderr, /AC-2.*not mapped/i);

const manualOnly = run("manual-only", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test\nManual-only acceptance: none",
  "AC coverage: AC-1: public CLI test\nManual-only acceptance: AC-2: visual confirmation of terminal rendering",
));
assert.equal(manualOnly.status, 0, manualOnly.stderr);

for (const placeholder of ["TBD", "TODO", "decide during implementation"]) {
  const result = run(`placeholder-${placeholder.replaceAll(" ", "-")}`, required().replace(
    "Public seam: node skills/openspec-buddy/evals/validate-testing-strategy.test.mjs",
    `Public seam: ${placeholder}`,
  ));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Public seam.*placeholder/i);
}

const duplicate = run("duplicate", `${required()}\nPublic seam: another eval`);
assert.equal(duplicate.status, 1);
assert.match(duplicate.stderr, /Public seam.*duplicate/i);

for (const field of [
  "Change class",
  "Seam status",
  "Public behavior",
  "Public seam",
  "Existing seam reused",
  "AC coverage",
  "Manual-only acceptance",
  "Rationale",
]) {
  const blank = run(`blank-${field.replaceAll(" ", "-")}`, required().replace(new RegExp(`${field}:.*`), `${field}:   `));
  assert.equal(blank.status, 1, `${field} should reject blank values`);
  assert.match(blank.stderr, new RegExp(`${field}.*must not be blank`, "i"));
}

for (const field of ["Public behavior", "Public seam"]) {
  const none = run(`required-none-${field.replaceAll(" ", "-")}`, required().replace(new RegExp(`${field}:.*`), `${field}: none`));
  assert.equal(none.status, 1);
  assert.match(none.stderr, new RegExp(`${field}.*must not be none`, "i"));
}

const manualEntries = run("manual-entries", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test\nManual-only acceptance: none",
  "AC coverage: AC-1: public CLI test\nManual-only acceptance: AC-2: inspect terminal output; AC-3: confirm screen-reader announcement",
), "- [ ] AC-1: First.\n- [ ] AC-2: Second.\n- [ ] AC-3: Third.\n");
assert.equal(manualEntries.status, 0, manualEntries.stderr);

const isolatedManualReason = run("isolated-manual-reason", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test\nManual-only acceptance: none",
  "AC coverage: AC-1: public CLI test\nManual-only acceptance: AC-2: AC-3; AC-3: visual inspection",
), "- [ ] AC-1: First.\n- [ ] AC-2: Second.\n- [ ] AC-3: Third.\n");
assert.equal(isolatedManualReason.status, 1);
assert.match(isolatedManualReason.stderr, /AC-2.*reason/i);

const duplicateManual = run("duplicate-manual", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test\nManual-only acceptance: none",
  "AC coverage: AC-1: public CLI test\nManual-only acceptance: AC-2: inspect output; AC-2: inspect rendering",
));
assert.equal(duplicateManual.status, 1);
assert.match(duplicateManual.stderr, /AC-2.*duplicate manual-only/i);

const unknownManual = run("unknown-manual", required().replace(
  "Manual-only acceptance: none",
  "Manual-only acceptance: AC-9: inspect output",
));
assert.equal(unknownManual.status, 1);
assert.match(unknownManual.stderr, /AC-9.*unknown/i);

const overlappingMapping = run("overlapping-mapping", required().replace(
  "Manual-only acceptance: none",
  "Manual-only acceptance: AC-2: inspect output",
));
assert.equal(overlappingMapping.status, 1);
assert.match(overlappingMapping.stderr, /AC-2.*both AC coverage and Manual-only acceptance/i);

const multipleCoverage = run("multiple-coverage", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test",
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test; AC-3: parser boundary test",
), "- [ ] AC-1: First.\n- [ ] AC-2: Second.\n- [ ] AC-3: Third.\n");
assert.equal(multipleCoverage.status, 0, multipleCoverage.stderr);

const duplicateCoverage = run("duplicate-coverage", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test",
  "AC coverage: AC-1: public CLI test; AC-1: another test; AC-2: integration seam test",
));
assert.equal(duplicateCoverage.status, 1);
assert.match(duplicateCoverage.stderr, /AC-1.*duplicate AC coverage/i);

const unknownCoverage = run("unknown-coverage", required().replace(
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test",
  "AC coverage: AC-1: public CLI test; AC-2: integration seam test; AC-9: unknown test",
));
assert.equal(unknownCoverage.status, 1);
assert.match(unknownCoverage.stderr, /AC-9.*unknown AC coverage/i);

for (const invalidReason of ["none", "n/a", "not-applicable", "---", "AC-3", "TODO", "not covered"]) {
  const slug = invalidReason.replaceAll(/[^a-z0-9]+/gi, "-");
  const invalidCoverage = run(`invalid-coverage-${slug}`, required().replace(
    "AC-2: integration seam test",
    `AC-2: ${invalidReason}`,
  ));
  assert.equal(invalidCoverage.status, 1, `coverage reason ${invalidReason} should fail`);
  assert.match(invalidCoverage.stderr, /AC-2.*AC coverage.*reason/i);

  const invalidManual = run(`invalid-manual-${slug}`, required().replace(
    "AC coverage: AC-1: public CLI test; AC-2: integration seam test\nManual-only acceptance: none",
    `AC coverage: AC-1: public CLI test\nManual-only acceptance: AC-2: ${invalidReason}`,
  ));
  assert.equal(invalidManual.status, 1, `manual reason ${invalidReason} should fail`);
  assert.match(invalidManual.stderr, /AC-2.*Manual-only acceptance.*reason/i);
}

const missingSectionDesign = path.join(tmpDir, "missing-section-design.md");
const missingSectionIssue = path.join(tmpDir, "missing-section-issue.md");
fs.writeFileSync(missingSectionDesign, "# Design\n\nNo testing contract.\n");
fs.writeFileSync(missingSectionIssue, "- [ ] AC-1: Outcome.\n");
const missingSection = spawnSync(process.execPath, [validator, missingSectionDesign, missingSectionIssue], {
  cwd: repoRoot,
  encoding: "utf8",
});
assert.equal(missingSection.status, 1);
assert.match(missingSection.stderr, /Testing Strategy.*missing/i);

const duplicateSection = run("duplicate-section", `${required()}\n\n## Testing Strategy\n${required()}`);
assert.equal(duplicateSection.status, 1);
assert.match(duplicateSection.stderr, /Testing Strategy.*duplicate/i);

const unknownEnum = run("unknown-enum", required("risky"));
assert.equal(unknownEnum.status, 1);
assert.match(unknownEnum.stderr, /Change class.*unsupported/i);

console.log("testing strategy validation tests passed");
