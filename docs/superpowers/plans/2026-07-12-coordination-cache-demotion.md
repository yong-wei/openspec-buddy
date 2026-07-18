# Coordination Cache Demotion and Live Truth Revalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep performance-oriented GitHub caches while removing all authority of persisted coordination state, receipts, and review snapshots to prove current claim, review, merge, archive, or Project truth.

**Architecture:** GitHub remains the authority for coordination facts. A small read-only live-claim probe and explicit live-cache wrappers become the shared gates for critical transitions; `auto-state`, `auto-lanes`, and `auto-controller` remain as recovery intent, scheduling snapshots, and audit evidence only. Passive selector and review polling may continue using bounded caches, but every mutation or safety decision performs a fresh remote check.

**Tech Stack:** Node.js ESM, Bash, GitHub CLI REST/GraphQL, `openspec/.buddy-cache/`, signed Buddy Auto receipts, shell evals, and Node `assert` tests.

## Global Constraints

- Implement from the current `origin/main` v0.21.0 (`7a43ede`) in a new isolated worktree; do not overwrite the current `main` checkout or its existing untracked plan.
- `auto-controller` is authoritative only for controller intent and persistent interrupts; GitHub is authoritative for claim ownership, PR/review state, merge, archive, and Project state.
- A valid local receipt or a non-empty persisted timestamp never skips a live gate.
- Keep the normal agent-facing entrypoint as `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`.
- Keep the existing v0.20 controller-owned merge and `merge_authorized`/`merged` receipt path; this plan adds live claim and state-revalidation gates without reopening the merge design.
- REST remains the default read path. GraphQL remains limited to issue relationships, review-thread truth, and required Project mutations.
- Selector, ordinary issue/PR reads, and relationship scans retain their bounded caches; final critical checks use explicit refresh mode.
- Use TDD for each behavior change, run the focused regression before the full suite, and commit each independently testable task.

## Evidence and Decisions

- `github-fetch.sh` defines 600-second issue/PR caches, 120-second relationship and ready-scan caches, and a 24-hour Project metadata cache.
- `buddy-pr-rest-bundle` is a separate raw-file cache without an envelope or TTL; it is safe only as a same-run prefetch working set and must not become a cross-run truth source.
- `buddy-auto-driver.mjs` currently treats a locally valid `claimed` receipt as sufficient to skip `claim-issue.sh`; the receipt verifies signature/context/head but does not verify the remote active claim.
- `controller-reconciler.mjs` can clear a review interrupt from persisted lane truth because `threadCacheFreshForHead()` checks presence and matching head but not age or current-run provenance.
- The current claim helpers already perform live REST checks in the mutation path. The gap is that the driver can avoid entering that path, and multi-lane/controller recovery can act on stale local state before a live check.
- The proposed demotion is therefore selective: preserve cache acceleration and local recovery data, remove their authorization power, and add observability before considering any cache deletion.

## File Map

- Create `skills/openspec-buddy/scripts/read-live-claim-truth.sh`: read-only REST probe returning structured current issue/claim ownership and lease evidence.
- Create `skills/openspec-buddy/evals/read-live-claim-truth.test.sh`: claim-present, released, foreign, expired, and REST-failure fixtures.
- Create `skills/openspec-buddy/scripts/cache-metrics.mjs`: best-effort local hit/miss/forced-refresh and stale-recovery event log plus summary command.
- Modify `skills/openspec-buddy/scripts/claim-lock.sh` and `verify-claim-worktree.sh`: share claim parsing and expose machine-readable probe outcomes.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`: require live claim ownership before reusing a claimed receipt.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`: revalidate claim truth before lane-bound work and block stale/foreign claims.
- Modify `skills/openspec-buddy-auto/scripts/controller-reconciler.mjs`, `review-truth.mjs`, `controller-state.mjs`, and `lane-state.mjs`: prevent persisted review/coordination snapshots from clearing interrupts or authorizing recovery.
- Modify `skills/openspec-buddy/scripts/github-fetch.sh`, `buddy-cache.mjs`, `claim-issue.sh`, `claim-change.sh`, `verify-pr-coordination.sh`, `verify-review-clear.sh`, `set-project-status.sh`, and `set-project-date.sh`: add explicit live-cache paths while retaining bounded read caches.
- Add focused evals under `skills/openspec-buddy/evals/` and `skills/openspec-buddy-auto/evals/`; register new evals in `test/run-all-tests.mjs`.
- Modify `skills/openspec-buddy-auto/SKILL.md`, `references/driver-states.md`, `references/failure-recovery.md`, and `skills/openspec-buddy/references/claim-locking.md` to document the demoted semantics.

