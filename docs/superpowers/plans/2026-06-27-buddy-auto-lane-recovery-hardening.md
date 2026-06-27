# Buddy Auto Lane Recovery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Buddy Auto multi-lane mode recover from transient GitHub/API failures and review-fix transitions without over-claiming, stale lane cache edits, or manual release surgery.

**Architecture:** Treat lane capacity as ownership protection, not just stage names. A lane that still owns an issue, PR, claim branch, or retryable failure must reserve capacity until the driver either self-heals it from GitHub truth, parks it in `waiting_review`, marks it `done`, or explicitly releases it through a documented helper. Keep all writes behind existing Buddy hard gates; do not let cache-only state authorize claim, review, merge, or release.

**Tech Stack:** Node.js ES modules, Bash helpers, GitHub CLI, existing Buddy REST/GraphQL access layer, shell/Node eval tests.

---

## Diagnosis

The current multi-lane driver has the right high-level boundary, but it still treats local lane cache as too authoritative:

- `activeLaneIssues()` and `claimNextIssue()` exclude `blocked`, so a blocked lane with an owned issue/PR frees a lane slot and can cause over-claiming.
- `probeLane()`, `resumeLane()`, and single-driver failures usually become permanent `blocked`, even when stderr is a transient GitHub EOF/rate/network failure.
- `review_fix` relies on the single driver to emit `review-yield`; if response gate and current-head review request already happened but no clean review exists yet, the lane can remain misleadingly `review_fix`.
- status label maintenance happens in the core single-lane helpers, but multi-lane review-fix transitions do not explicitly enforce `status:in-progress` while fixing or `status:in-review` once waiting again.
- claim release exists only as the internal `buddy_release_claim_lock()` function and is not exposed as a safe operator command.
- lane cache has no reconciliation pass from GitHub truth, so operators are forced to edit `openspec/.buddy-cache/auto-lanes/<alias>.json`.

## File Map

- Modify `skills/openspec-buddy-auto/scripts/lane-state.mjs`
  - Add `retryable_blocked` stage.
  - Persist retry metadata.
  - Add helpers for capacity-reserving lanes, recoverable lanes, goal-blocking
    lanes, and selector issue exclusions.
  - Preserve backward compatibility for existing `blocked` lane cache.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
  - Classify transient failures.
  - Reconcile owned blocked lanes before claiming.
  - Reserve capacity for blocked-but-owned and retryable lanes.
  - Bridge existing PR truth before declaring a lane blocked.
  - Stabilize review-fix completion into `waiting_review`.
  - Maintain status labels around review-fix transitions.
- Add `skills/openspec-buddy/scripts/release-claim.sh`
  - Official safe release path for mis-claims.
  - Emits claim release comment, restores status label, deletes empty branch when safe, and invalidates lane/cache state through explicit output.
- Modify `skills/openspec-buddy/scripts/claim-lock.sh`
  - Keep this file as the low-level claim-lock primitive owner.
  - Add small public-safe helper functions only if `release-claim.sh` needs
    reusable truth parsing; do not move `buddy_release_claim_lock()` out of
    this file.
- Modify `skills/openspec-buddy/scripts/find-issue-pr.sh`
  - Add one retry for transient GitHub API failure.
  - Ensure EOF/rate/network failures return a distinct non-zero classification that lane driver can treat as retryable.
- Modify `skills/openspec-buddy/scripts/mark-in-progress.sh`
  - No behavior change expected; lane driver should call it.
- Modify `skills/openspec-buddy/scripts/mark-review.sh`
  - No behavior change expected; lane driver should call existing single-driver path where possible.
- Modify `skills/openspec-buddy-auto/references/driver-states.md`
  - Document `retryable_blocked`, owned capacity, and lane reconciliation.
- Modify `skills/openspec-buddy-auto/references/review-waiting.md`
  - Document review-fix status transitions and waiting-state handoff.
