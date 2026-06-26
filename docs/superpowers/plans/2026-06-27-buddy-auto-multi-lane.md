# Buddy Auto Multi-Lane Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in Buddy Auto multi-lane scheduling so a clean, submitted PR waiting for online Codex review can be parked while the same permanent worktree processes another executable issue.

**Architecture:** Keep the existing single-lane `buddy-auto-driver.mjs` as the default legal entry point. Add a multi-lane scheduler as a thin orchestration layer that owns lane state, safe branch switching, review polling, and capacity decisions, while delegating claim, PR coordination, review request, merge, and achievement to existing core helpers. Split the blocking single-PR wait logic into reusable non-blocking probe/check helpers, then keep `wait-for-review-clear.sh` as the single-lane compatibility wrapper.

**Tech Stack:** Node.js scripts, Bash helpers, GitHub CLI, existing Buddy cache under `openspec/.buddy-cache/`, existing npm test harness.

---

## Non-Negotiable Semantics

- Default `buddy-auto-driver.mjs` with no multi-lane authorization remains single-lane and blocking.
- Multi-lane is opt-in. Use a new explicit entry script, `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`, and optionally `OPENSPEC_BUDDY_AUTO_LANES=2`.
- Default multi-lane concurrency is `2`; hard cap is `3`; values below `1` or above `3` fail.
- There is still only one foreground write lane. The scheduler may switch away only after the current lane has committed, pushed, requested current-head Codex review, and passed safe-yield checks.
- The scheduler must never switch away during implementation, local subagent review, uncommitted review-fix work, same-thread reply work, merge, archive, or achievement.
- The scheduler must never rely on cache to decide claim ownership, review clearance, mergeability, or achievement. Cache is allowed only for lane receipts and lightweight polling acceleration.
- Review returned lanes have priority over claiming new issues. Merge/achievement lanes have priority over review-fix lanes. Review-fix lanes have priority over new claims.
- Active lane issues and branches are excluded from selector candidates.
- A multi-lane driver instance must hold an exclusive per-worktree lane lock before reading or writing lane state, switching branches, claiming issues, polling review state, or sending retry review requests.
- If all lanes are waiting and no review has returned, the scheduler is silent and polls all waiting PRs every `60s`.
- If a lane has no current-head clean review after `900s`, request exactly one forced follow-up review with retry context. After the second `900s` window without clearance, mark that lane blocked for human attention.

## File Structure

### New Files

- `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
  - Opt-in multi-lane scheduler entry point.
  - Loads lane state, chooses the next lane action, runs deterministic helpers, switches branches only through safe gates, and waits silently when all lanes are parked.

- `skills/openspec-buddy-auto/scripts/lane-state.mjs`
  - Focused JSON state module.
  - Reads/writes `openspec/.buddy-cache/auto-lanes/<worktree-key>.json`.
  - Validates schema, caps lane count, normalizes lane stages, prunes terminal lanes.
  - Provides exclusive lock helpers for the scheduler.

- `skills/openspec-buddy-auto/scripts/lane-switch-gate.mjs`
  - Focused safety checker for switching away from or into a lane.
  - Uses `git status --porcelain`, `git rev-parse`, `git branch --show-current`, `git worktree list --porcelain`, `gh pr view`, and existing `verify-claim-worktree.sh`.

- `skills/openspec-buddy/scripts/probe-review-state.sh`
  - Non-blocking lightweight PR review probe.
  - Uses REST signature and request-state checks only.
  - Does not call GraphQL or full `verify-review-clear.sh`.

- `skills/openspec-buddy/scripts/check-review-clear-once.sh`
  - Non-blocking full review check.
  - Reuses existing REST bundle cache when available.
  - Calls the current-head request gate, then one and only one full review truth gate.

- `skills/openspec-buddy/evals/probe-review-state.test.sh`
  - Tests lightweight probe behavior and confirms no GraphQL/full verifier call during unchanged idle probes.

- `skills/openspec-buddy/evals/check-review-clear-once.test.sh`
  - Tests one-shot full review check behavior.

- `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
  - Tests lane scheduling, safe yield, active-lane exclusion, retry, and priority rules.