---

### Task 1: Add a Shared Live Claim Probe

**Files:**

- Create: `skills/openspec-buddy/scripts/read-live-claim-truth.sh`
- Create: `skills/openspec-buddy/evals/read-live-claim-truth.test.sh`
- Modify: `skills/openspec-buddy/scripts/claim-lock.sh`
- Modify: `skills/openspec-buddy/scripts/verify-claim-worktree.sh`

**Interface:**

```text
read-live-claim-truth.sh <issue-number> [--json]
exit 0 = a valid probe result, including missing/foreign/expired claim
exit 2 = configuration, REST, or malformed-response failure
result.status = owned | missing | foreign | expired | invalid
result.source = github-rest
```

- [ ] **Step 1: Add fixtures for the live truth contract.**

The fixture must return one JSON object for each case:

```json
{"status":"owned","claimId":"claim-1","agent":"@student-a","worktreePathHash":"hash-a","leaseUntil":"2099-01-01T00:00:00Z"}
{"status":"missing","claimId":""}
{"status":"foreign","claimId":"claim-2","worktreePathHash":"hash-b"}
{"status":"expired","claimId":"claim-3","leaseUntil":"2000-01-01T00:00:00Z"}
```

- [ ] **Step 2: Run the focused test and verify the failure.**

Run: `rtk bash skills/openspec-buddy/evals/read-live-claim-truth.test.sh`

Expected: `FAIL` because the probe does not exist.

- [ ] **Step 3: Implement the probe by reusing `claim-lock.sh` readers.**

The probe must call `buddy_claim_issue_rest` and `buddy_claim_comments_rest` directly, select the latest active claim using the existing release-comment rules, parse `lease_until`, compare the current viewer/worktree identity, and never call a cache reader. A REST failure must not be converted to `missing`.

The normalized decision must follow this exact order:

```text
no active claim                         -> missing
active claim with invalid lease         -> invalid
active claim with expired lease         -> expired
active claim owned by another identity  -> foreign
active claim owned by current identity  -> owned
```

- [ ] **Step 4: Make `verify-claim-worktree.sh` consume the same parser.**

Keep its existing exit-code behavior for compatibility, but make `--json` print the probe object before the human-readable success line. Do not duplicate `latestActiveClaim` parsing in a second script.

- [ ] **Step 5: Run the focused test and commit.**

Run: `rtk bash skills/openspec-buddy/evals/read-live-claim-truth.test.sh`

Expected: `read-live-claim-truth tests passed.`

Commit: `git add skills/openspec-buddy/scripts/read-live-claim-truth.sh skills/openspec-buddy/scripts/claim-lock.sh skills/openspec-buddy/scripts/verify-claim-worktree.sh skills/openspec-buddy/evals/read-live-claim-truth.test.sh && git commit -m "fix: add live claim truth probe"`

### Task 2: Remove the Claimed-Receipt Skip Authority

**Files:**

- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`
- Modify: `test/run-all-tests.mjs`

**Interface:**

```javascript
readLiveClaimTruth(issue, options) -> { status, claimId, leaseUntil, source, checkedAt }
claimedReceiptIsUsable(state, opts, liveClaim) -> boolean
```

- [ ] **Step 1: Add the #916-shaped regression before implementation.**

Seed `auto-state/issue-916.json` with a valid signed `claimed` receipt, stub the live probe as `missing`, and assert that the driver invokes `claim-issue.sh` instead of `find-issue-pr.sh`:

```js
assert.match(log, /claim-issue 916/);
assert.doesNotMatch(log, /find-issue-pr 916/);
assert.match(result.stdout, /stage: claim-issue/);
```

Add companion cases for `owned` (continues to `find-issue-pr`), `foreign` (blocks without a claim attempt), and probe failure (blocks without treating the claim as missing).

- [ ] **Step 2: Run the regression and verify the failure.**

Run: `rtk node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`

Expected: the stale-receipt case fails because `validReceipt(state, 'claimed')` currently decides the path without a live probe.

- [ ] **Step 3: Add the live gate before driver command selection.**

For issue-only contexts, call `read-live-claim-truth.sh` on every driver invocation that could reuse `claimed`. Change the decision to:

```javascript
const claimed = contextMatches
  && validReceipt(state, 'claimed')
  && liveClaim?.status === 'owned';
