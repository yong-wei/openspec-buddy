# Buddy Auto Lane Truth Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Buddy Auto multi-lane scheduling self-heal from stale lane head, transient GitHub probe failures, branch drift, and issue status drift without doing broad GitHub scans.

**Architecture:** Add one lane truth normalization layer inside `buddy-auto-lane-driver.mjs`. The lane driver reads the smallest current truth needed for the lane and phase, updates lane state before invoking helpers, and keeps helper scripts focused on their own single-object checks. GitHub reads remain PR/issue scoped: one `gh pr view` per active PR when needed, one review probe per waiting PR, and full review-clear only after probe reports a meaningful change.

**Tech Stack:** Node.js lane driver, Bash OpenSpec Buddy helpers, GitHub CLI REST/GraphQL only where existing helpers already require it, Node eval tests.

---

## Constraints

- Do not add repository-wide scans for Projects, issues, PRs, or review threads.
- Do not move truth recovery into every helper. The driver owns lane-level reconciliation; helpers remain single-object gates.
- Do not trust lane cache as truth for current head, PR state, review request state, or current branch.
- Do not weaken claim/worktree guards. Recovery may update lane state only when GitHub truth and current worktree branch support it.
- Keep multi-lane single-writer: only one foreground branch may be edited at a time; waiting lanes can be probed.

## File Map

- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
  - Add per-run PR truth cache.
  - Add explicit PR truth cache invalidation after any helper that can push, merge, or otherwise change PR head/state.
  - Add `collectLaneTruth`, `normalizeLaneFromTruth`, and `resumeLaneBeforeHelper` helpers.
  - Convert stale head, `head_changed`, retryable probe failure, retry request, and merge-ready handling to use normalized truth.
- Modify `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
  - Extend fake GitHub/Git helpers to model per-PR probe states and PR heads.
  - Add regression tests for stale local review-fix head, current-head `head_changed`, transient EOF continuation, retry resume, review retry idempotency, and pre/post merge branch context.
- Modify `skills/openspec-buddy/scripts/mark-in-progress.sh`
  - Treat missing `status:*` after a passing claim guard as repairable drift.
- Modify `skills/openspec-buddy/evals/mark-in-progress.test.sh`
  - Cover missing `status:*` repair and conflicting terminal status refusal.
- Modify `test/run-all-tests.mjs`
  - Register `mark-in-progress.test.sh` if the file is newly added.
- Modify docs only if behavior text is stale:
  - `skills/openspec-buddy-auto/references/driver-states.md`
  - `skills/openspec-buddy-auto/references/review-waiting.md`

## Minimal Truth Contract

`collectLaneTruth(lane, options)` reads only what the current phase needs:

- Always local:
  - `git branch --show-current`
  - `git rev-parse HEAD`
- Only if `lane.pr` exists and phase needs PR truth:
  - `gh pr view <pr> --json state,headRefOid,headRefName,mergedAt,number`
- Only if `lane.pr` is missing and lane is blocked/retryable with an issue:
  - `find-issue-pr.sh <issue>`
- Only if waiting for review:
  - `probe-review-state.sh <pr>`
- Only after probe returns `changed`, `review_returned`, or review-fix continuation:
  - `check-review-clear-once.sh <pr>`

The driver must cache `gh pr view` results for the current invocation so `safe-yield`, `resume`, `reconcile`, and retry handling do not query the same PR repeatedly in one tick.

Cache invalidation rule:

- `cachedPrTruth(pr)` may be reused only until the driver runs a helper that can change PR head/state.
- After `runSingleDriverForLane`, `requestRetry`, merge gates, or any helper that may push/merge, call `invalidatePrTruth(pr)` before reading PR head/state again.
- Use `forceRefreshPrTruth(pr)` when deciding review-fix parking after a possible push.

---

### Task 1: Add Lane Truth Normalization

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing tests for stale local review-fix head**

Add tests where lane state has `head: old-head`, current branch is lane branch, local HEAD is `new-head`, PR head is still `old-head`, and driver tries `safe-yield` or `resume`.

Expected:
- Driver returns `HANDOFF stage: review-fix`.
- Lane state updates `head` to `new-head`.
- Lane does not become `blocked`.

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected before implementation: FAIL on the new assertions.

- [ ] **Step 2: Implement `collectLaneTruth` and `normalizeLaneFromTruth`**

Add helpers near current `prTruth`/`localReviewFixHeadLane`:

```js
const prTruthCache = new Map();