### Modified Files

- `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
  - Add a non-blocking review-yield mode used only by the multi-lane scheduler.
  - Preserve default single-lane behavior.

- `skills/openspec-buddy/scripts/wait-for-review-clear.sh`
  - Refactor duplicated inner logic to call `probe-review-state.sh` and `check-review-clear-once.sh`.
  - Preserve existing command-line behavior and tests.

- `skills/openspec-buddy/scripts/select-next-change.sh`
  - Accept `OPENSPEC_BUDDY_EXCLUDE_ISSUES` or `OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE`.
  - Pass exclusions to `select-next-change.mjs`.

- `skills/openspec-buddy/scripts/select-next-change.mjs`
  - Skip excluded issue numbers before applying normal ordering.
  - Keep smallest-number selection semantics for non-excluded candidates.

- `skills/openspec-buddy-auto/SKILL.md`
  - Keep the primary instruction simple.
  - Add explicit multi-lane opt-in block: use lane driver, then wait silently for its output.

- `skills/openspec-buddy-auto/references/driver-states.md`
  - Document lane states and how they relate to existing receipts.

- `skills/openspec-buddy-auto/references/review-waiting.md`
  - Split single-lane foreground wait from multi-lane pooled waiting.

- `skills/openspec-buddy-auto/references/execution-loop.md`
  - Document safe-yield conditions and priorities.

- `test/run-all-tests.mjs`
  - Register the new evals.

## Lane State Schema

Store one JSON file per bound worktree:

```text
openspec/.buddy-cache/auto-lanes/<worktree-key>.json
```

The scheduler must also create a sibling lock file:

```text
openspec/.buddy-cache/auto-lanes/<worktree-key>.lock
```

Locking rule:

- The lane driver opens the lock file and takes an exclusive lock before reading lane state.
- The lock is held until the driver exits with `DONE`, `BLOCKED`, or `HANDOFF`, including any pooled wait period.
- If `flock` is available, use `flock -n` semantics through a small Node lock helper or direct file-descriptor lock. If `flock` is unavailable, use an atomic `mkdir <lock>.d` fallback with `pid`, `startedAt`, and `cwd` metadata.
- A second lane driver in the same worktree must return `BLOCKED lane-driver-already-running`; it must not poll, claim, switch branches, or send retry review requests.
- A stale lock may be broken only if the recorded PID no longer exists and the lock age exceeds `OPENSPEC_BUDDY_AUTO_LANE_LOCK_STALE_SECONDS`, default `7200`.

Initial schema:

```json
{
  "version": 1,
  "worktree": {
    "path": "/absolute/worktree/path",
    "alias": "dev1",
    "pathHash": "sha256-prefix",
    "boundBranch": "dev1",
    "boundBase": "origin/integration"
  },
  "maxLanes": 2,
  "lanes": [
    {
      "id": "issue-675",
      "issue": "675",
      "change": "audit-remediation-arena-publication-context",
      "branch": "audit-remediation-arena-publication-context",
      "pr": "707",
      "head": "abc123",
      "stage": "waiting_review",
      "claimId": "claim-...",
      "reviewRequestedAt": "2026-06-27T10:00:00.000Z",
      "reviewRetryCount": 0,
      "lastProbeAt": "2026-06-27T10:05:00.000Z",
      "lastSignature": "{\"head\":\"abc123\"}",
      "lastResult": "waiting",
      "blockedReason": "",
      "updatedAt": "2026-06-27T10:05:00.000Z"
    }
  ]
}
```

Allowed lane stages:

```text
claiming
implementing
pr_opened
review_requested
waiting_review
review_returned
review_fix
merge_ready
achieving
done
blocked
```

The lane state is not GitHub truth. It only answers scheduler questions:

- Which issues/branches are already active in this worktree?
- Which PRs are waiting for review?
- Which branch can be safely resumed?
- Has the retry request already been used for this head?

Capacity, retry count, and last probe fields are local scheduler state and are valid only while protected by the per-worktree lock. They must not be read by a second process without acquiring the same lock.

## Scheduler Algorithm

### Startup

- [ ] Load worktree binding with `git config --worktree buddy.boundBranch`, `buddy.boundBase`, and `buddy.worktreeAlias`.
- [ ] Acquire the per-worktree lane lock. If another lane driver holds it, return `BLOCKED lane-driver-already-running`.
- [ ] Run `verify-bound-worktree.sh --phase goal-loop-start` when not currently on an active lane branch.
- [ ] Load lane state and discard terminal `done` lanes older than one successful scheduler cycle.
- [ ] Validate `maxLanes` from `OPENSPEC_BUDDY_AUTO_LANES`, defaulting to `2`, hard-capped at `3`.
- [ ] Refuse to start if the worktree is dirty.

### Priority Loop

- [ ] If any lane has `stage=review_returned`, switch to that lane and run the normal driver until it reaches a handoff, terminal state, or the next safe review wait.
- [ ] If any lane has `stage=merge_ready`, switch to that lane and run merge/achievement gates before new work.
- [ ] If any lane has `stage=review_fix`, switch to that lane and hand off only the requested review-fix work.
- [ ] If there is free capacity and goal mode is authorized, switch to bound branch, run selector with active lane exclusions, and claim the next issue through existing `buddy-auto-driver.mjs`.
- [ ] If all active lanes are `waiting_review`, enter pooled silent polling.
- [ ] If no active lanes and selector returns no candidate, return `DONE no_available_changes`.

### Safe Yield From A Lane

A lane may be parked only if all conditions are true:

- [ ] `git status --porcelain` is empty.
- [ ] Current branch equals the lane branch.
- [ ] `verify-claim-worktree.sh --issue <issue> --pr <pr>` passes.
- [ ] `gh pr view <pr> --json headRefName,headRefOid,state` reports the lane branch, lane head, and open PR.
- [ ] `git ls-remote --heads origin <branch>` reports the lane branch exists.
- [ ] `verify-current-head-review-request.sh <pr>` passes.
- [ ] `verify-review-threads-resolved.sh <pr>` passes when the lane is a review-fix follow-up.
- [ ] The lane head is pushed; `git rev-parse HEAD` equals PR `headRefOid`.

If any condition fails, the scheduler returns `BLOCKED` and does not switch branches.

### Pooled Review Polling

- [ ] For every `waiting_review` lane, run `probe-review-state.sh <pr>` at most once per interval.
- [ ] `probe-review-state.sh` returns JSON with:
  - `pr`
  - `head`
  - `signature`
  - `requestState`
  - `state`: `waiting`, `changed`, `review_returned`, `request_missing`, `head_changed`, or `blocked`
  - `requestAgeSeconds`
  - `retryDue`
- [ ] If a lane returns `review_returned` or `changed`, switch to that lane and run `check-review-clear-once.sh <pr>`.
- [ ] If `check-review-clear-once.sh` passes, mark the lane `merge_ready`.
- [ ] If `check-review-clear-once.sh` reports actionable review feedback, mark the lane `review_fix` and return `HANDOFF`.
- [ ] If the lane has waited at least `900s` and `reviewRetryCount=0`, generate retry context and run `request-pr-review.sh <pr> --force --context-file <file>`.
- [ ] If the lane has waited another `900s` after retry, mark the lane `blocked` with `needs-human` reason.
- [ ] If all lanes remain `waiting`, sleep `60s` and emit no progress output.
- [ ] If all lanes are waiting, there is spare capacity, and goal mode remains authorized, the scheduler may claim another issue only after the current foreground lane has passed safe-yield checks and the active lane count is below `maxLanes`.

## Review Helper Boundaries

### `probe-review-state.sh`

Responsibilities:

- Resolve PR number.
- Run `verify-claim-worktree.sh --pr <pr>` unless `OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD=1` is set for tests.
- Read lightweight REST PR signature via `buddy_pr_signature_rest`.
- Read current-head request state using a minimal PR/commits/comments set only when the signature changed, no cached request state exists for the same head, or the caller passes `--force-request-state`.
- Compare with an optional prior signature file or `OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE`.
- Return JSON only.

Must not:

- call `verify-review-clear.sh`
- call `buddy_review_threads_graphql`
- call `gh api graphql`
- post comments
- sleep

When the signature is unchanged and the caller supplies the previous `requestState`, the probe must reuse it. This keeps pooled idle polling to the smallest REST surface.

### `check-review-clear-once.sh`

Responsibilities:

- Resolve PR number.
- Run current-head review request gate.
- Refresh/reuse PR REST bundle once.
- Run exactly one full review truth command, normally `verify-review-clear.sh`.
- Do not separately run `verify-review-threads-resolved.sh` before `verify-review-clear.sh` on the normal path, because `verify-review-clear.sh` already reads reviewThreads.
- Only run `verify-review-threads-resolved.sh` instead of `verify-review-clear.sh` when the caller explicitly requests a pre-wait response-gate check for a review-fix context; do not run both in the same one-shot check.
- Return clear exit codes:
  - `0`: clean current-head review
  - `1`: waitable review not clean
  - `2`: hard blocker or verifier error
  - `3`: actionable review feedback that requires review-fix handoff

Must not:

- sleep
- request another review
- mutate GitHub state

### `wait-for-review-clear.sh`

Responsibilities after refactor:

- Preserve existing single-lane behavior.
- Use `probe-review-state.sh` during idle polls.
- Use `check-review-clear-once.sh` on changes, boundary checks, and timeout checks.
- Keep the existing two-round behavior: first `900s`, forced retry, second `900s`, then exit `124`.
- Preserve the existing startup thread gate behavior without making later full checks perform duplicate GraphQL queries.

## Single-Lane Driver Integration

- [ ] Add an environment-only mode `OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE=yield`.
- [ ] In `buddy-auto-driver.mjs`, when the next stage is `wait-review` and the mode is `yield`, verify safe preconditions through a new core helper command supplied by the lane scheduler and return `DONE stage: review-yield` instead of running the blocking wait.
- [ ] Yield mode must not record `review_clear`; it may only preserve the existing `review_requested` receipt created by `mark-review.sh` or fail if that receipt/current-head request is missing.
- [ ] Without that environment variable, `wait-review` continues to invoke `wait-for-review-clear.sh`.
- [ ] The normal no-argument driver remains the only required entry point for single-lane skill use.

## Retry Idempotency

- [ ] Retry requests must be deduplicated with GitHub truth, not only lane state.
- [ ] The retry context generated by the scheduler must include a stable marker:
  ```text
  OpenSpec Buddy review retry
  lane_id: <lane-id>
  head: <head-sha>
  retry_round: <n>
  ```
- [ ] Before calling `request-pr-review.sh --force`, the scheduler must read issue comments for the PR and check whether the same marker already exists for the same `head` and `retry_round`.
- [ ] If the marker exists, update lane state as already retried and do not post another forced comment.
- [ ] If the marker does not exist and `reviewRetryCount=0`, post exactly one forced retry.
- [ ] If two lane drivers race, the per-worktree lock must prevent duplicate retry attempts in the same worktree. The GitHub marker prevents duplicate retry after a stale lock recovery or manual rerun.

## Selector Exclusion

- [ ] Add `OPENSPEC_BUDDY_EXCLUDE_ISSUES=675,676` support in `select-next-change.sh`.
- [ ] Add `OPENSPEC_BUDDY_EXCLUDE_ISSUES_FILE=<path>` support for larger scheduler state.
- [ ] Pass `excludeIssues` into `select-next-change.mjs`.
- [ ] Skip excluded issues before stale-claim fallback.
- [ ] Test that issue `675` is excluded and issue `676` is selected when both are otherwise executable.

## Documentation Changes

- [ ] `SKILL.md`: Add one compact multi-lane instruction block:
  - use `buddy-auto-lane-driver.mjs` only when the user explicitly asks for multi-lane mode
  - after starting it, do not output, query, or run commands until it returns
  - if it returns `HANDOFF`, do only that lane's requested work
- [ ] `driver-states.md`: Add lane stages and state file schema.
- [ ] `review-waiting.md`: Separate single-lane foreground wait from multi-lane pooled wait.
- [ ] `execution-loop.md`: Add safe-yield rule after `mark-review.sh`/review request.

## Test Plan

### Unit And Script Tests

- [ ] `lane-state.mjs` rejects invalid concurrency, normalizes missing fields, and prunes old terminal lanes.
- [ ] `lane-state.mjs` enforces a per-worktree lock; a second scheduler process returns blocked without reading capacity or mutating state.
- [ ] stale lock recovery requires a dead PID and lock age beyond the configured stale threshold.
- [ ] `lane-switch-gate.mjs` rejects dirty worktree, detached HEAD, wrong branch, unpushed head, wrong PR head, and foreign claim guard failure.
- [ ] `probe-review-state.sh` performs only lightweight REST calls and emits JSON without sleeping.
- [ ] `probe-review-state.sh` reuses previous request state when the signature is unchanged.
- [ ] `probe-review-state.sh` returns `request_missing` when the current head lacks a review request.
- [ ] `probe-review-state.sh` returns `changed` when the lightweight signature changes.
- [ ] `check-review-clear-once.sh` returns `0`, `1`, `2`, and `3` for clean, waitable, hard-error, and actionable verifier outputs.
- [ ] `check-review-clear-once.sh` does not call both `verify-review-threads-resolved.sh` and `verify-review-clear.sh` in the same normal full check.
- [ ] `wait-for-review-clear.sh` existing tests continue to pass after the helper split.

### Scheduler Tests

- [ ] With lane A `waiting_review` and capacity `2`, goal mode selects and claims lane B.
- [ ] With lane A and B both `waiting_review`, unchanged probes do not call the full verifier or GraphQL helpers.
- [ ] If lane B receives review first, scheduler switches to B, not A.
- [ ] If lane A is dirty, scheduler returns `BLOCKED` before switching away.
- [ ] If lane A is missing current-head review request, scheduler returns `BLOCKED` and does not claim lane B.
- [ ] If lane A reaches `900s`, scheduler calls `request-pr-review.sh --force --context-file` once and records retry count.
- [ ] If lane A reaches `900s` and a retry marker already exists in GitHub comments for the same head/round, scheduler does not call `request-pr-review.sh --force` again.
- [ ] If lane A times out after retry, scheduler marks only lane A blocked and can continue lane B if safe.
- [ ] Active lane issue numbers are excluded from selector.
- [ ] Default `buddy-auto-driver.mjs` still invokes `wait-for-review-clear.sh` and does not enter lane scheduling.
- [ ] Default `maxLanes=2`; `OPENSPEC_BUDDY_AUTO_LANES=3` is accepted; `4` is rejected.
- [ ] Scheduler rejects lane switching during local subagent review, uncommitted implementation, and review-fix before response gate.
- [ ] If all waiting lanes have no returned review, scheduler emits no progress and either keeps pooled polling or claims another issue only when capacity and safe-yield rules allow it.

### Regression

- [ ] `rtk npm test`
- [ ] `rtk npm pack --dry-run`
- [ ] Focused reruns:
  - `rtk node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`
  - `rtk bash skills/openspec-buddy/evals/wait-for-review-clear.test.sh`
  - `rtk bash skills/openspec-buddy/evals/request-pr-review.test.sh`
  - `rtk node skills/openspec-buddy-auto/evals/select-next-change.test.mjs`

## Implementation Order

### Task 1: Extract Non-Blocking Review Helpers

**Files:**
- Create: `skills/openspec-buddy/scripts/probe-review-state.sh`
- Create: `skills/openspec-buddy/scripts/check-review-clear-once.sh`
- Modify: `skills/openspec-buddy/scripts/wait-for-review-clear.sh`
- Test: `skills/openspec-buddy/evals/probe-review-state.test.sh`
- Test: `skills/openspec-buddy/evals/check-review-clear-once.test.sh`
- Modify: `test/run-all-tests.mjs`

- [ ] Write tests for lightweight probe and one-shot full check.
- [ ] Implement helpers by moving existing logic out of `wait-for-review-clear.sh`.
- [ ] Refactor `wait-for-review-clear.sh` to call helpers without changing its interface.
- [ ] Run focused review wait tests.

### Task 2: Add Lane State And Switch Gate

**Files:**
- Create: `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- Create: `skills/openspec-buddy-auto/scripts/lane-switch-gate.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
- Modify: `test/run-all-tests.mjs`

- [ ] Write lane state schema tests.
- [ ] Write lock acquisition, second-process blocked, and stale-lock recovery tests.
- [ ] Write switch gate tests with fake `git`, `gh`, and helper commands.
- [ ] Implement minimal state load/save/prune and safe-yield checks.
- [ ] Implement the lock before adding scheduler capacity decisions.
- [ ] Keep all mutation and GitHub truth decisions delegated to existing helpers.

### Task 3: Add Selector Exclusions

**Files:**
- Modify: `skills/openspec-buddy/scripts/select-next-change.sh`
- Modify: `skills/openspec-buddy/scripts/select-next-change.mjs`
- Modify: `skills/openspec-buddy-auto/evals/select-next-change.test.mjs`

- [ ] Add tests for excluded issue numbers.
- [ ] Implement env/file exclusion parsing.
- [ ] Ensure normal smallest-number priority remains unchanged for non-excluded issues.

### Task 4: Add Multi-Lane Scheduler

**Files:**
- Create: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs`
- Modify: `test/run-all-tests.mjs`

