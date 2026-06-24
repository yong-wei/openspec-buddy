---
name: openspec-buddy-auto
description: Use when the user asks to automatically process GitHub Issue-backed or explicitly local-only OpenSpec changes end to end, including selecting executable changes, claiming work, implementing, opening PRs, handling review loops, merging, archiving, or iterating through all available changes.
compatibility: Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and a foreground shell wait for review pauses.
---

# OpenSpec Buddy Auto

OpenSpec Buddy Auto is the high-permission execution layer for OpenSpec changes.
Its default path is GitHub-tracked, but it must also recognize explicitly
local-only changes created through `openspec-buddy propose --no-issue`. It does
not replace `openspec-buddy`; it calls `openspec-buddy` for issue, claim,
branch, and archive state when GitHub coordination exists.

## When To Use

Use this skill only when the user explicitly asks to auto-run OpenSpec Buddy
changes, process the next executable change, or iterate through all available
changes in goal mode.

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

If the project explicitly shares Buddy cache state across worktrees, auto mode
may reuse `OPENSPEC_BUDDY_CACHE_DIR` and the internal cache-signal Ref. Treat
that layer only as a coordination accelerator. It may invalidate or reuse local
cache, but it does not replace current GitHub review, Project, or merge truth.

On first use in a project, follow OpenSpec Buddy's core first-run configuration
protocol. If GitHub-backed auto mode is requested and
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST` is still missing, ask the user for the
review request string and append it to `.env.openspec-buddy` before
continuing. Do not require that variable for the combined local-only
`openspec-buddy propose --no-issue` plus `openspec-buddy-auto --no-pr` path.

The local-only path is narrower. When the selected change is an explicit
`openspec-buddy propose --no-issue` change and the user also requested
`openspec-buddy-auto --no-pr`, do not block on GitHub Project fields or
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST`. That path still needs
`OPENSPEC_BUDDY_BASE_BRANCH`, but it does not create GitHub issue, Project, or
review state.
If the selected change is GitHub issue-backed, `--no-pr` is not a valid escape
hatch: keep the normal PR, review, and issue/project synchronization flow.

## One-Change Run