function cachedPrTruth(pr) {
  if (!pr) return { status: 1, reason: 'lane has no PR' };
  const key = String(pr);
  if (!prTruthCache.has(key)) prTruthCache.set(key, prTruth(pr));
  return prTruthCache.get(key);
}

function invalidatePrTruth(pr) {
  if (pr) prTruthCache.delete(String(pr));
}

function forceRefreshPrTruth(pr) {
  invalidatePrTruth(pr);
  return cachedPrTruth(pr);
}

function collectLaneTruth(lane, { needPr = true } = {}) {
  const truth = {
    branch: currentBranch(),
    localHead: gitHead(),
    pr: null,
    prError: null,
  };
  if (needPr && lane.pr) {
    const pr = cachedPrTruth(lane.pr);
    if (pr.status === 0) truth.pr = pr.data;
    else truth.prError = pr.reason;
  }
  return truth;
}
```

Then replace repeated `prTruth(lane.pr)`/`prHead(lane.pr)` calls in lane driver with the cached form.

- [ ] **Step 3: Centralize local-ahead recovery**

Replace ad hoc `localReviewFixHeadLane` checks with a normalized function:

```js
function normalizeLocalAhead(lane, truth) {
  const remoteHead = String(truth.pr?.headRefOid || '');
  if (!lane.pr || !truth.localHead || !lane.head || truth.localHead === lane.head) return false;
  if (truth.branch !== lane.branch) return false;
  if (remoteHead && remoteHead !== lane.head) return false;
  lane.stage = 'review_fix';
  lane.head = truth.localHead;
  lane.blockedReason = '';
  lane.lastResult = 'local-review-fix-head-detected';
  clearRetryableState(lane);
  lane.updatedAt = new Date().toISOString();
  return true;
}
```

Apply it before `safeYieldCurrentLane`, after failed `resumeLane`, and inside blocked reconcile.

- [ ] **Step 4: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 2: Make Waiting Probe Recovery Non-Terminal

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing tests for transient probe failure**

Add a two-lane test:
- Lane A `waiting_review` has `PROBE_EOF_FOR=707`.
- Lane B `waiting_review` has probe state `changed` or `review_returned`.

Expected:
- Lane A becomes `retryable_blocked` and still reserves capacity.
- Driver continues to Lane B in the same invocation.
- If Lane B review is clear/actionable, the driver handles Lane B instead of stopping on Lane A.

Also add a single-lane test:
- EOF makes lane `retryable_blocked`.
- Driver emits `BLOCKED` only because no other active lane can progress.

- [ ] **Step 2: Parse probe JSON defensively**

In `processWaitingLane`, replace direct `JSON.parse(probe.stdout || '{}')` with:

```js
function parseJsonResult(stdout, fallbackReason) {
  try {
    return { ok: true, data: JSON.parse(stdout || '{}') };
  } catch {
    return { ok: false, reason: fallbackReason || 'invalid JSON output' };
  }
}
```

Invalid or empty probe output should be treated as retryable when output/error matches transient patterns or is empty.

- [ ] **Step 3: Continue after retryable waiting-lane failure**

Change `processWaitingLane` return shape from boolean to `{ stop, progressed }` or equivalent.

Rules:
- Retryable probe failure: mark lane `retryable_blocked`, write state, return `{ stop: false, progressed: false }`.
- Non-retryable probe failure: mark blocked and return `{ stop: true }`.
- Review returned / merge ready / review fix: return `{ stop: true }`.
- Still waiting: return `{ stop: false }`.

Update scheduler loop accordingly so one retryable waiting lane does not stop other waiting lanes.

- [ ] **Step 4: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 3: Treat Current-Head `head_changed` As Self-Healing

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing tests**

Model `probe-review-state.sh` returning:

```json
{
  "pr": "707",
  "head": "new-head",
  "signature": "new-sig",
  "requestState": "present-current-head",
  "state": "head_changed",
  "requestAgeSeconds": 120,
  "retryDue": false
}
```

Expected:
- Lane remains `waiting_review`.
- `lane.head` becomes `new-head`.
- `lane.lastSignature` becomes `new-sig`.
- `lane.lastRequestState` remains `present-current-head`.
- Driver does not call `check-review-clear-once.sh`.
- Driver does not emit `BLOCKED`.

- [ ] **Step 2: Preserve request timestamp when possible**

If probe reports `requestAgeSeconds`, do not reset `reviewRequestedAt` to now unless the previous value is empty. Resetting it hides retry due timing. Keep existing `reviewRetryCount` unless the request truly changed.

- [ ] **Step 3: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 4: Resume Lane Before Review and Retry Helpers

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing tests**

Add tests for:
- `retryDue` while current branch is another lane: driver switches to the lane branch before `request-pr-review.sh`.
- `review_returned` from top-level `review_returned` loop: driver resumes branch before `check-review-clear-once.sh`.
- `merge_ready` with open PR: driver resumes lane branch and does not switch to bound branch before merge gates.

Expected logs:

```text
switch change-675
verify-claim --issue 675 --pr 707
request 707 --force ...
```

For merge-ready open PR:

```text
switch change-675
verify-claim --issue 675 --pr 707
```

No `switch dev1` before open-PR merge gates.

- [ ] **Step 2: Add helper wrapper**

Add:

```js
function resumeLaneOrFail(state, lane, source) {
  const truth = collectLaneTruth(lane);
  if (normalizeLocalAhead(lane, truth)) {
    writeLaneState(state);
    return { ok: false, handoff: 'review_fix', reason: 'local review-fix head detected' };
  }
  const result = resumeLane(lane);
  if (result.status === 0) return { ok: true };
  const reason = result.stderr || result.stdout || `${source} lane resume failed`;
  markLaneFailure(state, lane, reason, { retryable: isTransientFailure(reason), source });
  return { ok: false, reason };
}
```

Use it before:
- `requestRetry(lane)`
- top-level `review_returned` checks
- `checkLaneReview(lane)` when caused by a lane state transition
- merge-ready open-PR gate

- [ ] **Step 3: Keep post-merge on bound branch**

Only call `ensureBoundBranch()` when PR truth is `MERGED` or `mergedAt` is present. Open PR merge gates must stay on lane branch.

- [ ] **Step 4: Add merged PR branch-context test**

Add a test where lane stage is `merge_ready`, PR truth returns `state: MERGED` and `mergedAt`, and current branch is the claim branch.

Expected:
- Driver switches to bound branch.
- Driver does not call `resumeLane` or `verify-claim-worktree.sh` as an open-PR gate before post-merge achievement.
- Driver invokes the single-lane driver in post-merge context.
- If the single driver returns `stage: achieved`, lane becomes `done`.

- [ ] **Step 5: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 5: Preserve Review-Fix Parking Semantics

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add failing test for review-fix completion**

Scenario:
- Lane stage is `review_fix`.
- Single driver returns `HANDOFF stage: review-fix`.
- `check-review-clear-once.sh` returns status `1` (no actionable thread, current-head request present but clean review not returned).

Expected:
- Lane stage becomes `waiting_review`.
- Lane head is updated to current PR head if PR head changed.
- `mark-review.sh` runs to restore `status:in-review`.
- Driver output says `stage: review-yield`, not `review-fix`.

- [ ] **Step 2: Normalize lane head before deciding review-fix result**

Before checking review-fix result, call `forceRefreshPrTruth(lane.pr)`. If PR head differs from lane head and the current-head review request is present, update lane head and park as `waiting_review`.

- [ ] **Step 3: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 6: Add Missing Status Drift Test

**Files:**
- Modify: `skills/openspec-buddy/scripts/mark-in-progress.sh`
- Modify or create: `skills/openspec-buddy/evals/mark-in-progress.test.sh`
- Modify: `test/run-all-tests.mjs`

- [ ] **Step 1: Update implementation to repair missing status**

In `mark-in-progress.sh`, keep the current order:

1. Read issue body/labels.
2. Parse metadata.
3. Run `verify-claim-worktree.sh`.
4. Only after claim guard passes, evaluate status labels.

Change the status rule:

```js
const allowed = new Set(["status:claimed", "status:in-review", "status:in-progress"]);
if (statuses.length === 0) process.exit(0);
process.exit(statuses.some((label) => allowed.has(label)) ? 0 : 1);
```

Do not allow terminal/conflicting statuses such as `status:archived`, `status:blocked`, `status:needs-human`, or `status:failed`.

- [ ] **Step 2: Add shell eval if missing**

Create a test fixture where:
- `gh issue view <issue> --json body,labels` returns metadata with `claim_branch` and `labels: []`.
- Fake `verify-claim-worktree.sh` succeeds.
- Fake `set-status-label.sh` logs `status:in-progress`.

Expected:
- `mark-in-progress.sh <issue>` exits 0.
- It calls `set-status-label.sh <issue> status:in-progress`.
- It writes the implementation-start comment.

Add a second test where labels include `status:archived`.

Expected:
- `mark-in-progress.sh <issue>` exits non-zero.
- It does not call `set-status-label.sh`.

- [ ] **Step 3: Register in test runner**

If `mark-in-progress.test.sh` is new, add it to `test/run-all-tests.mjs`.

- [ ] **Step 4: Verify targeted test passes**

Run:

```bash
rtk bash skills/openspec-buddy/evals/mark-in-progress.test.sh
```

Expected: PASS.

---

### Task 7: Add Review Retry and Duplicate Thread Idempotency

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] **Step 1: Add retry marker exists test**

Model `retryDue: true`, `reviewRetryCount: 0`, and fake issue comments containing the exact marker returned by `retryMarker(lane, 1)`.

Expected:
- Driver resumes the lane branch.
- Driver does not call `request-pr-review.sh` again.
- Lane `reviewRetryCount` becomes `1` or remains consistent with retry round.
- Lane remains `waiting_review`.

- [ ] **Step 2: Add repeated actionable thread helper expectation**

Do not implement a broad review-thread scanner in the lane driver. Instead document and test that repeated actionable threads still flow through `review_fix` and `review-response-gate` only after `check-review-clear-once.sh` reports status `3`.

Expected:
- Probe `changed` followed by check status `3` moves lane to `review_fix`.
- Driver does not query review threads directly.
- `mark-in-progress.sh` runs once before handoff.

- [ ] **Step 3: Verify targeted tests pass**

Run:

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: PASS.

---

### Task 8: Update Driver State Documentation

**Files:**
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/review-waiting.md`