- [ ] Write scheduler tests for capacity, waiting lanes, review returned priority, retry, blocked lane handling, and single-lane compatibility.
- [ ] First implement and test `OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE=yield` in `buddy-auto-driver.mjs` as a separate commit-sized change.
- [ ] Implement scheduler loop with a bounded deterministic step limit.
- [ ] Add `OPENSPEC_BUDDY_AUTO_REVIEW_WAIT_MODE=yield` behavior to the single-lane driver only for scheduler calls.
- [ ] Implement retry marker detection before forced retry requests.
- [ ] Ensure scheduler output is silent during pooled waiting and returns only on `DONE`, `BLOCKED`, or `HANDOFF`.

### Task 5: Update Skill Documentation

**Files:**
- Modify: `skills/openspec-buddy-auto/SKILL.md`
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/review-waiting.md`
- Modify: `skills/openspec-buddy-auto/references/execution-loop.md`
- Modify: `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

- [ ] Add concise multi-lane opt-in instructions.
- [ ] Preserve the strong “run driver and wait silently” instruction style.
- [ ] Clarify that local subagent review does not permit lane switching because the change is not yet committed/pushed/requested.
- [ ] Clarify that all review-fix same-thread reply and response gate work must complete before a lane can be parked again.

### Task 6: Full Verification And Review