1. Start from a clean worktree on the long-lived coordination branch.
2. Verify the current worktree is aligned with the configured Buddy base branch
   by calling `openspec-buddy/scripts/sync-base-branch.sh`. Auto mode does not
   maintain a separate base-sync implementation. If the worktree config has
   `buddy.boundBranch`, the helper must run on that bound coordination branch
   and may fast-forward it to `buddy.boundBase`, defaulting to
   `origin/$OPENSPEC_BUDDY_BASE_BRANCH` when `buddy.boundBase` is unset;
   detached HEAD and other branches fail before selection or claim. Without
   `buddy.boundBranch`, the helper preserves the legacy behavior: it
   fast-forwards only when current branch is the base branch, otherwise current
   `HEAD` must already match `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
3. Check whether the user explicitly pointed to a local-only change, or whether
   selection over `openspec list --json` produces an active change explicitly
   marked for local-only coordination.
4. If selection returns a local-only active change that was created through
   `openspec-buddy propose --no-issue`, skip `claim`, GitHub Project mutation,
   and issue-state synchronization. Execute the change entirely in the local
   repository: implement, verify, archive, and finish on the configured Buddy
   base branch with no GitHub Issue.
5. Otherwise run `openspec-buddy claim` for the user-specified issue, or with no issue number to select the smallest claimable open issue.
6. Re-read the claimed issue. If the claim adopted an ordinary open issue, classify it immediately:
   - Simple issue: create or confirm the matching local OpenSpec change and continue.
   - Complex issue: create child change issues, link them, convert the source issue to a tracking parent, then stop this iteration or claim the first child in the next iteration.
7. For an already prepared Buddy issue with an active OpenSpec change, use `references/selection-rules.md` only after claim to decide whether it is executable now. Relationship-aware selection must ignore series parent issues and skip issues with open `blockedBy`; among executable issue-backed candidates, select the smallest issue number globally. Current series and downstream blocking counts are diagnostic signals, not priority keys. The core scripts enforce `verify-claim-worktree.sh` before execution-sensitive transitions. If it reports detached HEAD, `foreign-claim-detected`, a PR head mismatch, or an active claim owned by another worktree, stop rather than switching to another worker's branch.
8. Continue the `openspec-buddy apply` flow for the claimed executable issue:
   - verify the linked issue Development branch and remote branch lock
   - switch to branch `<change_id>`
   - set Project `Start`
   - set issue status to `status:in-progress`
   - set Project `Status` to `In Progress`
9. Implement with the relevant OpenSpec and superpowers skills:
   - `openspec-apply-change`
   - `superpowers:test-driven-development` when adding behavior
   - `superpowers:systematic-debugging` when failures occur
   - `superpowers:verification-before-completion` before claiming completion
   - `superpowers:requesting-code-review` before or after PR creation when applicable
   Before opening a PR, `openspec instructions apply --change <change_id> --json`
   must report `remaining: 0`; finish or explicitly reconcile incomplete tasks first.
   If the issue contains an `Acceptance Checklist`, the implementation thread
   must not check Acceptance Checklist items itself. It may write evidence such
   as `Proposed satisfied: AC-1, AC-3` with exact commands, tests, file checks,
   or manual observations. An independent review pass must decide which AC ids
   are approved before the issue checklist or issue tasks linked to those AC ids
   are checked. This does not block normal OpenSpec `tasks.md` completion, which
   still must reach `remaining: 0` before archive.
10. Pre-archive the completed OpenSpec change on the claim branch before the implementation commit:
   - if a delta spec introduces a capability whose main spec does not exist,
     create `openspec/specs/<capability>/spec.md` with `## Purpose` and
     `## Requirements` before archiving
   - run `openspec validate <change_id> --strict` against the active change so
     malformed delta specs fail before `openspec archive` moves the change
   - run `openspec archive <change_id> --yes`
   - validate each affected main spec with `openspec validate <capability> --strict`
   - keep the issue in `status:in-progress`; do not mark it `status:archived`
     before the PR merges
   The implementation PR must include code, tests, completed tasks, synced main
   specs, and `openspec/changes/archive/YYYY-MM-DD-<change_id>/`.
11. Commit, push, and open a ready PR against `$OPENSPEC_BUDDY_BASE_BRANCH`.
    Do not hand-write the PR Development link; the metadata helper applies the
    configured policy.
    If the user invoked `openspec-buddy-auto --no-pr` for a selected local-only
    `openspec-buddy propose --no-issue` change, do not push, do not open
    a Pull Request, and do not create any GitHub review state. Instead run a
    local review pass in the same repository, address findings, rerun the full
    verification commands, and merge or fast-forward the verified result onto
    `$OPENSPEC_BUDDY_BASE_BRANCH` locally. In that mode, stop the GitHub flow
    here: do not call `mark-review.sh`, `wait-for-review-clear.sh`,
    `verify-review-clear.sh`, `mark-achieved.sh`, or any other PR/issue helper
    that requires a GitHub record. If the selected change is GitHub issue-backed,
    do not use `--no-pr`; keep the normal GitHub-backed flow.
    Before the first implementation commit, before opening a PR, and before a
    local `--no-pr` merge, run an independent review focused on acceptance
    coverage. The review must receive the issue body, Acceptance Checklist,
    task-to-AC mapping, current diff, and evidence. It must explicitly return
    `approved_to_commit`, `approved_ac`, `rejected_ac`, `scope_status`,
    `regression_risk`, and `required_fixes`. Commit, PR creation, or local merge
    may proceed only when `approved_to_commit: yes`. Only `approved_ac` items
    may be checked.
