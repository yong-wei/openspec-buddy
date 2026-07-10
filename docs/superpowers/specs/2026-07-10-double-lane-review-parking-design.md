# Double-Lane Review Parking Optimization Design

## Problem

In multi-lane mode, a lane that reaches `review-yield` has already completed
`mark-review.sh` in the single driver and carries signed
`mark_review_passed` and `review_requested` receipts. The lane driver parks the
lane, then runs the complete `mark-review.sh` workflow again. That repeats PR,
Issue, Project, review-thread, and cache-signal operations before another lane
can run.

When another owned lane is already in a foreground stage, the scheduler does
not switch to it. It returns a `HANDOFF` asking the agent to switch branches,
although branch switching and claim verification are deterministic,
controller-owned work.

## Scope

This change optimizes only the transition from a completed `review-yield` to a
parked `waiting_review` lane and the immediate continuation of another owned
foreground lane.

It does not change review-clear semantics, merge gates, Project terminal
state, retry windows, cache authority, or the controller's top-level review
waiting lifecycle.

## Design

### Receipt-grounded parking

`parkLaneFromDriverReceipt` must accept a review-yield as fully coordinated
only when both signed driver receipts are present and match the parked PR and
head:

- `mark_review_passed` exists;
- `review_requested` exists;
- any receipt PR value equals the lane PR;
- the review request head equals the lane head.

After the existing safe-yield gate confirms clean worktree, claim ownership,
open PR head, remote branch, and current-head review request, the lane driver
records `reviewStatusSyncedAt` from the matching receipt and does not call
`mark-review.sh` again.

Legacy or incomplete driver state remains safe: if the required receipts are
missing or do not match, the lane driver runs the existing
`markLaneInReviewOrBlock` fallback before another issue may be claimed.

### Automatic owned-lane continuation

When a foreground lane is already owned but its branch is not current, the
scheduler calls the existing `resumeLaneOrFail` gate. That gate performs the
clean-worktree, branch switch, claim ownership, PR truth, and head checks that
apply to the lane. A successful resume continues the single driver in the
same controller run.

If the gate fails, the scheduler emits the existing blocker or review-fix
handoff. It must not run the target lane driver or probe waiting-review lanes.

### Avoid immediate duplicate safe-yield

Once a lane is safely parked and the scheduler continues, it must not run the
same safe-yield gate again solely because the current branch still names the
newly parked lane. Continuing an existing foreground lane through
`resumeLaneOrFail`, or returning to the bound branch before selection, provides
the next safe scheduling boundary.

## Safety Invariants

- No cache or receipt replaces current-head PR truth, claim ownership, clean
  worktree, remote branch, or current-head review-request verification.
- Receipt reuse is bound to the same PR and head.
- A new head or review-fix cycle invalidates the previous parking proof.
- A failed automatic switch does not mutate either lane stage and does not
  probe review state.
- A runnable owned lane is advanced before any parked review probe or new
  claim.

## Verification

Regression coverage must prove:

1. A single `review-yield` produces exactly one `mark-review` invocation.
2. Matching receipts persist `reviewStatusSyncedAt` without the fallback.
3. Missing or mismatched receipts still execute the fallback.
4. A parked lane is followed by an automatic gated switch to another owned
   foreground lane.
5. Dirty worktree or claim/head gate failure prevents the switch and all later
   work.
6. Waiting-review probing still occurs once when no runnable lane exists.

