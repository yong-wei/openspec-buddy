# Buddy Proposal Slicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make proposal shape, vertical-slice validity, dependency completeness, and wide-refactor strategy explicit and machine-validatable.

**Architecture:** A local `.buddy/proposal-review.yaml` records proposal-review decisions without expanding GitHub coordination metadata. A deterministic validator checks the manifest against issue/design artifacts; existing GitHub relationship helpers remain the remote truth gate.

**Tech Stack:** Node.js ESM, minimal YAML-subset parsing consistent with existing metadata parsing, Markdown references, Node assertion evals.

## Global Constraints

- One executable child change must be independently claimable, testable, reviewable, and deliverable as one PR.
- Tasks inside one change may remain database/API/UI/test steps; they are not forced into separate changes.
- Native GitHub `blockedBy` is truth; Buddy metadata is a mirror.
- Wide mechanical migrations use `expand-migrate-contract`; they are not split into invalid pseudo-slices.
- Existing prepared changes remain compatible until they are newly proposed or explicitly re-reviewed.

---

### Task 1: Define and validate the proposal-review manifest

**Files:**
- Create: `skills/openspec-buddy/scripts/validate-proposal-shape.mjs`
- Create: `skills/openspec-buddy/evals/validate-proposal-shape.test.mjs`

**Interfaces:**
- Consumes: path to `openspec/changes/<change_id>/.buddy/proposal-review.yaml`.
- Produces: exit 0 plus `Proposal shape valid`, or exit 1 with field-specific errors.

- [ ] **Step 1: Write failing fixtures and assertions**

Cover valid single change, valid series, missing child list, invalid enum, incomplete blocking edges, valid expand-migrate-contract, and legacy missing-manifest compatibility mode.

- [ ] **Step 2: Verify red**

`rtk node skills/openspec-buddy/evals/validate-proposal-shape.test.mjs`

Expected: FAIL because the validator is absent.

- [ ] **Step 3: Implement the validator**

Accept exactly:

```yaml
split_status: single-change | series-required
vertical_slice_status: valid | invalid
blocking_edges_status: valid | incomplete
wide_refactor_strategy: none | expand-migrate-contract
children: []
```

Require non-empty children for `series-required`; reject `invalid` and `incomplete` at proposal readiness; require design text naming expand, migrate, and contract when that strategy is selected.

- [ ] **Step 4: Verify green**

`rtk node skills/openspec-buddy/evals/validate-proposal-shape.test.mjs`

Expected: PASS.

### Task 2: Integrate the manifest into propose

**Files:**
- Modify: `skills/openspec-buddy/scripts/buddy-driver.mjs`
- Modify: `skills/openspec-buddy/evals/buddy-driver.test.mjs`
- Modify: `skills/openspec-buddy/evals/propose-default-artifacts.test.mjs`

- [ ] **Step 1: Add failing assertions**

For `--mode propose --change ID`, require both issue-body and proposal-shape validators. Assert a missing manifest is a HANDOFF requirement before issue mutation, not a fabricated default.

- [ ] **Step 2: Implement the minimal integration**

Add the validation command after `validate-issue-body.mjs`; do not add it to claim/apply/achieve or Auto selection.

- [ ] **Step 3: Run focused tests**

```bash
rtk node skills/openspec-buddy/evals/buddy-driver.test.mjs
rtk node skills/openspec-buddy/evals/propose-default-artifacts.test.mjs
```

Expected: PASS.

### Task 3: Specify series and migration rules

**Files:**
- Modify: `skills/openspec-buddy/references/core-lifecycle.md`
- Modify: `skills/openspec-buddy/references/issue-relationships.md`
- Modify: `skills/openspec-buddy/references/issue-template.md`
- Modify: `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

- [ ] Add failing documentation contract assertions.
- [ ] Document the four review fields, child independence test, tracking-parent behavior, native blockedBy authority, metadata mirroring, and expand-migrate-contract exception.
- [ ] Add a manifest example to the issue-template reference without adding the fields to issue front matter.
- [ ] Run the documentation eval and relationship evals.

### Task 4: Full verification and review

- [ ] Run:

```bash
rtk timeout 900 npm test
rtk npm pack --dry-run
rtk git diff --check
```

- [ ] Obtain independent whole-branch review, fix findings, and re-review.
- [ ] Commit only after clearance; then push and open the PR.
