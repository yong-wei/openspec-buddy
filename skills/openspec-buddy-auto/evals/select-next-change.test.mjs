#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const selector = path.resolve(path.dirname(currentFile), "../../openspec-buddy/scripts/select-next-change.mjs");
const selectorWrapper = path.resolve(path.dirname(currentFile), "../../openspec-buddy/scripts/select-next-change.sh");
process.env.OPENSPEC_BUDDY_BASE_BRANCH = "develop";

function issue({ number, changeId, series, couplingGroup = "none", labels = [], status = "status:ready", blockedBy = [], blocking = [], risk = "medium", baseBranch = "develop", bodyOverrides = "" }) {
  return {
    number,
    title: `OpenSpec: ${changeId}`,
    state: "OPEN",
    url: `https://github.example.test/issues/${number}`,
    labels: [status, `series:${series}`, `risk:${risk}`, "mode:isolated", couplingGroup !== "none" ? `coupling:${couplingGroup}` : "", ...labels].filter(Boolean).map((name) => ({ name })),
    body: `---
change_id: ${changeId}
claim_branch: ${changeId}
series: ${series}
coupling_group: ${couplingGroup}
execution_mode: isolated
base_branch: ${baseBranch}
required_branch:
depends_on: []
openspec_path: openspec/changes/${changeId}
risk: ${risk}
area: example-area
${bodyOverrides}---

## Goal

Test issue.
`,
    blockedBy: { nodes: blockedBy.map((entry) => ({ number: entry.number, state: entry.state ?? "OPEN", labels: entry.labels ?? [] })) },
    blocking: { nodes: blocking.map((entry) => ({ number: entry.number, state: entry.state ?? "OPEN", labels: entry.labels ?? [] })) },
  };
}