- Add or extend tests:
  - `skills/openspec-buddy-auto/evals/lane-state.test.mjs`
  - `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
  - `skills/openspec-buddy/evals/find-issue-pr.test.sh`
  - `skills/openspec-buddy/evals/release-claim.test.sh`
  - `test/run-all-tests.mjs`

## Task 1: Capacity Semantics For Owned/Retryable Lanes

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/lane-state.test.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing lane-state tests**

Add tests that construct a state with:

```js
{
  lanes: [
    { id: 'issue-677', issue: '677', pr: '717', branch: 'change-677', stage: 'blocked', blockedReason: 'GitHub API EOF' },
    { id: 'issue-678', issue: '678', pr: '718', branch: 'change-678', stage: 'waiting_review' },
  ]
}
```

Expected:

```js
reservedLaneCount(state) === 2
selectorExcludedIssues(state) includes '677' and '678'
laneNeedsReconciliation(blockedLane) === true
laneBlocksGoalCompletion(blockedLane) === true
claimNextIssue does not call select-next-change.sh when maxLanes is 2
```

Also test that a `done` lane does not reserve capacity and a terminal operator-cleared `blocked` lane with no issue/pr/branch does not reserve capacity.
Add a round-trip test where a `retryable_blocked` lane with
`retryableSince` and `retryAttempts` is written through `writeLaneState()` and
read back through `readLaneState()` without dropping either field.

- [ ] **Step 2: Add lane-state schema and helpers**

Implement these exported functions in `lane-state.mjs`:

```js
export const blockedLikeStages = new Set(['blocked', 'retryable_blocked']);

export function laneReservesCapacity(lane) {
  if (!lane || lane.stage === 'done') return false;
  if (blockedLikeStages.has(lane.stage)) {
    return Boolean(lane.issue || lane.pr || lane.branch || lane.claimId);
  }
  return true;
}

export function reservedLaneCount(state) {
  return state.lanes.filter(laneReservesCapacity).length;
}

export function selectorExcludedIssues(state) {
  return state.lanes
    .filter((lane) => lane.stage !== 'done')
    .map((lane) => String(lane.issue || ''))
    .filter(Boolean);
}

export function laneNeedsReconciliation(lane) {
  if (!lane || lane.stage === 'done') return false;
  return lane.stage === 'retryable_blocked'
    || (lane.stage === 'blocked' && Boolean(lane.issue || lane.pr || lane.branch || lane.claimId));
}

export function laneBlocksGoalCompletion(lane) {
  return laneReservesCapacity(lane) && blockedLikeStages.has(lane.stage);
}
```

Keep `activeLaneIssues()` as a compatibility alias or update all callers to use `selectorExcludedIssues()`.
Extend `normalizeLane()` to persist:

```js
retryableSince: String(lane.retryableSince || ''),
retryAttempts: Number(lane.retryAttempts || 0),
```

Validation:

```js
if (!Number.isInteger(normalized.retryAttempts) || normalized.retryAttempts < 0) {
  throw new Error(`Lane ${normalized.id} has invalid retryAttempts.`);
}
```

Backward compatibility: missing fields in existing lane JSON normalize to
empty string and `0`.

- [ ] **Step 3: Update lane driver capacity checks**

In `claimNextIssue()`:

```js
const activeCount = reservedLaneCount(state);
if (activeCount >= state.maxLanes) return false;
```

In `runSelector()`, exclude `selectorExcludedIssues(state)` instead of current active-only exclusions.

In the no-selection branch of `claimNextIssue()`, replace all direct checks for
`lane.stage === 'blocked'` with `laneBlocksGoalCompletion(lane)`. This must
cover:

- blocked/retryable lane summary
- `DONE no-available-changes`
- `--poll-once` output when no waiting lane changes

Expected no-selection behavior:

```text
all done -> DONE stage: no-available-changes
only owned blocked/retryable lanes -> BLOCKED stage: blocked-lanes
waiting_review + owned blocked/retryable lanes -> continue probing waiting lane, not claim a new issue
```

- [ ] **Step 4: Verify tests**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/lane-state.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: the new over-claim regression test fails before implementation and passes after implementation.

## Task 2: Retryable Transient Failure State

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add `retryable_blocked` to allowed stages**

Extend `allowedLaneStages`:

```js
'retryable_blocked'
```

Compatibility rule: old `blocked` remains valid.

- [ ] **Step 2: Add transient classifier**

In `buddy-auto-lane-driver.mjs`, add:

```js
function isTransientFailure(output) {
  return /\b(EOF|timeout|timed out|ECONNRESET|ETIMEDOUT|rate.?limit|secondary rate|abuse detection|502|503|504)\b/i
    .test(String(output || ''));
}

