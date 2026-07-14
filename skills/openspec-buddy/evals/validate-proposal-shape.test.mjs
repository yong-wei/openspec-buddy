import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const validator = path.join(repoRoot, "skills/openspec-buddy/scripts/validate-proposal-shape.mjs");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-proposal-shape-"));

function createChange(name, manifest, design = "") {
  const changeDir = path.join(tmpDir, "openspec", "changes", name);
  const buddyDir = path.join(changeDir, ".buddy");
  fs.mkdirSync(buddyDir, { recursive: true });
  if (manifest !== null) {
    fs.writeFileSync(path.join(buddyDir, "proposal-review.yaml"), manifest);
  }
  fs.writeFileSync(path.join(changeDir, "design.md"), design);
  return path.join(buddyDir, "proposal-review.yaml");
}

function run(manifestPath, ...args) {
  return spawnSync(process.execPath, [validator, manifestPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const single = run(createChange("single", `split_status: single-change
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
`));
assert.equal(single.status, 0, single.stderr);
assert.match(single.stdout, /Proposal shape valid/);

const series = run(createChange("series", `split_status: series-required
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children:
  - child-a
  - child-b
`));
assert.equal(series.status, 0, series.stderr);

const missingChildren = run(createChange("missing-children", `split_status: series-required
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
`));
assert.equal(missingChildren.status, 1);
assert.match(missingChildren.stderr, /children.*non-empty/i);

const invalidEnum = run(createChange("invalid-enum", `split_status: maybe
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
`));
assert.equal(invalidEnum.status, 1);
assert.match(invalidEnum.stderr, /split_status.*single-change.*series-required/i);

const specialKey = run(createChange("special-key", `split_status: single-change
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
__proto__: hidden
`));
assert.equal(specialKey.status, 1);
assert.match(specialKey.stderr, /__proto__.*unknown field/i);

const incompleteEdges = run(createChange("incomplete-edges", `split_status: single-change
vertical_slice_status: valid
blocking_edges_status: incomplete
wide_refactor_strategy: none
children: []
`));
assert.equal(incompleteEdges.status, 1);
assert.match(incompleteEdges.stderr, /blocking_edges_status.*incomplete/i);

const invalidSlice = run(createChange("invalid-slice", `split_status: single-change
vertical_slice_status: invalid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
`));
assert.equal(invalidSlice.status, 1);
assert.match(invalidSlice.stderr, /vertical_slice_status.*invalid/i);

const expandMigrateContract = run(createChange("expand-migrate-contract", `split_status: single-change
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: expand-migrate-contract
children: []
`, "# Design\n\nExpand the new representation, migrate consumers, then contract the old path.\n"));
assert.equal(expandMigrateContract.status, 0, expandMigrateContract.stderr);

const incompleteStrategyDesign = run(createChange("incomplete-strategy-design", `split_status: single-change
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: expand-migrate-contract
children: []
`, "# Design\n\nExpand the new representation, then migrate consumers.\n"));
assert.equal(incompleteStrategyDesign.status, 1);
assert.match(incompleteStrategyDesign.stderr, /design\.md.*contract/i);

const legacyManifest = createChange("legacy", null);
const legacyStrict = run(legacyManifest);
assert.equal(legacyStrict.status, 1);
assert.match(legacyStrict.stderr, /proposal-review\.yaml.*not found/i);
const legacyCompatible = run(legacyManifest, "--allow-missing");
assert.equal(legacyCompatible.status, 0, legacyCompatible.stderr);
assert.match(legacyCompatible.stdout, /Proposal shape valid/);

console.log("proposal shape validation tests passed");