```

Map `foreign` to a non-takeover `BLOCKED`; map `missing` or `expired` to the normal claim path; map probe errors to `BLOCKED`. Keep the local receipt in the state file as audit evidence, but print it as stale-local evidence rather than current claim truth.

- [ ] **Step 4: Verify restart and changed-worktree behavior.**

Run the driver twice with the same state file and different worktree identity. The second run must perform the live probe again and must not reuse the first run's claim receipt. A changed branch or worktree alias must not be repaired by editing local state.

- [ ] **Step 5: Run focused and fast tests, then commit.**

Run: `rtk node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`

Run: `rtk node test/run-all-tests.mjs fast`

Expected: both pass; stale local claim state never skips live claim verification.

Commit: `git add skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs test/run-all-tests.mjs && git commit -m "fix: require live claim before receipt reuse"`

### Task 3: Revalidate Lane and Controller State on Recovery

**Files:**

- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/controller-reconciler.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/review-truth.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/controller-state.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
- Modify: `skills/openspec-buddy-auto/evals/review-truth.test.mjs`

**Interfaces:**

```javascript
threadCacheFreshForHead(truth, head, { now, maxAgeSeconds }) -> boolean
reconcileControllerState(state, { freshTruth }) -> { changed, state, reason }
```

- [ ] **Step 1: Add stale review-truth regressions.**

Assert that a persisted `threadState: clear` with an old timestamp, a matching head, and no current-run truth does not clear `reviewFix.pending` or a `request_missing` interrupt. Assert that same-run fresh clear truth does clear it, while `head` mismatch, actionable threads, and dirty worktrees do not.

- [ ] **Step 2: Make review freshness time-based and source-bound.**

`threadCacheFreshForHead()` must reject missing timestamps, timestamps older than the configured short review-truth TTL, future timestamps beyond the allowed clock skew, and values without a `freshTruth.runId` matching the current controller run. Use a default of 300 seconds for passive review snapshots; critical merge/review gates still force a fresh check regardless of TTL.

- [ ] **Step 3: Stop the pre-child reconciler from trusting disk state.**

`buddy-auto.mjs` must pass no `freshTruth` to its startup reconciler. With no current-run truth, `controller-reconciler.mjs` preserves the interrupt and lets the child driver perform the live probe/deep check. Only a same-run live result may clear the interrupt. `controller-state.mjs` continues persisting mode, target, and interrupt for recovery, but its `updatedAt` is audit data rather than a lease.

- [ ] **Step 4: Guard lane-bound actions with live claim truth.**

Before resume, mark-review, review-fix, merge-ready, merge, archive, or Project synchronization, `buddy-auto-lane-driver.mjs` must call the shared live claim probe. On `missing` or `expired`, write `stage: blocked`, `lastResult: stale-claim`, and preserve the lane's issue/branch/PR. On `foreign`, write `lastResult: foreign-claim` and refuse takeover. On probe failure, use `retryable_blocked` only for a classified transient error; never clear the lane or treat it as an empty slot.

- [ ] **Step 5: Add process-restart and worktree-switch tests.**

Seed a lane as `implementing` or `waiting_review`, make the fixture release its remote claim, restart the controller, and assert:

```js
assert.match(result.stdout, /stale-claim|foreign-claim/);
assert.doesNotMatch(commandLog, /mark-review|merge-pr-after-gates|mark-achieved-post-merge/);
assert.equal(readLane().issue, '916');
```

- [ ] **Step 6: Run focused tests and commit.**

Run: `rtk node skills/openspec-buddy-auto/evals/review-truth.test.mjs`

Run: `rtk node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