function markLaneFailure(state, lane, reason, { retryable = false, source = '' } = {}) {
  lane.stage = retryable ? 'retryable_blocked' : 'blocked';
  lane.blockedReason = reason || 'lane failed';
  lane.lastResult = source || lane.lastResult || '';
  lane.updatedAt = new Date().toISOString();
  writeLaneState(state);
}
```

Use it in the existing direct assignments to `lane.stage = 'blocked'` when the source is `probeLane`, `resumeLane`, `checkLaneReview`, `runSingleDriverForLane`, or `safeYieldCurrentLane`.
When `retryable` is true:

```js
lane.retryableSince ||= new Date().toISOString();
lane.retryAttempts = Number(lane.retryAttempts || 0) + 1;
```

When a lane recovers out of `retryable_blocked`, clear:

```js
lane.retryableSince = '';
lane.retryAttempts = 0;
```

- [ ] **Step 3: Add retryable capacity test**

Create a test where a lane with PR #717 fails `find-issue-pr.sh` or `probe-review-state.sh` with `EOF`. Expected:

```text
stage: retryable_blocked
```

and no third issue is claimed while max lanes is 2.

- [ ] **Step 4: Add retry attempt policy**

For `retryable_blocked` lanes, run one reconciliation attempt per driver invocation before selecting new work. Store:

```js
lane.retryableSince
lane.retryAttempts
```

If retry succeeds, transition to the truth-derived stage. If retry fails with another transient error, keep `retryable_blocked` and reserve capacity. If retry fails with a deterministic error, convert to `blocked`.
The attempt counter must persist through `normalizeLane()`; otherwise the
policy is invalid.

## Task 3: Lane Truth Reconciliation Before Claiming

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add reconciliation tests**

Add tests for these states:

```js
{ issue: '677', pr: '', branch: 'change-677', stage: 'retryable_blocked', blockedReason: 'EOF' }
```

Stub `find-issue-pr.sh 677` to return:

```json
{"issue":677,"pr":717,"head":"abc","state":"OPEN","headRefName":"change-677","url":"https://github.test/pr/717"}
```

Expected lane after driver:

```js
stage === 'waiting_review' || stage === 'review_fix' || stage === 'merge_ready'
pr === '717'
head === 'abc'
branch === 'change-677'
```

The exact stage should come from `probe-review-state.sh` and `check-review-clear-once.sh`, not from cache.

- [ ] **Step 2: Implement unified reconciliation predicates**

Import or define use of `laneNeedsReconciliation()` from `lane-state.mjs`.
Do not duplicate one-off `stage === 'blocked'` checks in the driver.

- [ ] **Step 3: Implement `reconcileLaneFromTruth()`**

Behavior:

1. If lane has `pr`, query `gh pr view <pr> --json state,headRefOid,headRefName,mergedAt`.
2. If lane has issue but no PR, run `find-issue-pr.sh <issue>` with transient retry.
3. If an open PR exists, update `lane.pr`, `lane.head`, `lane.branch`, and probe/check review truth.
4. If merged and achieved, stage becomes `done`; otherwise `merge_ready` or `achieving`.
5. If no PR exists and issue still has active claim/branch, keep capacity reserved and emit precise `blocked` or `retryable_blocked`; do not claim another issue.

- [ ] **Step 4: Call reconciliation before new claim**

In scheduler order, before `claimNextIssue()`:

```js
if (reconcileRecoverableLanes(state)) return;
```

`reconcileRecoverableLanes` should process `retryable_blocked` first, then owned
`blocked` with issue/pr/branch evidence. It may output `HANDOFF` only when it
finds review-fix, merge, or achievement work requiring the foreground branch.

## Task 4: Review-Fix Completion Becomes Waiting Review

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify: `skills/openspec-buddy/scripts/check-review-clear-once.sh` only if a new exit classification is necessary.
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add regression test for #678 pattern**

Initial lane:

```js
{ issue: '678', pr: '718', head: 'new-head', stage: 'review_fix' }
```

Stub single driver to return `HANDOFF stage: review-fix` or review wait output that says latest Codex review targets old head, while `verify-current-head-review-request.sh` would pass.

Expected driver output:

```text
DONE
stage: waiting_review
```

or a silent scheduler continuation, not `HANDOFF stage: review-fix`.

- [ ] **Step 2: Distinguish “old head review only” from actionable feedback**

Use existing `check-review-clear-once.sh` semantics:

- exit `3`: actionable feedback requiring `review_fix`
- exit `1`: waitable state, including old-head review or no current-head clean review
- exit `0`: merge-ready

In `advanceResumedLane()` after review response gate succeeds, if the single driver returns review-yield or check returns exit `1`, update lane:

```js
lane.stage = 'waiting_review';
lane.reviewRequestedAt = now if current-head request was just made;
lane.lastResult = 'waiting_review';
```

Do not emit `review-fix` unless `check-review-clear-once.sh` returns exit `3`.

- [ ] **Step 3: Preserve current-head request proof**

When `request-pr-review.sh` is run by the single driver, parse the driver state receipt:

```js
state.stages.review_requested.head
state.stages.review_requested.at
```

and copy it into lane `head` and `reviewRequestedAt`.

## Task 5: Status Label Synchronization For Review Fix

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add tests for status helper calls**

Stub:

```bash
mark-in-progress.sh
mark-review.sh
```

Expected:

- entering `review_fix` calls `mark-in-progress.sh <issue>`
- parking back into `waiting_review` calls `mark-review.sh <issue> <pr>` or otherwise drives the single driver stage that runs it

- [ ] **Step 2: Call existing helpers, do not duplicate label logic**

In lane driver:

```js
function markIssueInProgress(issue) {
  return run(path.join(coreScriptDir, 'mark-in-progress.sh'), [String(issue)], { allowFailure: true });
}

