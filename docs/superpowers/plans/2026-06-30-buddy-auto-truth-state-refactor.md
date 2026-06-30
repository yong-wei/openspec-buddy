# Buddy Auto Truth-State Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Buddy Auto so multi-lane review wait, review-fix closeout, GitHub truth checks, and local state recovery are driven by shared abstractions and one controller entrypoint.

**Architecture:** `skills/openspec-buddy-auto/scripts/buddy-auto.mjs` is the only normal auto-flow entry. Child drivers and deterministic helpers remain strict and are invoked by the controller through shared runner/truth modules. REST probe decides whether deeper checks are needed; GraphQL is reserved for reviewThreads, issue relationships, and required mutations.

**Tech Stack:** Node.js ESM scripts, Bash helpers, GitHub CLI REST/GraphQL, `openspec/.buddy-cache/`, shell evals, Node evals.

---

## Non-Negotiable Principles

- Normal auto flow has exactly one script entrypoint: `buddy-auto.mjs`.
- `HANDOFF` and `BLOCKED` are persistent interrupts; after external work, the next command is always `buddy-auto.mjs`.
- Common actions belong in shared abstractions: lane switch, claim/worktree guard, review truth, review request, response gate, status/project sync, GitHub access, and cache updates.
- Ordinary waiting polls use REST only. They must not call `verify-review-clear.sh` or reviewThreads GraphQL.
- GraphQL is allowed only for reviewThreads truth, issue relationship edges, and required mutations.
- Cache records minimal facts and freshness. It can decide whether to deepen checks, but cannot prove claim, review clear, merge, or achievement truth.
- Multi-lane mode is one foreground writer with multiple parked lanes, not parallel development.

## Current Dirty Worktree Policy

The current dirty files are input evidence, not accepted implementation:

- `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- `skills/openspec-buddy/scripts/check-review-clear-once.sh`

Preserve only these ideas if they pass this plan:

- `check-review-clear-once.sh`: waitable failures exit `1`; actionable review feedback exits `3`.
- `verify-once`: may exist only as controller-owned merge-ready recovery.

Do not preserve:

- `waiting + present-current-head -> checkLaneReview()`. It violates light polling and already regresses `buddy-auto-lane-driver.test.mjs`.

## Files

- Create `skills/openspec-buddy-auto/scripts/review-truth.mjs`: pure review truth normalization and freshness helpers.
- Create `skills/openspec-buddy-auto/scripts/auto-decision.mjs`: single truth-to-action decision table.
- Create `skills/openspec-buddy-auto/scripts/lane-action-runner.mjs`: lane-bound action wrapper.
- Create `skills/openspec-buddy-auto/scripts/controller-reconciler.mjs`: stale interrupt reconciliation.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`: run reconciler before child dispatch.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`: enforce controller-child execution and keep single-lane command execution only.
- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`: keep lane iteration; delegate truth, decision, and helper execution.
- Modify `skills/openspec-buddy-auto/scripts/lane-state.mjs`: add truth fields and optional history.
- Modify `skills/openspec-buddy-auto/scripts/controller-state.mjs`: preserve new lane/history schema during bootstrap/reset.
- Modify `skills/openspec-buddy/scripts/check-review-clear-once.sh`: lock exit status contract.
- Modify docs under `skills/openspec-buddy-auto/`.
- Add evals for each new abstraction and affected path.

## Shared Contracts

### Review Truth

`review-truth.mjs` owns this normalized shape:

```json
{
  "pr": "743",
  "head": "abc123",
  "probeState": "waiting",
  "requestState": "present-current-head",
  "actionableState": "unknown",
  "threadState": "unknown",
  "restFreshAt": "2026-06-30T00:00:00.000Z",
  "threadsFreshAt": "",
  "threadsHead": "",
  "signature": "{}"
}
```

Rules:

- REST probe may set `probeState`, `requestState`, `restFreshAt`, and `signature`.
- GraphQL thread checks may set `threadState`, `actionableState`, `threadsFreshAt`, and `threadsHead`.
- If `head` changes, stale `threadsHead` is invalid.
- Cached `requestState=present-current-head` cannot clear an interrupt by itself.
- Clearing stale review interrupts requires fresh REST truth from the current controller run, or a same-run probe whose signature matches the lane state being reconciled.
- `request_missing` is a controller-owned recovery trigger. It may request review only after fresh same-head thread truth is `clear` or response gate proves no unresolved actionable threads.

### Decision Table

`auto-decision.mjs` owns truth-to-action mapping:

```javascript
export function decideLaneAction({ lane, reviewTruth, controllerInterrupt }) {}
```

Allowed actions:

```text
keep-waiting
deep-check-review
request-current-head-review
enter-review-fix
enter-merge-ready
complete-post-merge
block
```

Rules:

- `waiting + present-current-head + unchanged signature` -> `keep-waiting`.
- `changed`, `review_returned`, or same-head `head_changed` -> `deep-check-review`.
- `request_missing` without fresh clear thread truth -> `deep-check-review`.
- `request_missing` with fresh same-head clear thread truth -> `request-current-head-review`.
- `actionable` -> `enter-review-fix`.
- `clear` -> `enter-merge-ready`.

The lane driver and controller must not duplicate this table.

### Lane Action Runner

`lane-action-runner.mjs` owns lane-bound helper execution:

```javascript
export function runLaneAction(state, lane, actionSpec, options = {}) {}
```

It must:

- Refuse dirty worktrees.
- Switch to `lane.branch`.
- Run `verify-claim-worktree.sh --issue <issue> --pr <pr>`.
- Run the requested helper.
- Refresh minimal REST truth.
- Atomically write lane state.
- Return structured success or blocked data.

### Controller Reconciler

`controller-reconciler.mjs` runs before each child dispatch.

It may clear `reviewFix.pending` or `request_missing` only when:

- The same `pr/head` is involved.
- Fresh REST truth says `waiting + present-current-head`.
- Signature is unchanged since the last deep check, or same-head thread truth is `clear`.

It must not clear:

- Different-head state.
- Changed signature with unknown thread truth.
- Unresolved/actionable thread truth.
- Dirty worktree, foreign claim, or guard failure blockers.

### Runtime Entrypoint Guard

- `buddy-auto-driver.mjs` and `buddy-auto-lane-driver.mjs` refuse direct execution whenever `OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD` is not set, except `-h|--help`.
- `buddy-auto.mjs` is the only normal path that sets child mode.
- Eval fixtures may use an internal test override only for direct unit tests of child drivers; production docs must not mention it.

## Task 1: Lock Review Status Contract

**Files:**

- `skills/openspec-buddy/scripts/check-review-clear-once.sh`
- `skills/openspec-buddy/evals/check-review-clear-once.test.sh`

- [ ] Add actionable test: fake verifier prints `unresolved review thread: PRRT_123 contains P1` and exits nonzero; `check-review-clear-once.sh` must exit `3`.
- [ ] Keep waitable test: fake verifier prints `No review found for current head`; helper exits `1`.
- [ ] Verify status contract:

```text
0 = current-head review clear
1 = waitable, no action yet
2 = infrastructure or protocol failure
3 = actionable review feedback exists
```

- [ ] Run `rtk bash skills/openspec-buddy/evals/check-review-clear-once.test.sh`.

## Task 2: Add Review Truth and Decision Modules

**Files:**

- `skills/openspec-buddy-auto/scripts/review-truth.mjs`
- `skills/openspec-buddy-auto/scripts/auto-decision.mjs`
- `skills/openspec-buddy-auto/evals/review-truth.test.mjs`

- [ ] Add pure tests for `classifyProbe`, `mergeReviewTruth`, `threadCacheFreshForHead`, and `laneWaitingWithCurrentHead`.
- [ ] Add decision tests for every allowed action.
- [ ] Ensure `request_missing` without fresh thread truth returns `deep-check-review`, not request review.
- [ ] Ensure `waiting + present-current-head + unchanged signature` returns `keep-waiting`.
- [ ] Run `rtk node skills/openspec-buddy-auto/evals/review-truth.test.mjs`.

## Task 3: Add Lane Action Runner

**Files:**

- `skills/openspec-buddy-auto/scripts/lane-action-runner.mjs`
- `skills/openspec-buddy-auto/evals/lane-action-runner.test.mjs`

- [ ] Test command order: `git status --porcelain`, `git switch <branch>`, `verify-claim-worktree.sh`, helper.
- [ ] Test dirty worktree refusal: no branch switch and no helper call.
- [ ] Test guard failure returns `blocked` with lane, issue, pr, branch, head, current branch.
- [ ] Test success writes lane patch atomically.

## Task 4: Add Controller Reconciler

**Files:**

- `skills/openspec-buddy-auto/scripts/controller-reconciler.mjs`
- `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`
- `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] Positive test: stale `reviewFix.pending` and `request_missing` clear only with same PR/head, fresh REST truth, unchanged signature or thread clear.
- [ ] Negative test: different head does not clear.
- [ ] Negative test: changed signature with unknown thread truth does not clear.
- [ ] Negative test: unresolved/actionable thread truth does not clear.
- [ ] Negative test: dirty worktree or foreign claim interrupt does not clear.
- [ ] Integrate reconciler after `initializeControllerState()` and before child dispatch.

## Task 5: Enforce Runtime Single Entrypoint

**Files:**

- `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] Test direct single driver blocks when controller state exists and child mode is absent.
- [ ] Test direct lane driver blocks when controller state exists and child mode is absent.
- [ ] Test direct single driver also blocks in a fresh worktree with no controller state when child mode is absent.
- [ ] Test direct lane driver also blocks in a fresh worktree with no controller state when child mode is absent.
- [ ] Test child mode permits controller-internal execution.
- [ ] Test `-h|--help` still works without child mode.
- [ ] Add a `buddy-auto-driver.test.mjs` regression for `OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE=verify-once`: it must run exactly one `verify-review-clear.sh <pr>` command, must not run `wait-for-review-clear.sh`, and must record `review_clear`.