- [ ] **Step 1: Document truth normalization**

Add concise rules:
- `lane.head` is a cached expected head, not final truth.
- Driver may update it from PR truth when current-head review request exists.
- Local branch ahead of parked PR head means `review_fix`, not fatal wrong-head.
- Retryable GitHub probe errors reserve capacity but should not stop other lanes.

- [ ] **Step 2: Document phase branch rules**

Add:
- Open PR merge/review helpers run on claim branch.
- Post-merge achieve/archive runs on bound branch.
- Request retry and review response checks must resume the lane branch first.
- Duplicate review threads remain review-response-gate responsibility; the lane driver must not scan all threads while polling.

- [ ] **Step 3: Verify docs do not imply manual cache editing**

Run:

```bash
rtk rg -n "edit lane|manual.*lane|cache" skills/openspec-buddy-auto/references
```

Expected: no instruction telling agents to manually edit lane cache.

---

### Task 9: Full Regression

**Files:**
- No additional edits expected.

- [ ] **Step 1: Run focused tests**

```bash
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
rtk bash skills/openspec-buddy/evals/mark-in-progress.test.sh
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```bash
rtk npm test
```

Expected: `All tests passed.`

- [ ] **Step 3: Run pack dry-run**

```bash
rtk npm pack --dry-run
```

Expected: outputs `openspec-buddy-*.tgz`.

- [ ] **Step 4: Final review**

Dispatch a high-reasoning review subagent with this checklist:
- Does the driver use PR/issue truth narrowly rather than scanning broad repository state?
- Are retryable probe errors non-terminal when other lanes can progress?
- Are open-PR merge gates run on claim branch and post-merge closeout on bound branch?
- Are stale head and current-head review request states self-healing?
- Is PR truth cache invalidated after helpers that can change PR head/state?
- Are tests meaningful and not only checking logs from earlier paths?

Expected: PASS before commit.

---

## Acceptance Checklist

- AC-1: A local review-fix commit ahead of parked lane head moves the lane to `review_fix` with updated `lane.head`, not `blocked`.
- AC-2: `head_changed` plus `present-current-head` updates `lane.head` and remains `waiting_review` without full review scan.
- AC-3: EOF/timeout/empty probe failures become retryable lane state and do not stop other waiting lanes from being processed.
- AC-4: `--reconcile` and normal driver execution recover owned blocked lanes using PR truth without losing local-head-ahead information.
- AC-5: Review retry, review clear checks, and merge-ready open PR gates resume the lane branch before calling helpers.
- AC-6: Post-merge achievement remains on bound branch; pre-merge gates remain on claim branch.
- AC-7: Missing issue `status:*` after a valid claim guard is repaired by `mark-in-progress.sh`.
- AC-8: No new broad GitHub scans are introduced; per-lane reads stay object-scoped and cached within the driver invocation.
- AC-9: PR truth cache is invalidated after helpers that can change PR head/state.
- AC-10: Review retry is idempotent when the retry marker already exists, and duplicate actionable review threads stay in the review-fix/gate flow rather than driver polling.
- AC-11: `npm test` and `npm pack --dry-run` pass.
