# Buddy Auto Controller States

The auto controller is the only normal entry point:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
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
achieved-truth -> merge-pr-handoff
achieved-truth -> post-merge-achieve -> achieved
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
done
blocked
retryable_blocked
```

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

## Receipts

Existing single-lane receipts remain under:

```text
openspec/.buddy-cache/auto-state/
```

Receipts are local state-machine evidence, not GitHub truth. They only prove
that a deterministic internal helper passed at a given phase. GitHub truth still
controls claim, PR, review, Project, merge, and achievement decisions.
