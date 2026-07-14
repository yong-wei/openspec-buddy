#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const skillDir = path.resolve(path.dirname(currentFile), "..");
const parser = path.join(skillDir, "scripts/parse-issue-metadata.mjs");
const selector = path.join(skillDir, "scripts/select-claim-issue.mjs");
const builder = path.join(skillDir, "scripts/build-open-issue-metadata.mjs");
const claimIssue = path.join(skillDir, "scripts/claim-issue.sh");
const claimChange = path.join(skillDir, "scripts/claim-change.sh");
const couplingConflicts = path.join(skillDir, "scripts/find-coupling-conflicts.mjs");
const claimLock = path.join(skillDir, "scripts/claim-lock.sh");
const orchestrationTest = path.join(skillDir, "evals/triage-claim-orchestration.test.sh");

process.env.OPENSPEC_BUDDY_BASE_BRANCH = "integration";

function runNode(script, input) {
  const result = spawnSync(process.execPath, [script], {
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

{
  const body = `# Existing collaborator issue

<!-- openspec-buddy
change_id: issue-27-student-flow
claim_branch: issue-27-student-flow
series: student-flow
coupling_group: none
execution_mode: isolated
base_branch: integration
required_branch:
depends_on: []
openspec_path: openspec/changes/issue-27-student-flow
risk: medium
area: workflow
-->

Human-readable issue description stays visible.
`;

  const result = spawnSync(process.execPath, [parser, "-"], {
    input: body,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.change_id, "issue-27-student-flow");
  assert.equal(metadata.claim_branch, "issue-27-student-flow");
  assert.equal(metadata.base_branch, "integration");
  assert.deepEqual(metadata.depends_on, []);
}

function runResumeVerifier(overrides = {}, expectedUpdatedAt = "2026-07-14T10:00:00Z") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "active-claim-resume-"));
  const issue = {
    state: "open",
    updated_at: "2026-07-14T10:00:00Z",
    labels: [{ name: "status:claimed" }],
    assignees: [{ login: "alice" }],
    ...overrides.issue,
  };
  const claim = {
    claim_id: "claim-1",
    state: "active",
    agent: "@alice",
    change_id: "issue-31-test",
    branch: "issue-31-test",
    base_branch: "integration",
    base_sha: "abc1234",
    lease_until: "2026-07-14T12:00:00Z",
    worktree_alias: "worker-a",
    worktree_path_hash: "path-a",
    coordination_branch: "coordination",
    ...overrides.claim,
  };
  const identity = { alias: "worker-a", path_hash: "path-a", coordination_branch: "coordination", ...overrides.identity };
  fs.writeFileSync(path.join(tmp, "issue.json"), JSON.stringify(issue));
  fs.writeFileSync(path.join(tmp, "comments.json"), JSON.stringify([{ created_at: "2026-07-14T09:00:00Z", user: { login: overrides.commentUser || "alice" }, body: `OpenSpec Buddy Claim\n${Object.entries(claim).map(([key, value]) => `${key}: ${value}`).join("\n")}` }]));
  fs.writeFileSync(path.join(tmp, "identity.json"), JSON.stringify(identity));
  const shell = `
source ${JSON.stringify(claimLock)}
buddy_claim_issue_rest() { cp "$FIXTURE/issue.json" "$3"; }
buddy_claim_comments_rest() { cp "$FIXTURE/comments.json" "$3"; }
buddy_worktree_identity_json() { cat "$FIXTURE/identity.json"; }
buddy_cache_dir() { printf '%s\\n' "$FIXTURE/cache"; }
git() { if [[ "$1" == fetch ]]; then return 0; fi; if [[ "$1" == rev-parse ]]; then printf '%s\\n' "$TEST_BASE_SHA"; return 0; fi; command git "$@"; }
buddy_verify_active_claim_resume 31 issue-31-test issue-31-test integration alice owner/repo "$FIXTURE/check" ${JSON.stringify(expectedUpdatedAt)}
`;
  return spawnSync("bash", ["-c", shell], {
    encoding: "utf8",
    env: { ...process.env, FIXTURE: tmp, OPENSPEC_BUDDY_NOW: "2026-07-14T11:00:00Z", TEST_BASE_SHA: overrides.baseSha || "abc1234" },
  });
}

{
  const valid = runResumeVerifier();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).claim_id, "claim-1");
  for (const [name, result, diagnostic] of [
    ["foreign agent", runResumeVerifier({ claim: { agent: "@bob" } }), /another agent/],
    ["expired lease", runResumeVerifier({ claim: { lease_until: "2026-07-14T10:30:00Z" } }), /lease has expired/],
    ["stale base", runResumeVerifier({ baseSha: "def5678" }), /base_sha is stale/],
    ["foreign worktree", runResumeVerifier({ identity: { path_hash: "path-b" } }), /another worktree/],
    ["branch mismatch", runResumeVerifier({ claim: { branch: "other-branch" } }), /change or branch/],
    ["base branch mismatch", runResumeVerifier({ claim: { base_branch: "main" } }), /base_branch does not match/],
    ["untrusted comment author", runResumeVerifier({ commentUser: "mallory" }), /not authored/],
    ["missing worktree identity", runResumeVerifier({ claim: { worktree_alias: "" } }), /identity is incomplete/],
    ["updatedAt race", runResumeVerifier({ issue: { updated_at: "2026-07-14T10:01:00Z" } }), /updatedAt changed/],
  ]) {
    assert.notEqual(result.status, 0, `${name} must be rejected`);
    assert.match(result.stderr, diagnostic);
  }
}