function runSelector(input) {
  const result = spawnSync(process.execPath, [selector], {
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.match(fs.readFileSync(selectorWrapper, "utf8"), /limit="\$\{2:-all\}"/);

const baseInput = {
  activeChanges: [
    "series-parent-tracking",
    "blocked-work",
    "unblocks-two",
    "same-series-next",
    "low-impact",
  ],
  issues: [
    issue({
      number: 10,
      changeId: "series-parent-tracking",
      series: "alpha",
      labels: ["type:series-parent", "status:tracking"],
    }),
    issue({
      number: 11,
      changeId: "blocked-work",
      series: "alpha",
      blockedBy: [{ number: 13, state: "OPEN" }],
    }),
    issue({
      number: 12,
      changeId: "unblocks-two",
      series: "alpha",
      blocking: [{ number: 11 }, { number: 15 }],
    }),
    issue({
      number: 13,
      changeId: "same-series-next",
      series: "beta",
      blocking: [{ number: 14 }],
    }),
    issue({
      number: 14,
      changeId: "low-impact",
      series: "gamma",
      risk: "low",
    }),
  ],
};

{
  const result = runSelector(baseInput);
  assert.equal(result.selected.change_id, "unblocks-two");
  assert.equal(result.selected.number, 12);
}

{
  const result = runSelector({ ...baseInput, currentSeries: "beta" });
  assert.equal(result.selected.change_id, "unblocks-two");
  assert.equal(result.selected.number, 12);
}

{
  const result = runSelector({
    activeChanges: ["older-ready", "newer-unblocks"],
    issues: [
      issue({
        number: 22,
        changeId: "older-ready",
        series: "alpha",
        risk: "low",
      }),
      issue({
        number: 30,
        changeId: "newer-unblocks",
        series: "alpha",
        blocking: [{ number: 31 }, { number: 32 }],
      }),
    ],
  });
  assert.equal(result.selected.change_id, "older-ready");
  assert.equal(result.selected.number, 22);
}

{
  const result = runSelector({
    activeChanges: ["older-ready", "next-ready"],
    excludeIssues: [22],
    issues: [
      issue({
        number: 22,
        changeId: "older-ready",
        series: "alpha",
        risk: "low",
      }),
      issue({
        number: 23,
        changeId: "next-ready",
        series: "alpha",
        risk: "low",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "next-ready");
  assert.equal(result.selected.number, 23);
  assert.equal(result.rejected.find((entry) => entry.number === 22).reason, "excluded by active lane");
}

{
  const result = runSelector({
    activeChanges: ["claimed-work", "ready-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-work",
        series: "alpha",
        status: "status:claimed",
      }),
      issue({
        number: 21,
        changeId: "ready-work",
        series: "alpha",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-work");
  assert.equal(result.selected.number, 21);
  assert.equal(result.rejected.find((entry) => entry.number === 20).reason, "already claimed; skipped until stale-claim fallback");
}

{
  const result = runSelector({
    activeChanges: ["duplicate-status-work", "ready-work"],
    issues: [
      issue({
        number: 20,
        changeId: "duplicate-status-work",
        series: "alpha",
        status: "status:ready",
        labels: ["status:in-progress"],
      }),
      issue({
        number: 21,
        changeId: "ready-work",
        series: "alpha",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-work");
  assert.equal(result.selected.number, 21);
  assert.equal(result.rejected.find((entry) => entry.number === 20).reason, "multiple status labels");
}

{
  const result = runSelector({
    activeChanges: ["claimed-coupled-work", "ready-coupled-work", "ready-independent-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
        status: "status:claimed",
      }),
      issue({
        number: 21,
        changeId: "ready-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
      }),
      issue({
        number: 22,
        changeId: "ready-independent-work",
        series: "alpha",
        couplingGroup: "independent-data",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-independent-work");
  assert.equal(result.selected.number, 22);
  assert.equal(result.rejected.find((entry) => entry.number === 21).reason, "coupling group has active issue");
  assert.deepEqual(result.rejected.find((entry) => entry.number === 21).coupling_conflicts, [20]);
}

{
  const activeWithoutBody = issue({
    number: 20,
    changeId: "claimed-coupled-work",
    series: "alpha",
    couplingGroup: "shared-data",
    status: "status:ready",
    labels: ["status:claimed"],
  });
  delete activeWithoutBody.body;
  const result = runSelector({
    activeChanges: ["ready-coupled-work", "ready-independent-work"],
    issues: [
      activeWithoutBody,
      issue({
        number: 21,
        changeId: "ready-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
      }),
      issue({
        number: 22,
        changeId: "ready-independent-work",
        series: "alpha",
        couplingGroup: "independent-data",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-independent-work");
  assert.equal(result.selected.number, 22);
  assert.deepEqual(result.rejected.find((entry) => entry.number === 21).coupling_conflicts, [20]);
}

{
  const currentWithStricterLabel = issue({
    number: 21,
    changeId: "ready-coupled-work",
    series: "alpha",
    couplingGroup: "none",
    labels: ["coupling:shared-data"],
  });
  const result = runSelector({
    activeChanges: ["claimed-coupled-work", "ready-coupled-work", "ready-independent-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
        status: "status:claimed",
      }),
      currentWithStricterLabel,
      issue({
        number: 22,
        changeId: "ready-independent-work",
        series: "alpha",
        couplingGroup: "independent-data",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-independent-work");
  assert.deepEqual(result.rejected.find((entry) => entry.number === 21).coupling_conflicts, [20]);
}

{
  const currentWithConflictingLabels = issue({
    number: 21,
    changeId: "ready-coupled-work",
    series: "alpha",
    couplingGroup: "none",
    labels: ["coupling:alpha-data", "coupling:beta-data"],
  });
  const result = runSelector({
    activeChanges: ["claimed-coupled-work", "ready-coupled-work", "ready-independent-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-coupled-work",
        series: "alpha",
        couplingGroup: "beta-data",
        status: "status:claimed",
      }),
      currentWithConflictingLabels,
      issue({
        number: 22,
        changeId: "ready-independent-work",
        series: "alpha",
        couplingGroup: "independent-data",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-independent-work");
  assert.equal(result.rejected.find((entry) => entry.number === 21).reason, "multiple coupling labels");
}

{
  const currentWithConflictingMetadata = issue({
    number: 21,
    changeId: "ready-coupled-work",
    series: "alpha",
    couplingGroup: "none",
    labels: ["coupling:beta-data"],
  });
  currentWithConflictingMetadata.body = currentWithConflictingMetadata.body.replace(
    "coupling_group: none",
    "coupling_group: alpha-data",
  );
  const result = runSelector({
    activeChanges: ["claimed-coupled-work", "ready-coupled-work", "ready-independent-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-coupled-work",
        series: "alpha",
        couplingGroup: "beta-data",
        status: "status:claimed",
      }),
      currentWithConflictingMetadata,
      issue({
        number: 22,
        changeId: "ready-independent-work",
        series: "alpha",
        couplingGroup: "independent-data",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "ready-independent-work");
  const rejected = result.rejected.find((entry) => entry.number === 21);
  assert.equal(rejected.reason, "coupling metadata and labels disagree");
  assert.deepEqual(rejected.coupling_groups, ["alpha-data", "beta-data"]);
}

{
  const result = runSelector({
    activeChanges: ["in-progress-coupled-work", "ready-coupled-work"],
    issues: [
      issue({
        number: 20,
        changeId: "in-progress-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
        status: "status:in-progress",
      }),
      issue({
        number: 21,
        changeId: "ready-coupled-work",
        series: "alpha",
        couplingGroup: "shared-data",
      }),
    ],
  });
  assert.equal(result.selected, null);
  assert.deepEqual(result.rejected.find((entry) => entry.number === 21).coupling_conflicts, [20]);
}

{
  const result = runSelector({
    activeChanges: ["claimed-work"],
    issues: [
      issue({
        number: 20,
        changeId: "claimed-work",
        series: "alpha",
        status: "status:claimed",
      }),
    ],
  });
  assert.equal(result.selected, null);
  assert.equal(result.stale_claim_candidates.length, 1);
  assert.equal(result.stale_claim_candidates[0].change_id, "claimed-work");
  assert.match(result.reason, /stale-claim recovery/);
}

{
  const result = runSelector({
    activeChanges: ["blocked-work"],
    issues: [
      issue({
        number: 11,
        changeId: "blocked-work",
        series: "alpha",
        blockedBy: [{ number: 13, state: "OPEN" }],
      }),
    ],
  });
  assert.equal(result.selected, null);
  assert.match(result.reason, /No executable/);
}

{
  const completedUpstream = issue({
    number: 20,
    changeId: "completed-upstream",
    series: "alpha",
    status: "status:ready",
    labels: ["status:merged"],
  });
  completedUpstream.state = "CLOSED";
  const result = runSelector({
    activeChanges: ["completed-upstream", "dependent-work"],
    issues: [
      completedUpstream,
      issue({
        number: 21,
        changeId: "dependent-work",
        series: "alpha",
        bodyOverrides: "depends_on:\n  - completed-upstream\n",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "dependent-work");
  assert.equal(result.selected.number, 21);
}

{
  const conflictingUpstream = issue({
    number: 20,
    changeId: "conflicting-upstream",
    series: "alpha",
    status: "status:ready",
    labels: ["status:merged"],
  });
  const result = runSelector({
    activeChanges: ["conflicting-upstream", "dependent-work", "independent-work"],
    issues: [
      conflictingUpstream,
      issue({
        number: 21,
        changeId: "dependent-work",
        series: "alpha",
        bodyOverrides: "depends_on:\n  - conflicting-upstream\n",
      }),
      issue({
        number: 22,
        changeId: "independent-work",
        series: "alpha",
      }),
    ],
  });
  assert.equal(result.selected.change_id, "independent-work");
  assert.equal(result.rejected.find((entry) => entry.number === 21).reason, "depends_on includes incomplete change");
}

{
  const result = runSelector({
    activeChanges: ["wrong-base"],
    issues: [
      issue({
        number: 15,
        changeId: "wrong-base",
        series: "alpha",
        baseBranch: "release",
      }),
    ],
  });
  assert.equal(result.selected, null);
  assert.match(result.rejected[0].reason, /base_branch must be develop/);
}

{
  const result = runSelector({
    activeChanges: [
      {
        change_id: "local-only-refactor",
        no_issue: true,
        series: "local",
        risk: "low",
      },
    ],
    issues: [],
  });
  assert.equal(result.selected.change_id, "local-only-refactor");
  assert.equal(result.selected.number, null);
  assert.equal(result.selected.local_only, true);
}

{
  const result = runSelector({
    activeChanges: [
      { change_id: "local-no-issue-flag", noIssue: true, series: "local", risk: "low" },
      { change_id: "local-issue-false", issue: false, series: "local", risk: "low" },
      { change_id: "local-coordination", coordination: "local", series: "local", risk: "low" },
    ],
    issues: [],
  });
  assert.equal(result.selected.local_only, true);
  assert.match(result.selected.change_id, /^local-/);
}

{
  const result = runSelector({
    activeChanges: [
      {
        change_id: "local-only-refactor",
        no_issue: true,
        series: "local",
        risk: "low",
      },
    ],
    issues: [
      {
        number: 21,
        title: "Broken metadata issue",
        state: "OPEN",
        url: "https://github.example.test/issues/21",
        labels: [{ name: "status:ready" }],
        body: `---
change_id: local-only-refactor
claim_branch:
---`,
        blockedBy: { nodes: [] },
        blocking: { nodes: [] },
      },
    ],
  });
  assert.equal(result.selected, null);
  assert.match(result.reason, /No executable/);
}

{
  const result = runSelector({
    activeChanges: [
      {
        change_id: "unknown-issue-marker",
        issue: null,
        series: "local",
        risk: "low",
      },
    ],
    issues: [],
  });
  assert.equal(result.selected, null);
  assert.match(result.reason, /No executable/);
}

console.log("select-next-change tests passed");