function markIssueInReview(issue, pr) {
  return run(path.join(coreScriptDir, 'mark-review.sh'), [String(issue), String(pr)], { allowFailure: true });
}
```

On transition to `review_fix`, call `markIssueInProgress`. On transition from `review_fix` to `waiting_review`, ensure `markIssueInReview` has succeeded through the single driver or call it explicitly. If either helper fails transiently, classify as `retryable_blocked`; if deterministic, `blocked`.

## Task 6: Official Claim Release Helper

**Files:**
- Add: `skills/openspec-buddy/scripts/release-claim.sh`
- Modify: `skills/openspec-buddy/scripts/claim-lock.sh`
- Modify: `skills/openspec-buddy/evals/helper-help.test.sh`
- Add: `skills/openspec-buddy/evals/release-claim.test.sh`
- Modify: `test/run-all-tests.mjs`
- Document: `skills/openspec-buddy/references/claim-locking.md`

- [ ] **Step 1: Define CLI**

```bash
release-claim.sh <issue-number> [--reason <text>] [--delete-empty-branch] [--clear-lane-cache]
```

Required truth checks:

- latest active claim belongs to current worktree alias/hash or user passes a future explicit takeover/release flag; do not release foreign claims by default
- issue is not merged/achieved
- PR either does not exist, is closed without merge, or branch is empty/base-only before deleting branch

- [ ] **Step 2: Implement release action**

`release-claim.sh` must `source "$script_dir/claim-lock.sh"` and call the
existing `buddy_release_claim_lock()` primitive from that file. Do not move the
primitive into `release-claim.sh`; current claim/review scripts already depend
on `claim-lock.sh` as the shared claim-lock library.

Use existing `buddy_release_claim_lock()` to write an audited release comment. Then:

- restore status label to `status:ready` only when issue is still open and no open PR exists
- delete remote branch only when `--delete-empty-branch` and branch has no business commit beyond recorded base SHA
- invalidate issue/project/ready-scan cache
- if `--clear-lane-cache`, remove only the matching lane from current worktree lane state

- [ ] **Step 3: Test safe release**

Test cases:

- release comment is written with claim id/change/branch/reason
- foreign worktree claim is rejected
- non-empty branch is not deleted
- matching lane cache entry is removed only with `--clear-lane-cache`
- `release-claim.sh --help` exits 0 and is included in `helper-help.test.sh`

## Task 7: Driver Recovery Command Surface

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
- Document: `skills/openspec-buddy-auto/references/failure-recovery.md`

- [ ] **Step 1: Add minimal recovery options**

Keep normal path argument-free. Add special-case options only for operator recovery:

```bash
buddy-auto-lane-driver.mjs --reconcile
buddy-auto-lane-driver.mjs --release-lane <issue-or-pr> --reason <text>
```

Normal no-arg mode should already run reconciliation before claim. `--reconcile` runs only reconciliation and exits with precise output.

- [ ] **Step 2: Implement `--release-lane` as a wrapper**

The driver should call `release-claim.sh` rather than duplicating release logic. It should then remove the matching lane from current lane cache only if release helper reports success.

Tests must cover:

- `--reconcile` exits after reconciliation without selecting or claiming a new issue.
- `--release-lane` refuses foreign claim output from `release-claim.sh` and leaves lane cache unchanged.
- successful `--release-lane` removes only the matching lane.

- [ ] **Step 3: Output precise stages**

Avoid ambiguous `HANDOFF review-fix` for waitable states. Required output mapping:

- actionable review threads: `HANDOFF stage: review-fix`
- current head review requested but no clean result: `DONE stage: waiting_review` in `--poll-once`, or continue silent polling in normal mode
- transient API failure: `BLOCKED stage: retryable-blocked` only when no immediate self-heal succeeds
- permanent ownership conflict: `BLOCKED stage: blocked-lanes`

Implementation note: if `retryable_blocked` is present and `--poll-once` does
not recover it, output must still make the lane visible as blocked/retryable;
do not emit generic `DONE stage: waiting_review` when no waiting lane changed.

## Task 8: Update Documentation And Regression Coverage

**Files:**
- Modify: `skills/openspec-buddy-auto/SKILL.md`
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/review-waiting.md`
- Modify: `skills/openspec-buddy-auto/references/failure-recovery.md`
- Modify: `skills/openspec-buddy/references/claim-locking.md`
- Modify: `docs/release-notes/v<next>.md` during implementation release

