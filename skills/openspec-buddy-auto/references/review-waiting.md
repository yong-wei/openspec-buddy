# PR Review Waiting

Use a serial foreground wait for each configured review pause. The wait must
be completely silent: no time checks, shell polling, GitHub queries, file
inspection, progress updates, or unrelated work may happen while the wait is
running. Do not use Codex automations, heartbeat automations, reminders, or
background monitors: they run in parallel and can break the one-change-at-a-time
workflow.

The wait should block the current execution flow with exactly one command, for
example:

```bash
sleep "$OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS"
```

If the project configures `OPENSPEC_BUDDY_COMMAND_PREFIX`, prefix the command:

```bash
$OPENSPEC_BUDDY_COMMAND_PREFIX sleep "$OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS"
```

When using a shell tool that can return before the process exits, set the
foreground wait long enough for the sleep to finish in the same tool call. For
the default five-minute pause, use a wait window slightly above 300 seconds
instead of repeatedly polling the shell session.

Forbidden during this phase:

```text
date / time checks
write_stdin polling
gh or git queries
file reads or code work
assistant progress updates
parallel background work
```

## State To Remember

Before waiting, record:

```text
pr_number
head_sha
last_seen_review_ids
last_seen_review_thread_ids
last_seen_comment_ids
review_round
quiet_review_checks
```

## Post-Wait Check

Only after the foreground wait finishes:

```bash
gh pr view <pr> --json state,baseRefName,mergeable,reviewDecision,reviews,comments,commits,statusCheckRollup,closingIssuesReferences
gh api graphql ... # required for reviewThreads and isResolved state
```

Check:

```text
new review comments
new requested changes
PR base branch is $OPENSPEC_BUDDY_BASE_BRANCH
PR has pr:* metadata labels and copied non-status coordination labels
PR assignees mirror the originating issue assignees
PR is in the same Project as the originating issue with Status: In Progress
PR body records the origin issue
PR contains the configured OPENSPEC_BUDDY_PR_REVIEW_REQUEST comment
PR Development link is verified through closingIssuesReferences when keyword mode is active
unresolved review threads
CI/check failures
mergeability
new commits not created by this run
```

For the coordination checks, prefer the core verifier:

```bash
<openspec-buddy-skill-dir>/scripts/verify-pr-coordination.sh <issue-number> <pr-number-or-url>
```

Do not enter or continue the review wait loop if this verifier fails.

If `baseRefName` is `$OPENSPEC_BUDDY_RELEASE_BRANCH`, retarget the PR before any review or merge gate:

```bash
<openspec-buddy-skill-dir>/scripts/ensure-pr-base.sh <pr-number-or-url>
```

If the script cannot retarget the PR to `$OPENSPEC_BUDDY_BASE_BRANCH`, stop and
mark the issue `status:needs-human` rather than merging a Buddy change to the
release branch.

## Thread-Aware Review Rule

Use `reviewThreads.nodes[].isResolved` from GitHub GraphQL as the review gate.
Flat `reviews`, `latestReviews`, and `comments` are useful context, but they are
not enough to decide whether inline review feedback is still actionable.
`gh pr view --comments` can be empty while the review body or line review
comments still contain findings.

Observed failure mode: `latestReviews` may point at a prior commit or omit the
commit oid, while `reviewThreads` still shows the current unresolved thread.

Before merging, run:

```bash
<openspec-buddy-skill-dir>/scripts/verify-review-clear.sh <pr-number-or-url>
```

This helper reads the latest configured reviewer review, REST PR review
comments, and GraphQL review threads. A `COMMENTED` review is not a pass by
itself. `P0`, `P1`, and `P2` findings all block merge. `P2` feedback must be
verified and either fixed or justified with evidence before a later clean review
state can pass the gate.

## Three-Check Merge Rule

After the latest head commit or latest review-handling push, check for new
review after each configured foreground wait. Merge only after the configured
number of consecutive checks with no new review, no new review comments, and no
new unresolved threads.

Reset `quiet_review_checks` to `0` whenever a new review, review comment, PR
comment, requested-changes review, or follow-up fix push appears.

Exception: if `verify-review-clear.sh` confirms that the latest configured
reviewer explicitly says there are no actionable findings, no significant
issues, no major problems, or equivalent wording, and all other merge gates
pass, the PR may be merged without waiting for the remaining quiet checks.

## Thread Resolution Rule

If there is actionable feedback, including `P0`, `P1`, or `P2`, fix it or
verify it, push any required change, and reply in the corresponding review
thread with the fix commit or evidence. Resolve the thread only after the reply
exists. For non-actionable feedback, reply with the rationale and evidence
before resolving. Silent thread resolution is not allowed.

After resolving threads, perform another foreground review wait before
checking again, unless the no-significant-issues exception applies.

## CI Waiting

The configured review wait is for review latency, not for CI. If no actionable review
remains but `statusCheckRollup` still shows an in-progress check, wait for that
check in the foreground, for example:

```bash
gh run watch <run-id> --exit-status
```

If the project configures `OPENSPEC_BUDDY_COMMAND_PREFIX`, prefix the command:

```bash
$OPENSPEC_BUDDY_COMMAND_PREFIX gh run watch <run-id> --exit-status
```

Do not merge until CI is completed successfully or the repository has no required checks.

## Limits

Default:

```text
max_review_rounds: 5
max_elapsed_hours: 24
```

When exceeded, set `status:needs-human` and stop.