Run: `rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

Expected: persisted state remains recoverable but cannot clear an interrupt or continue a released claim without fresh remote evidence.

Commit: `git add skills/openspec-buddy-auto/scripts skills/openspec-buddy-auto/evals && git commit -m "fix: revalidate persisted coordination state"`

### Task 4: Keep Read Caches but Force Critical Refreshes

**Files:**

- Modify: `skills/openspec-buddy/scripts/buddy-cache.mjs`
- Modify: `skills/openspec-buddy/scripts/github-fetch.sh`
- Modify: `skills/openspec-buddy/scripts/claim-issue.sh`
- Modify: `skills/openspec-buddy/scripts/claim-change.sh`
- Modify: `skills/openspec-buddy/scripts/verify-pr-coordination.sh`
- Modify: `skills/openspec-buddy/scripts/verify-review-clear.sh`
- Modify: `skills/openspec-buddy/scripts/set-project-status.sh`
- Modify: `skills/openspec-buddy/scripts/set-project-date.sh`
- Modify: `skills/openspec-buddy/evals/relationship-cache-invalidation.test.sh`
- Modify: `skills/openspec-buddy/evals/project-cache.test.sh`
- Modify: `skills/openspec-buddy/evals/verify-review-clear-cache.test.sh`

**Policy:**

| Read surface | Normal behavior | Critical behavior |
|---|---|---|
| Issue/PR object | 600-second cache | `OPENSPEC_BUDDY_CACHE_REFRESH=1` before claim/review/merge/archive coordination |
| Relationship/ready scan | 120-second cache and batch size 25 | force refresh immediately before claim/dependency acceptance |
| Project metadata | 24-hour cache for read-only lookup | force-refresh subject and field metadata before every Project write |
| Raw PR REST bundle | same-run prefetch only | invalidate or require supplied fresh files at every clearance gate |

- [ ] **Step 1: Add explicit live wrappers.**

Add `buddy_live_issue_json`, `buddy_live_pr_json`, and `buddy_live_project_metadata_json` in `github-fetch.sh`. Each wrapper must set `OPENSPEC_BUDDY_CACHE_REFRESH=1` for the call and restore the previous value before returning. Do not change the default TTLs.

- [ ] **Step 2: Force final relationship truth in both claim paths.**

Wrap the final `buddy_issue_relationships_graphql` call in `claim-issue.sh` and `claim-change.sh` with `OPENSPEC_BUDDY_CACHE_REFRESH=1`. Selector scans may still use the 120-second relationship cache, but a candidate cannot pass the claim dependency gate from that cache.

- [ ] **Step 3: Force coordination and Project inputs.**

Use live issue/PR wrappers in `verify-pr-coordination.sh`. Use live subject and Project metadata wrappers in `set-project-status.sh` and `set-project-date.sh`; retain their existing post-write GraphQL verification and cache invalidation.

- [ ] **Step 4: Close the raw PR bundle reuse gap.**

`verify-review-clear.sh` may reuse provided files only when the caller explicitly supplies the complete bundle from the same run. Otherwise it must invalidate all five raw REST files and fetch them anew. `OPENSPEC_BUDDY_REUSE_PR_REST_CACHE=1` must not permit an old on-disk bundle to become a clearance source.

- [ ] **Step 5: Add cache regression cases.**

Cover these sequences:

```text
cached status:ready -> remote status:claimed       => claim path re-reads and blocks/reconciles
cached no blockers -> remote blockedBy added        => final claim relationship check refuses claim
cached Project item/field -> remote item changed   => write refreshes and verifies new item/field
old raw PR bundle -> new quota/unavailable response => review gate does not reuse old bundle
```

- [ ] **Step 6: Run focused cache tests and commit.**

Run: `rtk bash skills/openspec-buddy/evals/relationship-cache-invalidation.test.sh`

Run: `rtk bash skills/openspec-buddy/evals/project-cache.test.sh`

Run: `rtk bash skills/openspec-buddy/evals/verify-review-clear-cache.test.sh`

Expected: normal scans retain cache hits; critical paths always observe the changed fixture state.

Commit: `git add skills/openspec-buddy/scripts skills/openspec-buddy/evals && git commit -m "fix: force fresh truth at coordination gates"`

### Task 5: Add Bounded Cache and Stale-Recovery Metrics

**Files:**

- Create: `skills/openspec-buddy/scripts/cache-metrics.mjs`
- Modify: `skills/openspec-buddy/scripts/buddy-cache.mjs`
- Modify: `skills/openspec-buddy/scripts/github-fetch.sh`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify: `skills/openspec-buddy/evals/cache-metrics.test.sh`

**Interface:**

```text
cache-metrics.mjs event <cache-dir> <kind> <surface> <outcome> [json-context]
cache-metrics.mjs summary <cache-dir>
```

- [ ] **Step 1: Add a best-effort append-only event format.**

Each event must contain `at`, `kind`, `surface`, `outcome`, and `source`. Allowed outcomes are `hit`, `miss`, `forced_refresh`, `managed_request`, and `stale_recovery`. Metric write failure must never fail a GitHub operation.

- [ ] **Step 2: Instrument only shared, measurable surfaces.**

Record cache hit/miss/forced-refresh in `buddy-cache.mjs` and managed REST/GraphQL request batches in `github-fetch.sh`. Record `stale_recovery` when a live claim or live review reconciliation rejects persisted state. Name the aggregate `managed_github_request_batches`; do not report it as every raw GitHub request because 77 direct `gh` call sites remain outside the shared fetch wrapper.

- [ ] **Step 3: Add summary and regression tests.**

The summary must return numeric counters and zero for absent categories:

```json
{"cacheHit":2,"cacheMiss":1,"forcedRefresh":1,"managedGithubRequestBatches":3,"staleRecovery":1}
```

Run: `rtk bash skills/openspec-buddy/evals/cache-metrics.test.sh`

Expected: `cache-metrics tests passed.`

- [ ] **Step 4: Commit the instrumentation.**

Commit: `git add skills/openspec-buddy/scripts/cache-metrics.mjs skills/openspec-buddy/scripts/buddy-cache.mjs skills/openspec-buddy/scripts/github-fetch.sh skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs skills/openspec-buddy/evals/cache-metrics.test.sh && git commit -m "feat: measure cache and stale recovery outcomes"`

### Task 6: Document Semantics, Recovery, and Verification

**Files:**

- Modify: `skills/openspec-buddy-auto/SKILL.md`
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/failure-recovery.md`
- Modify: `skills/openspec-buddy/references/claim-locking.md`
- Modify: `test/run-all-tests.mjs`

