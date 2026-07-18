# Buddy Auto Controller States（Full Mode Only）

本参考只描述显式 Full Mode，不适用于默认 lite。代理只能通过公开 `buddy-auto.mjs full` 入口使用这些状态。

The auto controller is the only normal entry point:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full
```

The single-lane and lane drivers are controller-owned internal engines. Do not
run them directly in normal auto operation. Diagnostic compatibility scripts may
exist, but the skill contract is controller-first.

## Controller State

Controller state is stored under:

```text
openspec/.buddy-cache/auto-controller/
```

It records:

```text
mode: single | multi
goal: true | false
maxLanes: 1..3
target issue / PR / change
reviewFix.pending
interrupt
```

First-run seed environment variables initialize state only when no controller
state exists. Existing controller state wins over stale environment values.

If no controller state exists but active legacy lane state exists under
`openspec/.buddy-cache/auto-lanes/`, the controller migrates into `multi` mode
and inherits that lane state's `maxLanes`. Active means the existing
`laneReservesCapacity(lane)` rule returns true for at least one lane.

Malformed legacy lane state blocks with `legacy-lane-state`; use the controller
reset-lane recovery command only when the local lane cache is abandoned or
unrecoverable.

## Interrupts

`HANDOFF` and `BLOCKED` are persistent interrupts.

For `HANDOFF`, the controller records the stage, issue/PR, allowed external
work, and resume action. The agent performs only that external work, then runs
the controller again.

For `BLOCKED`, the controller records the blocking stage and reason. The agent
fixes only that blocker, then runs the controller again.

The controller re-runs the relevant verifier or failed phase before it advances.
Agents do not choose helper scripts after a handoff or blocker.

## Internal Phase Graph

The controller internally advances deterministic phases until it reaches an
interrupt or terminal state:

```text
goal-select -> claim-issue -> issue-pr-bridge -> implement-handoff
issue-pr-bridge -> pr-coordination -> review-wait -> merge-gates -> achieved-truth
achieved-truth -> controller-owned merge -> merge_authorized -> merged
merged -> post-merge-achieve -> achieved

Review and merge interrupts are fail-closed:

```text
review request -> latest response unavailable -> BLOCKED(review-unavailable)
review request -> latest response clear -> merge gates -> controller merge
remote merged without merge_authorized -> BLOCKED(unauthorized-merge)
```
```

Review-fix continuation is stateful:

```text
review-fix-handoff -> response-gate -> current-head-review-request -> review-wait
```

`reviewFix.pending` must survive process restarts. It is cleared only after the
controller verifies that the response gate and current-head review request path
has safely advanced.

## Multi-Lane State

Multi-lane mode is controller state, not a separate agent-facing entrypoint.
The controller internally uses lane scheduling when `mode: multi`.

Lane state is stored under:

```text
openspec/.buddy-cache/auto-lanes/
```

Allowed lane stages:

```text
implementing
waiting_review
review_fix
merge_ready
review_unavailable
unauthorized_merge
done
blocked
retryable_blocked
```

Review wait lanes additionally record minimal truth freshness:

```text
probeState
requestState
actionableState
threadState
restFreshAt
threadsFreshAt
threadsHead
reviewRunId
reviewTruthSource
lastSignature
```

`probeState` and `requestState` come from lightweight REST probing. They may
keep a lane waiting or trigger a deeper check, but they do not prove review
clearance. `threadState` and `actionableState` come from the review-thread truth
path and are valid only for the matching `threadsHead`.

They are also valid only while `threadsFreshAt` is within the short review
truth TTL and `reviewRunId` matches the current controller run. A persisted
`threadState: clear` without current-run truth cannot clear a review interrupt
or authorize merge recovery.

The scheduler remains single-writer. It may park a clean lane only after commit,
push, current-head review request, matching PR head, clean worktree, and
claim-worktree guard pass.

Blocked lanes that still own an issue, PR, branch, or claim id reserve capacity.
Transient GitHub failures enter `retryable_blocked`; they are not empty slots.

## Truth Reads

The controller and internal drivers should read the smallest truth surface that
answers the current phase:

- local branch and HEAD for lane switching and stale-head recovery
- target PR state/head for that lane or PR only
- issue-to-PR bridge only for the owned issue
- lightweight review probe during idle review polling
- full review-clear check only after probe state changes or review-fix needs a
  current decision

Do not add repository-wide issue, PR, Project, or review-thread scans to the
auto controller.

`request_missing` is controller-owned recovery. It may request a new current-head
review only after same-head thread truth is already clear; otherwise it must run
the controlled deep review check first.

## Receipts

Existing single-lane receipts remain under:

```text
openspec/.buddy-cache/auto-state/
```

Receipts are local state-machine evidence, not GitHub truth. They only prove
that a deterministic internal helper passed at a given phase. GitHub truth still
controls claim, PR, review, Project, merge, and achievement decisions.

In particular, a valid `claimed` receipt never skips
`read-live-claim-truth.sh`; a live `owned` result is required before the issue
can proceed to PR lookup.

## Cache Policy

Issue and PR reads use a ten-minute cache, relationship and ready scans use a
two-minute cache, and Project metadata uses a twenty-four-hour cache. These
limits are performance controls, not coordination leases. The claim, review,
merge, archive, and Project write paths force a fresh read. Metrics are stored
as best-effort JSONL under `openspec/.buddy-cache/cache-metrics.jsonl` and can be
summarized with:

```bash
<openspec-buddy-auto-skill-dir>/../openspec-buddy/scripts/cache-metrics.mjs \
  summary openspec/.buddy-cache
```

`merge_authorized` is recorded immediately before the controller-owned merge
mutation. It is bound to the exact repository, issue, PR, full head SHA, clear
review request/response IDs, and a unique merge attempt. `merged` is recorded
only after the helper refreshes GitHub truth and verifies the merged PR and
merge commit. A remotely merged PR without a matching receipt enters the
persistent `unauthorized_merge` blocker; normal reruns cannot clear it.
