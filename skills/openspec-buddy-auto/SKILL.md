---
name: openspec-buddy-auto
description: Use when the user asks to automatically process GitHub Issue-backed OpenSpec changes end to end, including selecting executable changes, claiming work, implementing, opening PRs, handling review loops, merging, archiving, or iterating through all available changes.
compatibility: Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and a foreground shell wait for review pauses.
---

# OpenSpec Buddy Auto

OpenSpec Buddy Auto is the high-permission execution layer for GitHub-tracked OpenSpec changes.
It orchestrates one claimed issue from intake to merged, archived result. It does not replace `openspec-buddy`; it calls `openspec-buddy` for issue, claim, branch, and archive state.

## When To Use

Use this skill only when the user explicitly asks to auto-run OpenSpec Buddy changes, process the next executable change, or iterate through all available changes in goal mode.

Do not use for ordinary `openspec-propose`, manual `openspec-apply-change`, or isolated PR review tasks.

## Required References

- `references/selection-rules.md`: selecting a claim target and prepared executable change
- `references/execution-loop.md`: end-to-end run lifecycle
- `references/review-waiting.md`: five-minute PR review wait loop
- `references/failure-recovery.md`: stale claim, unsafe recovery, and stop conditions

## Required Configuration

Before an auto run, verify the core and auto-specific configuration:

```bash
<openspec-buddy-skill-dir>/scripts/check-config.sh auto
```

The check reads `.env.openspec-buddy` automatically through OpenSpec Buddy's
shared loader. Auto mode additionally requires
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST`.
Resolve `<openspec-buddy-skill-dir>` to the directory containing
`openspec-buddy/SKILL.md`; do not paste the placeholder literally.

On first use in a project, follow OpenSpec Buddy's core first-run configuration
protocol. If auto mode is requested and `OPENSPEC_BUDDY_PR_REVIEW_REQUEST` is
still missing, ask the user for the review request string and append it to
`.env.openspec-buddy` before continuing.

## One-Change Run

1. Start from a clean worktree on the long-lived coordination branch.
2. Fetch `origin/$OPENSPEC_BUDDY_BASE_BRANCH` and fast-forward the local base branch.
3. Run `openspec-buddy claim` for the user-specified issue, or with no issue number to select the smallest claimable open issue.
4. Re-read the claimed issue. If the claim adopted an ordinary open issue, classify it immediately:
   - Simple issue: create or confirm the matching local OpenSpec change and continue.
   - Complex issue: create child change issues, link them, convert the source issue to a tracking parent, then stop this iteration or claim the first child in the next iteration.
5. For an already prepared Buddy issue with an active OpenSpec change, use `references/selection-rules.md` only after claim to decide whether it is executable now. Relationship-aware selection must ignore series parent issues, skip issues with open `blockedBy`, prefer the current series when one is already in progress, and prefer issues that unblock downstream changes.
6. Continue the `openspec-buddy apply` flow for the claimed executable issue:
   - verify the linked issue Development branch and remote branch lock
   - switch to branch `<change_id>`
   - set Project `Start`
   - set issue status to `status:in-progress`
   - set Project `Status` to `In Progress`
7. Implement with the relevant OpenSpec and superpowers skills:
   - `openspec-apply-change`
   - `superpowers:test-driven-development` when adding behavior
   - `superpowers:systematic-debugging` when failures occur
   - `superpowers:verification-before-completion` before claiming completion
   - `superpowers:requesting-code-review` before or after PR creation when applicable
   Before opening a PR, `openspec instructions apply --change <change_id> --json`
   must report `remaining: 0`; finish or explicitly reconcile incomplete tasks first.
8. Pre-archive the completed OpenSpec change on the claim branch before the implementation commit:
   - if a delta spec introduces a capability whose main spec does not exist,
     create `openspec/specs/<capability>/spec.md` with `## Purpose` and
     `## Requirements` before archiving
   - run `openspec archive <change_id> --yes`
   - validate each affected main spec with `openspec validate <capability> --strict`
   - keep the issue in `status:in-progress`; do not mark it `status:archived`
     before the PR merges
   The implementation PR must include code, tests, completed tasks, synced main
   specs, and `openspec/changes/archive/YYYY-MM-DD-<change_id>/`.