12. GitHub-backed path only: call `openspec-buddy/scripts/mark-review.sh <issue-number> <pr-url>`.
    Auto mode must not reimplement PR metadata or review-request logic; the
    Buddy helper configures PR labels, assignees, Project state, origin issue,
    Development-link policy, posts `OPENSPEC_BUDDY_PR_REVIEW_REQUEST`, verifies
    coordination, and then marks the issue `status:in-review`.
    The Project `Status` must remain `In Progress`.
13. GitHub-backed path only: wait for the configured reviewer in the same foreground workflow by running
    `openspec-buddy/scripts/wait-for-review-clear.sh <pr-url>` as the single
    blocking wait command. The helper sleeps for the initial wait window
    (default 300 seconds), then checks every poll window (default 60 seconds)
    until the total max wait (default 900 seconds). During the helper run, stay
    completely silent: do not check the time, poll the shell, query GitHub,
    inspect files, send progress updates, or perform unrelated work. Do not use
    Codex automations, heartbeats, reminders, or background monitors for this
    wait. The helper may silently perform its own GitHub checks. Polling is
    two-stage: normal polls read only lightweight PR state, and only detected
    review-state changes trigger a full REST refresh and `verify-review-clear.sh`.
    If the first 900 second window ends without a clean current-head review, the
    helper uses `request-pr-review.sh --force` to append the fixed review
    request plus retry context, then waits one more 900 second window. If the
    second window also ends without a clean review, stop and mark the issue for
    human attention.
    It fails immediately if GraphQL shows unresolved actionable Codex review
    threads, and it also fails before sleeping when the current PR head has no
    fresh `OPENSPEC_BUDDY_PR_REVIEW_REQUEST` comment. Do not enter the wait
    until `review-response-gate.sh` has replied, resolved, and verified old
    addressed threads, and `request-pr-review.sh` has requested review for the
    current head. For review-fix follow-up, call `request-pr-review.sh` with a
    `--context-file` that appends the current head, addressed review thread
    ids or URLs, fix commit, evidence reply status, and passed
    review-response-gate status after the fixed configured request string.
14. GitHub-backed path only: check PR review, unresolved threads, requested changes, CI, mergeability, labels, Project membership, and origin issue traceability. Before any merge, run `openspec-buddy/scripts/verify-review-clear.sh <pr-url>` unless `wait-for-review-clear.sh` already returned a successful clearance record for the current head; do not infer review clearance from `gh pr view --comments`. If either helper passes by using a top-level PR clear comment, read the clear comment excerpt and URL printed by the helper output and treat that returned excerpt as the human judgment record; do not make a second, text-only `gh pr view --comments` judgment.
15. GitHub-backed path only: if new actionable review exists, including `P0`, `P1`, or `P2`, use `github:gh-address-comments` and `superpowers:receiving-code-review`, then fix or document the verified non-actionable rationale. Before committing a review-fix diff, run the independent acceptance review again with the issue body, archived or active tasks, Acceptance Checklist if present, current diff, addressed review comments, and verification evidence. The review must return `approved_to_commit`, `approved_ac`, `rejected_ac`, `scope_status`, `regression_risk`, and `required_fixes`; stop until fixes are complete unless `approved_to_commit: yes`. After the approved review-fix commit is pushed, reply in the corresponding review thread with the fix commit or non-actionable rationale and verification evidence, then run `openspec-buddy/scripts/review-response-gate.sh <pr-url> --head <head-sha>`. The review-fix commit is not complete until this helper has resolved every addressed actionable Codex thread and GraphQL confirms `isResolved=true`. A successful reply comment alone is not enough. After the gate passes, write a review-fix context file naming the current head, addressed thread ids or URLs, fix commit, evidence reply status, and passed gate status, then run `openspec-buddy/scripts/request-pr-review.sh <pr-url> --context-file <review-fix-context.md>` to request review for the current head. Then run `openspec-buddy/scripts/wait-for-review-clear.sh <pr-url>`. Resolved old threads are not a current-head clean review.
    If review feedback changes requirements, tasks, or specs, edit the archived
    change files and synced main specs in the same PR; do not restore the
    active `openspec/changes/<change_id>/` directory.
