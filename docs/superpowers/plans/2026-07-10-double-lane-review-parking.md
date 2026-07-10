# Double-Lane Review Parking Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate review coordination and automatically continue an already-owned second lane without weakening lane-switch or remote-truth gates.

**Architecture:** Treat matching signed single-driver receipts plus the existing safe-yield gate as the complete parking proof. Persist that proof on the lane, retain the legacy fallback for incomplete receipts, and route owned foreground branch changes through `resumeLaneOrFail` instead of an agent handoff.

**Tech Stack:** Node.js ES modules, Bash helper stubs, GitHub CLI test doubles, repository eval runner.

## Global Constraints

- Preserve claim ownership, clean-worktree, PR head, remote branch, and current-head review-request hard gates.
- Receipts may suppress duplicate coordination only when bound to the same PR and head.
- Missing or mismatched receipts must retain the existing `mark-review.sh` fallback.
- Existing owned lanes must advance before review probes or new claims.
- Automatic branch switching must use the existing lane-switch gate, never a bare scheduler `git switch`.
- Touch only the lane driver, its focused eval, and directly related documentation.

---

### Task 1: Optimize review parking and owned-lane continuation

**Files:**
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify if behavior wording changes: `skills/openspec-buddy-auto/references/review-waiting.md`

**Interfaces:**
- Consumes: signed `driverState.stages.mark_review_passed` and `driverState.stages.review_requested` receipts emitted by `buddy-auto-driver.mjs`.
- Produces: a parked lane whose `reviewStatusSyncedAt` records matching coordination completion; deterministic continuation through `resumeLaneOrFail(state, lane, source)`.

- [ ] **Step 1: Add the duplicate-coordination failing assertion**

In the `implementing-lane-advances-to-review-yield` scenario, count exact log
lines instead of checking only presence:

```js
assert.equal(
  (log.match(/^mark-review 676 708$/gm) || []).length,
  1,
  log,
);
```

Also assert `reviewStatusSyncedAt` is present.

- [ ] **Step 2: Verify the duplicate-coordination test is red**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: failure reporting two `mark-review 676 708` lines where one is
required.

- [ ] **Step 3: Add automatic-switch and safety failing tests**

Change `parking-lane-continues-owned-lane-before-new-claim` to require:

```js
assert.doesNotMatch(result.stdout, /Switch to lane branch/);
assert.match(log, /switch change-675/);
assert.doesNotMatch(log, /probe 707|probe 708/);
```

Add a dirty-worktree scenario with one parked lane and one implementing lane.
It must emit `BLOCKED`, contain `worktree is dirty`, and have no target switch,
driver invocation, review probe, or lane-stage mutation.

- [ ] **Step 4: Verify the scheduling tests are red for the intended reasons**

Run the same focused eval. Expected: the automatic-switch assertion fails
because the current scheduler emits an agent branch-switch handoff; the dirty
case fails because it does not yet enter the gated automatic resume path.

- [ ] **Step 5: Implement receipt validation and eliminate the duplicate fallback**

Add a small helper near `parkLaneFromDriverReceipt` that returns the receipt
timestamp only when `mark_review_passed` and `review_requested` match the
candidate PR/head. Persist it as `reviewStatusSyncedAt`. Call
`markLaneInReviewOrBlock` only when that proof is absent.

- [ ] **Step 6: Implement gated automatic foreground-lane continuation**

In `blockIfForegroundLaneNotParked`, replace the branch-mismatch handoff with
`resumeLaneOrFail`. Continue the existing single-driver path on success. On
failure, emit the existing blocker or review-fix handoff and return before any
probe or claim.

- [ ] **Step 7: Verify focused tests are green**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver-fast.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
rtk node skills/openspec-buddy-auto/evals/lane-switch-gate.test.mjs
```

Expected: all focused evals pass.

- [ ] **Step 8: Verify syntax and the complete repository suite**

Run:

```bash
rtk node --check skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs
rtk npm test
```

Expected: syntax check exits zero and the full suite reports `full tests passed.`

- [ ] **Step 9: Commit the implementation**

```bash
rtk git add skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs \
  skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs \
  skills/openspec-buddy-auto/references/review-waiting.md
rtk git commit -m "Optimize multi-lane review parking"
```

