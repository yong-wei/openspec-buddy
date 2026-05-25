#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const skillDir = path.resolve(path.dirname(currentFile), "..");
const parser = path.join(skillDir, "scripts/parse-issue-metadata.mjs");
const selector = path.join(skillDir, "scripts/select-claim-issue.mjs");
const builder = path.join(skillDir, "scripts/build-open-issue-metadata.mjs");
const claimIssue = path.join(skillDir, "scripts/claim-issue.sh");

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
  assert.match(claimScript, /gh issue edit "\$issue_number" --body-file "\$tmp_dir\/adopted-body\.md"/);
  assert.doesNotMatch(claimScript, /gh issue create/);
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
  assert.equal(result.rejected.find((entry) => entry.number === 4).reason, "already claimed or active");
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