9. Commit, push, and open a ready PR against `$OPENSPEC_BUDDY_BASE_BRANCH` using `$OPENSPEC_BUDDY_PR_REVIEW_REQUEST` when the project requires a review prompt.
   Do not hand-write the PR Development link; the metadata helper applies the
   configured policy.
10. Configure PR metadata with `openspec-buddy/scripts/configure-pr-metadata.sh`:
   - add PR-scoped labels such as `pr:openspec-buddy` and `pr:base-<base-branch>`
   - copy the issue's `area:*`, `series:*`, and `risk:*` labels to the PR
   - add the PR to the same Project as the issue
   - set the PR Project `Status` to `In Progress`
   - record the originating issue in the PR body
   - create a verifiable PR Development link when the PR targets the repository
     default branch, or report that manual sidebar linking is required
11. Mark the issue `status:in-review`.
   The Project `Status` must remain `In Progress`.
12. Wait five minutes in the same foreground workflow with a single blocking
    sleep command, then check again. During the wait, stay completely silent:
    do not check the time, poll the shell, query GitHub, inspect files, send
    progress updates, or perform unrelated work. Do not use Codex automations,
    heartbeats, reminders, or background monitors for this wait.
13. Check PR review, unresolved threads, requested changes, CI, mergeability, labels, Project membership, and origin issue traceability.
14. If new actionable review exists, use `github:gh-address-comments` and `superpowers:receiving-code-review`, then push fixes. Before resolving any review thread, reply in that thread with the fix or non-actionable rationale and evidence; then resolve the thread and repeat from step 12.
    If review feedback changes requirements, tasks, or specs, edit the archived
    change files and synced main specs in the same PR; do not restore the
    active `openspec/changes/<change_id>/` directory.