**Files:**
- All changed files.

- [ ] Run focused tests from the regression list.
- [ ] Run `rtk npm test`.
- [ ] Run `rtk npm pack --dry-run`.
- [ ] Dispatch subagent review for plan coverage implementation.
- [ ] Dispatch subagent review for correctness and race-risk review.
- [ ] Fix all blocking findings and repeat review until no blocking findings remain.

## Implementation Constraints

- Use an isolated development worktree for implementation.
- Do not modify `main` directly.
- Do not change npm CLI public commands in this plan.
- Do not make multi-lane the default behavior.
- Do not introduce background daemons, hooks, reminders, or Codex automations.
- Do not increase GraphQL use during idle waiting; idle pooled polling must be REST-light only.
- Do not mutate GitHub from the pooled poll except the single allowed forced retry review request.
- Do not allow a blocked lane to hide other lane state; print the exact lane id, issue, PR, branch, and blocker.

## Acceptance Criteria

- Single-lane Buddy Auto behavior remains compatible and all existing tests pass.
- Multi-lane mode can park a clean waiting PR and claim a second issue in the same bound worktree.
- Multi-lane mode refuses to park dirty, unpushed, unreview-requested, foreign-claim, detached, or wrong-branch work.
- Multi-lane pooled wait polls multiple PRs every `60s` with lightweight REST only.
- A PR whose review returns first is resumed first regardless of lane order.
- A review request older than `900s` receives one forced retry with context; after the second `900s` window the lane becomes human-intervention blocked.
- Active lane issues are excluded from selector.
- No local subagent review, implementation, review-fix, merge, or archive work can be interleaved with another lane.
