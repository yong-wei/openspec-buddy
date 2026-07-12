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
const couplingConflicts = path.join(skillDir, "scripts/find-coupling-conflicts.mjs");

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
  assert.match(claimScript, /buddy_write_minimal_claim_lock .*\$tmp_dir\/adopted-body\.md/);
  assert.match(claimScript, /buddy_open_issues_rest "\$\{OPENSPEC_BUDDY_CLAIM_ISSUE_LIMIT:-200\}" > "\$tmp_dir\/issues\.json"/);
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