- [ ] **Step 1: Document the state authority table.**

Document exactly:

```text
GitHub issue/PR/Project/review truth = authorization source
auto-controller = persisted intent and interrupt
auto-lanes = scheduling and recovery snapshot
auto-state receipts = local audit/idempotency hint
ordinary caches = bounded read accelerators
```

- [ ] **Step 2: Document recovery rules.**

State that process restart, worktree switch, stale receipt, expired claim, `request_missing`, and timeout recovery all require a new live check. A foreign claim never triggers takeover. A missing or expired claim with branch/PR residue remains blocked until the existing stale-claim recovery path proves it safe.

- [ ] **Step 3: Register all new evals and run syntax checks.**

Run: `rtk bash -n skills/openspec-buddy/scripts/*.sh`

Run: `rtk node --check skills/openspec-buddy/scripts/cache-metrics.mjs`

Run: `rtk node --check skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`

Expected: all commands exit 0.

- [ ] **Step 4: Run the complete verification chain.**

Run: `rtk node test/run-all-tests.mjs full`

Run: `rtk npm pack --dry-run`

Expected: `full tests passed.` and a successful package dry run for the version inherited from `origin/main`.

- [ ] **Step 5: Self-review the plan implementation.**

Check that no production path uses `validReceipt`, `threadCacheFreshForHead`, or a cache hit as a substitute for the live claim/review/merge/archive/Project gate. Check that normal selector and passive review polling still use their bounded caches. Repeat focused tests after every correction.

Commit: `git add skills/openspec-buddy-auto/SKILL.md skills/openspec-buddy-auto/references skills/openspec-buddy/references/claim-locking.md test/run-all-tests.mjs && git commit -m "docs: define coordination cache authority"`

## Acceptance Criteria

- A valid local `claimed` receipt never skips the live claim probe.
- A released, expired, or foreign remote claim cannot be treated as current local ownership.
- Persisted `threadState=clear`, `review_clear`, `auto-lanes`, or `auto-controller` data cannot clear an interrupt without same-run fresh remote evidence.
- Relationship, issue/PR, Project, and raw review caches remain available for non-critical repeated reads.
- Claim dependency checks, review clearance, merge, archive, and Project writes use fresh remote inputs and post-write verification.
- Stale recovery preserves issue/PR/branch context and blocks unsafe continuation instead of silently freeing capacity or taking over another worktree's claim.
- Metrics distinguish cache hits, misses, forced refreshes, managed GitHub request batches, and stale-recovery events without claiming historical savings that were not measured.
- `rtk node test/run-all-tests.mjs full` and `rtk npm pack --dry-run` pass from a clean implementation worktree based on `origin/main`.
