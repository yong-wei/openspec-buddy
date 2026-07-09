# PR Review Waiting

Review waiting is controller-owned. The agent starts or resumes it only by
running:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

After the controller enters review waiting, the main agent must stay silent:
no time checks, shell polling, GitHub queries, file inspection, progress
updates, unrelated work, automations, or background monitors.

## Single-Lane And Multi-Lane

In single-lane mode, the controller may internally run the blocking review wait
helper. The agent must not call that helper directly.

In multi-lane mode, the controller parks lanes that are committed, pushed,
coordinated, and waiting for a current-head Codex review. `waiting_review` is a
background parked lane state, not a foreground waiting phase. After parking a
lane, the scheduler must first continue another owned lane or claim a new issue
when capacity is available. It may poll parked review lanes only when no lane
can be advanced and no new lane can be claimed. This is parked review
scheduling, not parallel implementation.

Each multi-lane controller run performs one scheduling/probe pass and returns to
the top-level controller. The lane driver must not keep an internal sleep loop
after a no-change parked review poll.

## Polling Contract

The controller uses two-stage polling:

- idle polls read only lightweight PR REST state
- full review-clear checks run only after lightweight state changes, review
  retry is due, or a review-fix lane needs a current decision

Idle polling must not repeatedly spend GraphQL review-thread quota.
`reviewThreads.nodes[].isResolved` remains the final truth for unresolved
inline review feedback, but it is read only inside controller-owned review
checks.

If the first review window ends without a current-head clean review, the
controller sends a forced retry request with context and waits one additional
window. If the second window also fails, the controller blocks for human
attention.

## Review-Fix Rule

Resolved old threads are not a clean current-head review.

After a review-fix commit is pushed, the required state transition is:

```text
same-thread evidence reply -> response gate -> current-head review request -> review wait
```

The controller persists `reviewFix.pending` so this transition survives process
restart or context compaction. It must not enter another review wait until the
response gate and current-head request path has advanced.

Do not silently resolve review threads. Each addressed actionable Codex thread
must have a same-thread reply with fix commit or non-actionable rationale plus
verification evidence before resolution.

## Merge Clearance

A PR may proceed toward merge only after the controller has current-head review
clearance and the other merge gates pass.

Flat PR comments and review summaries are not sufficient. A top-level clear
comment counts only when the controller's review verifier matches it to the
current head review request and returns the excerpt, timestamp, and URL as the
review-cycle judgment.

`P0`, `P1`, and `P2` findings block merge. `P2` feedback must be fixed or
justified with evidence before a later clean review state can pass.

## Forbidden During Review Wait

```text
date / time checks
write_stdin polling
manual gh or git queries
file reads or code work
assistant progress updates
parallel background work
direct deterministic helper invocation
```

If the controller returns `HANDOFF`, perform only the requested review-fix or
merge action, then run the controller again. If it returns `BLOCKED`, fix only
that blocker, then run the controller again.