{
  const issue = {
    number: 31,
    title: "Add student claim flow",
    labels: [{ name: "series: collaboration" }, { name: "area: workflow" }, { name: "risk: low" }],
    body: "## Goal\n\nLet collaborators start from an ordinary issue.\n",
  };
  const result = spawnSync(process.execPath, [builder], {
    input: `${JSON.stringify(issue)}\n`,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const built = JSON.parse(result.stdout);
  assert.equal(built.metadata.change_id, "issue-31-add-student-claim-flow");
  assert.equal(built.metadata.claim_branch, "issue-31-add-student-claim-flow");
  assert.equal(built.metadata.series, "collaboration");
  assert.equal(built.metadata.area, "workflow");
  assert.match(built.updatedBody, /<!-- openspec-buddy/);
  assert.match(built.updatedBody, /Let collaborators start from an ordinary issue/);
}

{
  const claimScript = fs.readFileSync(claimIssue, "utf8");
  const claimChangeScript = fs.readFileSync(claimChange, "utf8");
  assert.match(claimScript, /buddy_write_minimal_claim_lock .*\$tmp_dir\/adopted-body\.md/);
  const minimalLock = claimScript.indexOf('buddy_write_minimal_claim_lock "$issue_number"');
  const verifiedLock = claimScript.indexOf('buddy_verify_claim_lock_rest "$issue_number"', minimalLock);
  const liveTruthRead = claimScript.indexOf('run_claim_triage_gate "$issue_number" "$change_id" "$base_branch"', verifiedLock);
  const developmentMutation = claimScript.indexOf('gh issue develop "$issue_number"', liveTruthRead);
  assert.ok(minimalLock >= 0 && minimalLock < verifiedLock, 'ordinary issue must write and verify the minimal claim lock first');
  assert.ok(verifiedLock < liveTruthRead, 'ordinary issue must reread live truth for triage only after lock verification');
  assert.ok(liveTruthRead < developmentMutation, 'triage must interrupt before Development or other peripheral mutation');
  assert.match(claimScript, /gh issue view "\$number" --json [^\n]*updatedAt > "\$live_issue_file"/);
  assert.match(claimScript, /validate-triage\.mjs[^\n]*--issue-updated-at[^\n]*--base-sha/);
  assert.match(claimScript, /validate-triage\.mjs[^\n]*--issue "\$number" --change-id "\$selected_change_id"/);
  assert.match(claimScript, /series-parent\)[\s\S]*status:tracking/);
  assert.match(claimScript, /needs-human\)[\s\S]*status:needs-human/);
  assert.match(claimScript, /blocked\)[\s\S]*status:blocked/);
  assert.match(claimScript, /close\)[\s\S]*gh issue close[^\n]*--comment/);
  assert.match(claimScript, /buddy_open_issues_rest "\$\{OPENSPEC_BUDDY_CLAIM_ISSUE_LIMIT:-200\}" > "\$tmp_dir\/issues\.json"/);
  assert.match(claimChangeScript, /buddy_open_issues_rest "all" > "\$issues_file"/);
  assert.match(claimScript, /claim-change\.sh" "\$issue_number" --resume-active/);
  assert.match(claimChangeScript, /--resume-active[\s\S]*buddy_verify_active_claim_resume/);
  assert.match(claimChangeScript, /stale_recovery" != "2"[\s\S]*buddy_write_minimal_claim_lock/);
  assert.match(fs.readFileSync(path.join(skillDir, "scripts/claim-lock.sh"), "utf8"), /active claim lease has expired; use stale recovery and reacquire/);
  assert.doesNotMatch(claimScript, /issue list[\s\S]*--limit/);
  assert.doesNotMatch(claimScript, /gh issue create/);
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coupling-none-"));
  const issuesFile = path.join(tmpDir, "issues.json");
  fs.writeFileSync(issuesFile, JSON.stringify([
    {
      number: 4,
      title: "Claimed independent issue",
      labels: [{ name: "status:claimed" }],
      body: `---
change_id: claimed-independent
claim_branch: claimed-independent
series: alpha
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/claimed-independent
risk: low
area: demo
---
`,
    },
  ]));

  const independent = spawnSync(process.execPath, [couplingConflicts, issuesFile, "8", "none"], { encoding: "utf8" });
  assert.equal(independent.status, 0, independent.stderr || independent.stdout);

  const coupled = spawnSync(process.execPath, [couplingConflicts, issuesFile, "8", "alpha"], { encoding: "utf8" });
  assert.equal(coupled.status, 0, coupled.stderr || coupled.stdout);

  fs.writeFileSync(issuesFile, JSON.stringify([
    {
      number: 6,
      title: "Claimed coupled issue",
      labels: [{ name: "status:claimed" }],
      body: `---
change_id: claimed-coupled
claim_branch: claimed-coupled
series: alpha
coupling_group: alpha
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/claimed-coupled
risk: low
area: demo
---
`,
    },
  ]));

  const conflict = spawnSync(process.execPath, [couplingConflicts, issuesFile, "8", "alpha"], { encoding: "utf8" });
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Claimed coupled issue/);

  fs.writeFileSync(issuesFile, JSON.stringify([
    {
      number: 7,
      title: "Claimed coupled issue without body",
      labels: [{ name: "status:claimed" }, { name: "coupling:alpha" }],
    },
  ]));
  const bodylessConflict = spawnSync(process.execPath, [couplingConflicts, issuesFile, "8", "alpha"], { encoding: "utf8" });
  assert.equal(bodylessConflict.status, 1);
  assert.match(bodylessConflict.stderr, /without body/);

  fs.writeFileSync(issuesFile, JSON.stringify([
    {
      number: 9,
      title: "Claimed issue with stricter coupling label",
      labels: [{ name: "status:claimed" }, { name: "coupling:alpha" }],
      body: `---
change_id: claimed-metadata-none
claim_branch: claimed-metadata-none
series: alpha
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/claimed-metadata-none
risk: low
area: demo
---
`,
    },
  ]));
  const stricterLabelConflict = spawnSync(process.execPath, [couplingConflicts, issuesFile, "8", "alpha"], { encoding: "utf8" });
  assert.equal(stricterLabelConflict.status, 1);
  assert.match(stricterLabelConflict.stderr, /stricter coupling label/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

{
  const result = runNode(selector, {
    issues: [
      {
        number: 4,
        title: "Already claimed",
        state: "OPEN",
        labels: [{ name: "status:claimed" }],
      },
      {
        number: 6,
        title: "Series parent",
        state: "OPEN",
        labels: [{ name: "type:series-parent" }, { name: "status:tracking" }],
      },
      {
        number: 8,
        title: "First available open issue",
        state: "OPEN",
        labels: [{ name: "status: ready" }],
        assignees: [],
      },
      {
        number: 10,
        title: "Later open issue",
        state: "OPEN",
        labels: [{ name: "status:ready" }],
        assignees: [],
      },
    ],
  });

  assert.equal(result.selected.number, 8);
  assert.equal(result.selected.reason, "lowest claimable issue number");
  assert.equal(result.rejected.find((entry) => entry.number === 4).reason, "already claimed; skipped until stale-claim fallback");
}

{
  const result = runNode(selector, {
    issues: [
      {
        number: 4,
        title: "Conflicting active status",
        state: "OPEN",
        labels: [{ name: "status:ready" }, { name: "status:in-progress" }],
        assignees: [],
      },
      {
        number: 6,
        title: "First valid issue",
        state: "OPEN",
        labels: [{ name: "status:ready" }],
        assignees: [],
      },
    ],
  });
  assert.equal(result.selected.number, 6);
  assert.equal(result.rejected.find((entry) => entry.number === 4).reason, "multiple status labels");
}

{
  const result = runNode(selector, {
    issues: [
      {
        number: 4,
        title: "Already claimed",
        state: "OPEN",
        labels: [{ name: "status:claimed" }],
      },
    ],
  });

  assert.equal(result.selected.number, 4);
  assert.equal(result.selected.stale_claim, true);
  assert.equal(result.selected.reason, "no normal claimable issue; stale-claim recovery verification required");
}

{
  const result = runNode(selector, {
    viewer: "student-a",
    issues: [
      {
        number: 7,
        title: "Assigned to current user",
        state: "OPEN",
        labels: [{ name: "status:ready" }],
        assignees: [{ login: "student-a" }],
      },
      {
        number: 8,
        title: "Assigned to someone else",
        state: "OPEN",
        labels: [{ name: "status:ready" }],
        assignees: [{ login: "student-b" }],
      },
    ],
  });

  assert.equal(result.selected.number, 7);
  assert.equal(result.rejected.find((entry) => entry.number === 8).reason, "already assigned");
}

console.log("open issue claim tests passed");

{
  const result = spawnSync("bash", [orchestrationTest], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