## Task 6: Fix Lane Scheduler Boundaries

**Files:**

- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- `skills/openspec-buddy-auto/scripts/auto-decision.mjs`
- `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] Preserve the existing `claim-next` regression test: a waiting lane with no REST signature change must not run full review clear before filling available capacity.
- [ ] Remove ordinary `waiting + present-current-head -> checkLaneReview()` deep check.
- [ ] Allow deep check only through `auto-decision.mjs` for explicit triggers: changed, review_returned, head_changed, retry finalization, review_fix, merge_ready, achievement, or request_missing recovery.
- [ ] Run `rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`.

## Task 7: Recover request_missing Safely

**Files:**

- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- `skills/openspec-buddy-auto/scripts/controller-reconciler.mjs`
- `skills/openspec-buddy-auto/scripts/auto-decision.mjs`
- `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`

- [ ] Test `request_missing + unknown thread truth` runs controlled deep check and does not request review.
- [ ] Test `request_missing + same-head clear thread truth` switches lane, verifies guard, requests review, writes `waiting_review + present-current-head`, and clears stale interrupt.
- [ ] Test switch or guard failure remains lane-aware `BLOCKED`.
- [ ] Implement only through `lane-action-runner.mjs`.

## Task 8: Normalize Lane State and History

**Files:**

- `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- `skills/openspec-buddy-auto/scripts/controller-state.mjs`
- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- `skills/openspec-buddy-auto/evals/lane-state.test.mjs`
- `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] Add optional fields: `probeState`, `requestState`, `actionableState`, `threadState`, `restFreshAt`, `threadsFreshAt`, `threadsHead`.
- [ ] Test old cache with only `lanes` still reads.
- [ ] Test new cache round-trip preserves `history`.
- [ ] Test capacity ignores `history` and `done` lanes.
- [ ] Test selector exclusions ignore `history` but include active lanes.
- [ ] Fold terminal done lanes to `history` only after terminal truth is recorded.

## Task 9: Documentation

**Files:**

- `skills/openspec-buddy-auto/SKILL.md`
- `skills/openspec-buddy-auto/references/driver-states.md`
- `skills/openspec-buddy-auto/references/review-waiting.md`
- `skills/openspec-buddy-auto/references/failure-recovery.md`

- [ ] Document only `buddy-auto.mjs` as normal auto entry.
- [ ] Document REST probe vs GraphQL deep check boundaries.
- [ ] Document lane-aware interrupt fields: lane, issue, pr, branch, head, current_branch, allowed_action.
- [ ] Remove normal-flow instructions that tell agents to call deterministic helpers directly.

## Task 10: Verification

- [ ] Run focused tests:

```bash
rtk bash skills/openspec-buddy/evals/check-review-clear-once.test.sh
rtk node skills/openspec-buddy-auto/evals/review-truth.test.mjs
rtk node skills/openspec-buddy-auto/evals/lane-action-runner.test.mjs
rtk node skills/openspec-buddy-auto/evals/lane-state.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs
rtk node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

- [ ] Run full regression:

```bash
rtk npm test
rtk npm pack --dry-run
```

- [ ] Run at least two subagent reviews:

```text
Reviewer A: controller/lane state correctness and no path drift.
Reviewer B: GitHub quota, REST/GraphQL boundary, and cache freshness.
```

No merge, release, or package publication until both report no blocking findings.

## Acceptance Criteria

- Normal Buddy Auto execution exposes only `buddy-auto.mjs`.
- Internal child drivers block direct execution whenever child mode is absent, including fresh worktrees with no controller state.
- Ordinary waiting poll does not call `verify-review-clear.sh` or reviewThreads GraphQL.
- `request_missing` recovery requests review only after same-head fresh thread truth is clear.
- Stale `reviewFix.pending` cannot survive valid fresh waiting truth and cannot be cleared by stale cache.
- Helper guards remain strict; automation satisfies them by switching lanes.
- Dirty current worktree or wrong branch prevents lane-bound helper execution.
- GraphQL calls are centralized and tied to explicit deep-check triggers.
- Active lane capacity ignores done/history lanes.
- Existing no-issue/no-pr, single-lane, multi-lane, and goal-mode behavior remains compatible.
