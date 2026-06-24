# PR Review Waiting

Use a serial foreground wait for each configured review pause. The agent-facing
wait must be completely silent: no time checks, shell polling, GitHub queries,
file inspection, progress updates, or unrelated work may happen while the wait
is running. Do not use Codex automations, heartbeat automations, reminders, or
background monitors: they run in parallel and can break the one-change-at-a-time
workflow.

The wait should block the current execution flow with exactly one command:

```bash
<openspec-buddy-skill-dir>/scripts/wait-for-review-clear.sh <pr-number-or-url>
```

If the project configures `OPENSPEC_BUDDY_COMMAND_PREFIX`, prefix that single
helper invocation:

```bash
$OPENSPEC_BUDDY_COMMAND_PREFIX <openspec-buddy-skill-dir>/scripts/wait-for-review-clear.sh <pr-number-or-url>
```

The helper preserves the main-thread silence rule while avoiding fixed idle
rounds. It sleeps for `OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS` first
(default `300`), then checks every `OPENSPEC_BUDDY_REVIEW_POLL_SECONDS`
(default `120`) until `OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS` is reached
(default `900`). During helper execution, do not call `write_stdin` to poll the
shell session; wait for the command to finish in one foreground wait window.
Before sleeping, the helper checks two preconditions. First, the current PR
head must have a fresh `OPENSPEC_BUDDY_PR_REVIEW_REQUEST` comment; otherwise it
fails immediately and tells the agent to run `request-pr-review.sh`. Second, it
checks GraphQL `reviewThreads`. If any unresolved actionable Codex `P0`, `P1`,
or `P2` thread exists, it fails immediately and prints the thread id, path,
line, and URL. Do not retry the wait helper until `review-response-gate.sh` has
passed and `request-pr-review.sh` has requested review for the current head.

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
last_seen_review_comment_ids
last_seen_comment_ids
review_round
quiet_review_checks
```

`review-response-gate.sh` proves old addressed threads have same-thread replies
and are resolved. It does not prove the current head is clean. Only
`request-pr-review.sh` starts the current-head review cycle, and only
`wait-for-review-clear.sh` or `verify-review-clear.sh` can prove the current
head is clean. In a review-fix follow-up, call `request-pr-review.sh` with
`--context-file`; the file should append the current head, addressed thread ids
or URLs, fix commit, evidence reply status, and passed review-response gate
status after the fixed configured request string.

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

## Helper Query Rule

`wait-for-review-clear.sh` may query GitHub internally, but the main agent must
not. The helper uses low-frequency REST checks for PR head, issue comments,
review comments, and reviews. It invokes `verify-review-clear.sh` only on the
first post-initial-wait check, when that lightweight state changes, or at the
max-wait boundary. Since `verify-review-clear.sh` is the only path that calls
GraphQL reviewThreads, idle polling does not repeatedly spend GraphQL quota.

If the helper exits `0`, use its printed verifier output as the current-head
clearance record. If it exits non-zero with actionable review diagnostics,
handle review feedback. If it exits `124`, the review wait timed out; do not
merge by timeout.

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

GitHub REST and GraphQL surfaces may render app authors differently, for example
`chatgpt-codex-connector` versus `chatgpt-codex-connector[bot]`. Review gates
must normalize that suffix and treat logins containing `chatgpt-codex-connector`
as the configured Codex reviewer.

If the helper passes by using a top-level PR clear comment, it must have matched
a review-request comment for the current head commit first, then a later clear
comment from the configured reviewer. Read the helper's returned clear comment
excerpt, timestamp, and URL as the human judgment record. Do not separately
infer clearance from broad PR comment text matching.

## Three-Check Merge Rule

After the latest head commit or latest review-handling push, run the foreground
wait helper. Merge may proceed as soon as the helper, through
`verify-review-clear.sh`, returns a current-head explicit clean review record
and the other merge gates pass. If no explicit clean record appears, merge only
after the configured fallback quiet checks with no new review, no new review
comments, and no new unresolved threads.

Reset `quiet_review_checks` to `0` whenever a new review, review comment, PR
comment, requested-changes review, or follow-up fix push appears.

Exception: if `verify-review-clear.sh` confirms that the latest configured
reviewer explicitly says there are no actionable findings, no significant
issues, no major problems, or equivalent wording for the current-head review
cycle, and all other merge gates pass, the PR may be merged without waiting for
the remaining quiet checks. For a top-level clear comment, the helper output
itself is the review-cycle judgment record; use that returned excerpt directly
instead of reopening the PR comments manually.

## Thread Resolution Rule

If there is actionable feedback, including `P0`, `P1`, or `P2`, fix it or
verify it, push any required change, and reply in the corresponding review
thread with the fix commit or evidence. Resolve the thread only after the reply
exists. For non-actionable feedback, reply with the rationale and evidence
before resolving. Silent thread resolution is not allowed.

After any review-handling commit is pushed, run the review response gate before
requesting another review or entering another wait:

```bash
<openspec-buddy-skill-dir>/scripts/review-response-gate.sh <pr-number-or-url> --head <head-sha>
```

The gate reads GraphQL `reviewThreads.nodes[]`, finds unresolved actionable
Codex threads, requires an agent reply in each same thread with a fix commit or
non-actionable rationale plus verification evidence, resolves only those
addressed threads, and re-reads GraphQL to confirm `isResolved=true`.

A successful reply comment is not equivalent to thread resolution. The loop may
continue only after the gate confirms every addressed actionable Codex review
thread has `isResolved=true`.

The gate uses the core resolver helper for every thread resolve:

```bash
<openspec-buddy-skill-dir>/scripts/resolve-review-thread.sh <review-thread-node-id>
```

Do not call `resolveReviewThread` directly. The helper performs the mutation and
then independently re-reads the same GitHub review thread. Treat any non-zero
exit as a hard stop: the review loop is not clean until the helper confirms
`isResolved=true` for that exact thread and `verify-review-clear.sh` passes.

Before requesting another review or starting the foreground wait, the relevant
helpers run:

```bash
<openspec-buddy-skill-dir>/scripts/verify-review-threads-resolved.sh <pr-number-or-url>
```

If this check fails, stop and run the full response gate. After resolving
threads, perform another foreground review wait before checking again, unless
the no-significant-issues exception applies.

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