16. GitHub-backed path only: if no new review appears for the configured number of quiet checks, `verify-review-clear.sh` passes, and checks are green, merge the PR without deleting the branch yet. If `verify-review-clear.sh` confirms the configured reviewer explicitly says there are no actionable findings, no significant issues, or no major problems for the current-head review cycle, and all merge gates pass, it may be merged without waiting for the remaining quiet checks.
    In `openspec-buddy-auto --no-pr` mode for a selected local-only change,
    replace this with a local review gate:
    obtain a high-reasoning review in-process, fix every actionable finding,
    rerun verification, and only then merge locally without opening a PR.
17. GitHub-backed path only: fast-forward the claim branch to `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
18. GitHub-backed path only: run the post-merge achievement sync:
    - verify the merged PR contains `openspec/changes/archive/YYYY-MM-DD-<change_id>/`
      and synced main specs
    - read the archived `tasks.md` and require no unchecked tasks
    - run `mark-achieved.sh <issue-number> <archive-path> <pr-url>`
    The Project `Status` must become `Done` when the issue reaches
    `status:archived`, and the Project `End` field must be set during this
    state sync.
    If the archived issue belongs to a series parent and all sibling changes are
    also archived, finalize the parent issue as `status:archived`, Project
    `Status: Done`, Project `End` set, and closed. `mark-achieved.sh` performs
    this parent reconciliation automatically and must fail if a closed child is
    missing the terminal `status:archived` label.
19. GitHub-backed path only: delete the local and remote claim branch.
20. Return to the coordination branch. If `buddy.boundBranch` is configured,
    switch to that branch, fast-forward it to `buddy.boundBase` (or
    `origin/$OPENSPEC_BUDDY_BASE_BRANCH` when unset), and run
    `openspec-buddy/scripts/verify-bound-worktree.sh --phase goal-loop-start`
    before selecting another issue. Do not enter the next loop from detached
    HEAD or from a deleted claim branch.
21. Write an execution retrospective before final reporting.

## Goal Mode

When the user asks to process all available changes, repeat one-change runs with these rules:

- Claim only one issue per iteration.
- If no issue is specified, every iteration starts with the smallest currently claimable open issue. Do not keep using a cached issue list after another agent may have claimed work.
- If a local-only `--no-issue` change is selected, process it before asking GitHub for another issue and report that the iteration had no issue number.
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

These GitHub merge gates apply only when a PR exists. In `openspec-buddy-auto
--no-pr` mode, require an equivalent local review-and-verification pass and do
not open a PR.

Do not merge unless all are true:

- PR is open and mergeable.
- PR base is `$OPENSPEC_BUDDY_BASE_BRANCH`; if base is `$OPENSPEC_BUDDY_RELEASE_BRANCH`, retarget it to the Buddy base branch before review/merge, and stop if it cannot be retargeted.
- PR has `pr:openspec-buddy`, `pr:base-<base-branch>`, and the originating issue's applicable non-status coordination labels.
- PR assignees mirror the originating issue assignees.
- PR is in the same Project as the originating issue, and its Project `Status` is `In Progress`.
- PR body records the originating issue. If the configured Development-link
  mode is `keyword`, `gh pr view --json closingIssuesReferences` must include
  the issue number before review/merge. If the mode is `auto` and the PR base is
  non-default, the manual sidebar-link requirement must be reported.
- PR contains the configured `OPENSPEC_BUDDY_PR_REVIEW_REQUEST` comment.
- `openspec-buddy/scripts/verify-review-clear.sh <pr>` passes. This gate must
  inspect the latest configured reviewer review, PR review comments, and
  GraphQL `reviewThreads`; `gh pr view --comments` being empty is not evidence
  that review feedback is clear. When the gate passes through a top-level clear
  comment rather than a formal review on the head commit, the helper must print
  the matched current-head review request and clear comment excerpt. Use that
  returned excerpt as the judgment record that the comment actually means
  "no major issues" for the current cycle.
- `openspec-buddy/scripts/verify-review-threads-resolved.sh <pr>` passes. This
  is the final unresolved-thread guard; it must fail if any actionable Codex
  `P0`, `P1`, or `P2` thread is still open.
- CI/checks have completed successfully or the repository has no required checks.
- No unresolved review threads remain.
- No reviewer has requested changes on the latest commit.
- `wait-for-review-clear.sh` has returned a current-head clean review record,
  or no new review/comment has appeared for the configured fallback quiet
  checks after the latest head commit or latest review-handling push. The
  clean-review exception applies when `verify-review-clear.sh`, or the wait
  helper through that verifier, confirms the latest configured reviewer review
  or a returned top-level clear comment after a current-head review request
  explicitly says there are no actionable findings, no significant issues, or
  no major problems.
- The implementation branch contains only the claimed change and required follow-up fixes.

## Learned Rules

- Treat GitHub `reviewThreads` as the source of truth for actionable review state. `latestReviews` can lag behind the latest head commit or report an empty commit oid.
- Treat `COMMENTED` reviews as unknown until `verify-review-clear.sh` proves
  they are clean. Any `P0`, `P1`, or `P2` finding from the configured reviewer
  blocks merge. `P2` is not automatically mergeable; it must be verified,
  addressed or explicitly justified, and followed by a clear review state.
- Keep the review wait separate from CI waiting. Use exactly one foreground
  `wait-for-review-clear.sh` invocation per review pause; do not poll with
  `date`, `time`, `gh`, `git`, `write_stdin`, or any other main-thread tool
  while the helper is running. The helper may silently poll lightweight PR REST
  state every 60 seconds after the initial 300 second wait, then fetches the
  full REST bundle and invokes GraphQL through `verify-review-clear.sh` only
  when that lightweight state changes. The first 900 second timeout triggers
  one forced follow-up review request with retry context; the second timeout
  requires human intervention. Require the configured fallback quiet checks
  only when no explicit clean review record is available. After review gates are
  clear, use foreground CI waiting such as `gh run watch --exit-status` when
  checks are still running.
- Do not treat shared cache hits or cache-signal updates as review clearance.
  Review truth still comes from the current GitHub REST and GraphQL reads used
  by `wait-for-review-clear.sh` and `verify-review-clear.sh`.
- Every review-thread resolve must be preceded by a reply in that same thread. The reply must state the fix commit or the reason the thread is non-actionable, plus the verification evidence. After a review-fix commit is pushed, run `openspec-buddy/scripts/review-response-gate.sh <pr> --head <head-sha>`; it refuses to resolve threads without an evidence reply, resolves through `resolve-review-thread.sh`, and re-reads GraphQL before the loop can continue. Do not silently resolve Codex review threads.
- After `review-response-gate.sh` passes for a review-fix commit, run
  `request-pr-review.sh <pr> --context-file <review-fix-context.md>` before
  `wait-for-review-clear.sh <pr>`. The wait helper is an observer; it refuses
  to sleep when the current head has no fresh review-request comment. Its retry
  request appends context after the fixed request string; do not replace the
  configured request with a narrower prompt.
- Do not merge while CI is `IN_PROGRESS`, even when every review thread is resolved and the PR is mergeable.
- OpenSpec Buddy automation targets `$OPENSPEC_BUDDY_BASE_BRANCH`, not `$OPENSPEC_BUDDY_RELEASE_BRANCH`. New changes use the configured base branch, PRs use that base branch, and pre-archived change files land through the same implementation PR. Merging the Buddy base branch to the release branch is a manual release action outside Buddy Auto unless the project configures otherwise.
- Buddy PRs must pass the core `mark-review.sh` path before review waiting
  begins. That path configures `pr:*` labels, inherited non-status coordination
  labels, mirrored assignees, Project state, origin issue record, Development
  link policy, and the configured review-request comment. Use
  `configure-pr-metadata.sh` for PR Development links; closing keywords are
  allowed only when the helper can verify `closingIssuesReferences`, otherwise
  manual sidebar linking is required.
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
