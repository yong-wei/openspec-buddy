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
AC coverage: AC-1 automated; AC-2 automated
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
AC coverage: AC-1 verified by diff inspection; AC-2 verified by diff inspection
Manual-only acceptance: none
Rationale: The change only updates static text or mechanical synchronization`);
  assert.equal(result.status, 0, result.stderr);
}

const missingSeam = run("missing-seam", required().replace(/Public seam:.*\n/, "Public seam:\n"));
assert.equal(missingSeam.status, 1);
assert.match(missingSeam.stderr, /Public seam.*required/i);

const missingCoverage = run("missing-coverage", required().replace("AC-2 automated", "no second mapping"));
assert.equal(missingCoverage.status, 1);
assert.match(missingCoverage.stderr, /AC-2.*not mapped/i);

const manualOnly = run("manual-only", required().replace(
  "AC coverage: AC-1 automated; AC-2 automated\nManual-only acceptance: none",
  "AC coverage: AC-1 automated\nManual-only acceptance: AC-2 requires visual confirmation of terminal rendering",
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

const unknownEnum = run("unknown-enum", required("risky"));
assert.equal(unknownEnum.status, 1);
assert.match(unknownEnum.stderr, /Change class.*unsupported/i);

console.log("testing strategy validation tests passed");
