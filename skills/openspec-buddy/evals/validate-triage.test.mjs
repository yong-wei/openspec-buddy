import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const validator = path.join(repoRoot, "skills/openspec-buddy/scripts/validate-triage.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-triage-"));
const issueUpdatedAt = "2026-07-14T08:00:00Z";
const baseSha = "0123456789abcdef0123456789abcdef01234567";

function triage(disposition = "executable") {
  return {
    subject: { issue: 42, change_id: "demo-change" },
    truth: {
      problem_reproduced: "yes",
      evidence: ["Failing CLI fixture reproduces the reported behavior"],
    },
    duplication: {
      existing_implementation: "none",
      conflicting_specs: [],
      active_changes: [],
      superseded_by: null,
    },
    readiness: {
      information: "sufficient",
      disposition,
      reason: "Repository evidence is sufficient for this disposition",
    },
    binding: {
      issue_updated_at: issueUpdatedAt,
      base_sha: baseSha,
      generated_at: "2026-07-14T08:05:00Z",
    },
  };
}

function run(name, document, ...args) {
  const file = path.join(tmpDir, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
  return spawnSync(process.execPath, [validator, file, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

for (const disposition of ["executable", "series-parent", "needs-human", "close"]) {
  const result = run(disposition, triage(disposition));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { disposition });
}

const claimedBeforeChangeAssignment = triage();
claimedBeforeChangeAssignment.subject.change_id = "";
const claimedBeforeChangeResult = run("claimed-before-change-assignment", claimedBeforeChangeAssignment);
assert.equal(claimedBeforeChangeResult.status, 0, claimedBeforeChangeResult.stderr);

const blocked = triage("blocked");
blocked.duplication.active_changes = ["dependency-change"];
blocked.readiness.reason = "dependency-change must complete first";
const blockedResult = run("blocked-dependency", blocked);
assert.equal(blockedResult.status, 0, blockedResult.stderr);
assert.deepEqual(JSON.parse(blockedResult.stdout), { disposition: "blocked" });

const wrongIssueResult = run("wrong-issue-identity", triage(), "--issue", "99", "--change-id", "demo-change");
assert.equal(wrongIssueResult.status, 1);
assert.match(wrongIssueResult.stderr, /subject\.issue: identity mismatch; expected 99/);

const wrongChangeResult = run("wrong-change-identity", triage(), "--issue", "42", "--change-id", "other-change");
assert.equal(wrongChangeResult.status, 1);
assert.match(wrongChangeResult.stderr, /subject\.change_id: identity mismatch; expected other-change/);

const localWithIssue = triage();
localWithIssue.binding.issue_updated_at = issueUpdatedAt;
const localWithIssueResult = run("local-with-issue", localWithIssue, "--issue", "local", "--change-id", "demo-change");
assert.equal(localWithIssueResult.status, 1);
assert.match(localWithIssueResult.stderr, /subject\.issue: identity mismatch; expected local/);

const noEvidence = triage();
noEvidence.truth.evidence = [];
const noEvidenceResult = run("missing-evidence", noEvidence);
assert.equal(noEvidenceResult.status, 1);
assert.match(noEvidenceResult.stderr, /truth\.evidence.*at least one/i);

const staleIssueResult = run(
  "stale-issue",
  triage(),
  "--issue-updated-at",
  "2026-07-14T09:00:00Z",
);
assert.equal(staleIssueResult.status, 1);
assert.match(staleIssueResult.stderr, /binding\.issue_updated_at.*stale/i);

const staleBaseResult = run(
  "stale-base",
  triage(),
  "--base-sha",
  "fedcba9876543210fedcba9876543210fedcba98",
);
assert.equal(staleBaseResult.status, 1);
assert.match(staleBaseResult.stderr, /binding\.base_sha.*stale/i);

const issueWithoutTimestamp = triage();
issueWithoutTimestamp.binding.issue_updated_at = null;
const issueWithoutTimestampResult = run("issue-without-timestamp", issueWithoutTimestamp);
assert.equal(issueWithoutTimestampResult.status, 1);
assert.match(issueWithoutTimestampResult.stderr, /binding\.issue_updated_at.*non-null.*issue/i);

const localWithTimestamp = triage();
localWithTimestamp.subject.issue = null;
const localWithTimestampResult = run("local-with-timestamp", localWithTimestamp);
assert.equal(localWithTimestampResult.status, 1);
assert.match(localWithTimestampResult.stderr, /binding\.issue_updated_at.*null.*local/i);

const localTriage = triage();
localTriage.subject.issue = null;
localTriage.binding.issue_updated_at = null;
const localTriageResult = run("local-triage", localTriage);
assert.equal(localTriageResult.status, 0, localTriageResult.stderr);

for (const invalidTimestamp of [
  "2026-02-30T08:00:00Z",
  "2026-07-14T08:00:00",
  "2026-07-14 08:00:00Z",
  "2026-07-14T25:00:00Z",
  "1740000000000",
]) {
  const invalidIssueTime = triage();
  invalidIssueTime.binding.issue_updated_at = invalidTimestamp;
  const invalidIssueTimeResult = run(`invalid-issue-time-${invalidTimestamp.replaceAll(/[^a-z0-9]+/gi, "-")}`, invalidIssueTime);
  assert.equal(invalidIssueTimeResult.status, 1, `${invalidTimestamp} should fail`);
  assert.match(invalidIssueTimeResult.stderr, /binding\.issue_updated_at.*RFC3339/i);

  const invalidGeneratedTime = triage();
  invalidGeneratedTime.binding.generated_at = invalidTimestamp;
  const invalidGeneratedTimeResult = run(`invalid-generated-time-${invalidTimestamp.replaceAll(/[^a-z0-9]+/gi, "-")}`, invalidGeneratedTime);
  assert.equal(invalidGeneratedTimeResult.status, 1, `${invalidTimestamp} should fail`);
  assert.match(invalidGeneratedTimeResult.stderr, /binding\.generated_at.*RFC3339/i);
}

for (const validTimestamp of ["2026-07-14T08:00:00.123Z", "2026-07-14T16:00:00+08:00"]) {
  const validTime = triage();
  validTime.binding.issue_updated_at = validTimestamp;
  validTime.binding.generated_at = validTimestamp;
  const validTimeResult = run(`valid-time-${validTimestamp.replaceAll(/[^a-z0-9]+/gi, "-")}`, validTime);
  assert.equal(validTimeResult.status, 0, validTimeResult.stderr);
}

const unknownDisposition = triage();
unknownDisposition.readiness.disposition = "ready-for-agent";
const unknownResult = run("unknown-disposition", unknownDisposition);
assert.equal(unknownResult.status, 1);
assert.match(unknownResult.stderr, /readiness\.disposition.*executable.*series-parent.*needs-human.*blocked.*close/i);

const missingField = triage();
delete missingField.duplication.superseded_by;
const missingFieldResult = run("missing-field", missingField);
assert.equal(missingFieldResult.status, 1);
assert.match(missingFieldResult.stderr, /duplication\.superseded_by.*missing/i);

const invalidEnum = triage();
invalidEnum.truth.problem_reproduced = "unknown";
const invalidEnumResult = run("invalid-enum", invalidEnum);
assert.equal(invalidEnumResult.status, 1);
assert.match(invalidEnumResult.stderr, /truth\.problem_reproduced.*yes.*no.*not-applicable/i);

const malformed = path.join(tmpDir, "malformed.json");
fs.writeFileSync(malformed, "{not json}\n");
const malformedResult = spawnSync(process.execPath, [validator, malformed], { encoding: "utf8" });
assert.equal(malformedResult.status, 1);
assert.match(malformedResult.stderr, /invalid JSON/i);

console.log("validate triage tests passed");