- [ ] **Step 1: Document capacity invariant**

Add:

```text
Lane capacity is reserved by ownership, not only by active editing. A lane with
an issue, PR, claim branch, or retryable GitHub failure still occupies one lane
until the driver reconciles it, completes it, or releases it through
release-claim.sh.
```

- [ ] **Step 2: Document transient failure policy**

Add:

```text
EOF, timeout, secondary rate limit, and 5xx errors are retryable. They must not
free a lane slot or authorize a new claim.
```

- [ ] **Step 3: Document review-fix state policy**

Add:

```text
review_fix means current actionable P0/P1/P2 feedback still needs work.
After reply -> resolve -> request current-head review succeeds, the lane becomes
waiting_review even if the latest completed Codex review still targets the old
head.
```

## Verification Plan

Run these commands before commit:

```bash
rtk bash -n skills/openspec-buddy/scripts/*.sh
rtk node skills/openspec-buddy-auto/evals/lane-state.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
rtk bash skills/openspec-buddy/evals/find-issue-pr.test.sh
rtk bash skills/openspec-buddy/evals/release-claim.test.sh
rtk npm test
rtk npm pack --dry-run
```

Expected:

- EOF/rate transient blocked lane reserves capacity and does not allow a third claim.
- Retryable blocked lane with existing PR bridges back to waiting/review-fix/merge-ready from GitHub truth.
- Review-fix after current-head request moves to waiting_review, not misleading review-fix.
- Issue status moves to in-progress while fixing and in-review when waiting again.
- Mis-claim release has one official helper and does not require hand-edited lane cache.
- `retryableSince` and `retryAttempts` survive lane-state write/read.
- `retryable_blocked` participates in capacity, no-selection, poll-once, and
  blocked-lane output via shared predicates.
- `release-claim.sh` depends on `claim-lock.sh`, not the reverse.

## Risks And Constraints

- Do not make `blocked` globally permanent. A truly operator-cleared blocked lane with no owned issue/pr/branch should not reserve capacity forever.
- Do not let local lane cache prove claim ownership. Claim/release actions must verify GitHub latest active claim.
- Do not auto-release foreign claims. The default must block and instruct explicit recovery.
- Do not publish or rely on mirror npm registries during this work; release verification uses official npm registry.