15. If no new review appears for the configured number of quiet checks and checks are green, merge the PR without deleting the branch yet. If the configured reviewer explicitly says there are no significant issues or no major problems, and all merge gates pass, it may be merged without waiting for the remaining quiet checks.
16. Fast-forward the claim branch to `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
17. Run the post-merge achievement sync:
    - verify the merged PR contains `openspec/changes/archive/YYYY-MM-DD-<change_id>/`
      and synced main specs
    - read the archived `tasks.md` and require no unchecked tasks
    - run `mark-achieved.sh <issue-number> <archive-path> <pr-url>`
    The Project `Status` must become `Done` when the issue reaches
    `status:archived`, and the Project `End` field must be set during this
    state sync.
    If the archived issue belongs to a series parent and all sibling changes are
    also archived, finalize the parent issue as `status:archived`, Project
    `Status: Done`, Project `End` set, and closed.
18. Delete the local and remote claim branch.
19. Return to the coordination branch and fast-forward it to `$OPENSPEC_BUDDY_BASE_BRANCH`.
20. Write an execution retrospective before final reporting.

## Goal Mode

When the user asks to process all available changes, repeat one-change runs with these rules:

- Claim only one issue per iteration.
- If no issue is specified, every iteration starts with the smallest currently claimable open issue. Do not keep using a cached issue list after another agent may have claimed work.
- After every merge and post-merge issue sync, fetch `origin/$OPENSPEC_BUDDY_BASE_BRANCH` and recalculate executable changes.
- If the previous iteration completed a series issue, prefer the same series until no issue in that series is executable.
- Skip `status:blocked`, `status:claimed`, `status:in-progress`, `status:stale-claim`, `status:needs-human`, and `status:failed`.
- Skip `type:series-parent` and any issue with open native `blockedBy` relationships.
- Stop when no executable issue remains.
- Stop when the user's goal budget, time budget, review-round limit, or token budget is reached.
- Never continue from a stale initial issue list.

## Review Loop Limits

Default limits:

```text
max_review_rounds: 5
max_elapsed_hours: 24
```

If the limit is reached, set the issue to `status:needs-human`, comment with the evidence, and stop. Do not merge by exhaustion.

## Merge Gates

Do not merge unless all are true:

- PR is open and mergeable.
- PR base is `$OPENSPEC_BUDDY_BASE_BRANCH`; if base is `$OPENSPEC_BUDDY_RELEASE_BRANCH`, retarget it to the Buddy base branch before review/merge, and stop if it cannot be retargeted.
- PR has `pr:openspec-buddy`, `pr:base-<base-branch>`, and the originating issue's applicable `area:*`, `series:*`, and `risk:*` labels.
- PR is in the same Project as the originating issue, and its Project `Status` is `In Progress`.
- PR body records the originating issue. If the configured Development-link
  mode is `keyword`, `gh pr view --json closingIssuesReferences` must include
  the issue number before review/merge. If the mode is `auto` and the PR base is
  non-default, the manual sidebar-link requirement must be reported.
- CI/checks have completed successfully or the repository has no required checks.
- No unresolved review threads remain.
- No reviewer has requested changes on the latest commit.
- No new review/comment has appeared for three consecutive five-minute checks after the latest head commit or latest review-handling push, unless the latest Codex review explicitly says there are no significant issues or no major problems.
- The implementation branch contains only the claimed change and required follow-up fixes.

## Learned Rules

- Treat GitHub `reviewThreads` as the source of truth for actionable review state. `latestReviews` can lag behind the latest head commit or report an empty commit oid.
- Keep the review wait separate from CI waiting. Use exactly one foreground
  sleep for `$OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS` per review pause; do not
  poll with `date`, `time`, `gh`, `git`, `write_stdin`, or any other tool
  during the sleep. Require `$OPENSPEC_BUDDY_REVIEW_QUIET_CHECKS` consecutive
  quiet review checks before merging unless the configured reviewer policy
  explicitly reports no significant issues. After review gates are clear, use
  foreground CI waiting such as `gh run watch --exit-status` when checks are
  still running.
- Every review-thread resolve must be preceded by a reply in that same thread. The reply must state the fix commit or the reason the thread is non-actionable, plus the verification evidence. Do not silently resolve Codex review threads.
- Do not merge while CI is `IN_PROGRESS`, even when every review thread is resolved and the PR is mergeable.
- OpenSpec Buddy automation targets `$OPENSPEC_BUDDY_BASE_BRANCH`, not `$OPENSPEC_BUDDY_RELEASE_BRANCH`. New changes use the configured base branch, PRs use that base branch, and pre-archived change files land through the same implementation PR. Merging the Buddy base branch to the release branch is a manual release action outside Buddy Auto unless the project configures otherwise.
- Buddy PRs must be configured with the `pr:*` namespace labels, inherited area/series/risk labels, the same Project as the issue, and an origin issue record before review waiting begins. Use `configure-pr-metadata.sh` for PR Development links; closing keywords are allowed only when the helper can verify `closingIssuesReferences`, otherwise manual sidebar linking is required.
- During pre-archive, if a delta spec introduces a capability whose main spec does not exist, create the corresponding `openspec/specs/<capability>/spec.md`, validate that spec, then move the change to `openspec/changes/archive/`.
- Treat OpenSpec tasks as part of the cross-system completion record, not as local notes. If code already satisfies a task but `tasks.md` is still unchecked, close the task in the implementation PR before review/merge/archive; otherwise GitHub issue state and local OpenSpec state drift permanently.
- Pre-archiving files in a PR is not the same as archiving the GitHub issue. Keep the issue in `status:in-review` until the PR is merged, then run `mark-achieved.sh` to set `status:archived`, Project `Done`, and Project `End`.
- Treat series parent issues as completion records too. A `type:series-parent` issue should remain `status:tracking` only while at least one child change is unfinished; after the last child reaches `status:archived`, close the parent with `status:archived`, Project `Done`, and Project `End`.

## Execution Retrospective Requirement

Every one-change run must end with a concise retrospective before the final report is closed.
The retrospective must state:

- selection and claim behavior that worked or failed
- implementation, review, wait, merge, archive, or issue-sync friction
- whether the skill or reference files need a reusable rule update

If the run exposes a reusable flaw and the user asks to persist the lesson, update the relevant Buddy or Auto skill file, commit it, and push it before moving to another change.

## Output

Report:

- selected issue and `change_id`
- selected series and whether current-series preference was applied
- claim branch and claim id
- PR URL
- review rounds performed
- verification commands
- merge commit
- archive path included in the PR
- final issue status
- finalized parent issue, if any
- execution retrospective
- next executable change, if goal mode continues
