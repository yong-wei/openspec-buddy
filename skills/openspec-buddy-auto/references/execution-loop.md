# Execution Loop

## Start

Verify:

```bash
git status --short --branch
<openspec-buddy-skill-dir>/scripts/sync-base-branch.sh
```

The helper fetches `origin/$OPENSPEC_BUDDY_BASE_BRANCH` and verifies the current
worktree is aligned with it. If the current branch is
`$OPENSPEC_BUDDY_BASE_BRANCH`, the helper may fast-forward it. In a separate
worktree or topic branch, it must not switch branches; it succeeds only when the
current `HEAD` equals `origin/$OPENSPEC_BUDDY_BASE_BRANCH`. Stop if the worktree
is dirty or the current `HEAD` is not aligned with the base branch.

If the project explicitly shares `OPENSPEC_BUDDY_CACHE_DIR` or a cache-signal
Ref, use that layer only to invalidate or reuse local cache between worktrees.
It is an internal coordination accelerator, not a substitute for current
GitHub review, Project, or merge truth.

## Claim

For GitHub-coordinated changes, use `openspec-buddy claim [issue-number]`. If
no issue number is supplied, it must select the smallest claimable open issue
number.

Claim is a hard gate, not a best-effort setup step. Candidate lists and Buddy
caches are only accelerators; immediately before writing claim state the claim
script must read GitHub truth for the target issue, claim branch, open PR, and
current claim comments. Before the claim lock is verified, it must not create
or modify a Development link, Project fields, local branch, remote branch, or
implementation files.

The minimal claim lock writes only:

```text
status:claimed
OpenSpec Buddy Claim comment with claim_id and lease_until
issue assignee for the claiming agent
Buddy metadata body for ordinary open issues adopted in place
```

Immediately after the minimal lock, the script must re-read GitHub through REST
and verify:

```text
issue is still open
issue is status:claimed
latest valid OpenSpec Buddy Claim comment has this claim_id
latest valid OpenSpec Buddy Claim comment has this lease_until
latest valid OpenSpec Buddy Claim comment belongs to this agent
```

Only after that verification succeeds may the claim script create:

```text
origin/<change_id>
issue Development branch link for <change_id>
Project Status: In Progress
Project Start: current local date
```

If verification fails, stop that issue immediately. Do not create a branch,
Development link, Project update, PR, or implementation commit for the issue.

If the claimed issue was an ordinary open issue, the claim adopts the same
original issue by prepending the hidden Buddy metadata block. Do not create a
mirror issue just to preserve the original request. Classify it before
switching branches. Simple issues continue as one executable change. Complex
issues are split into child issues; the source issue becomes a tracking parent
only after the children exist and are linked.

If selection returns a local-only change created through
`openspec-buddy propose --no-issue`, take that branch before any GitHub claim
step. Skip claim entirely. There is no GitHub Issue, no Development branch
link, no Project item, and no remote branch lock in this path. Execute and
archive the change locally on `$OPENSPEC_BUDDY_BASE_BRANCH` or a local topic
branch derived from it.

Then switch to `<change_id>` for a simple or prepared change and mark
`status:in-progress`; the Project `Status` must remain `In Progress`.

## Implement

Read `openspec instructions apply --change <change_id> --json`.
Implement one task set at a time, mark tasks complete immediately after verification, and keep commits scoped to the claimed change.
Before leaving implementation, rerun `openspec instructions apply --change <change_id> --json` and require `progress.remaining` to be `0`.
If behavior is already implemented on the branch but `tasks.md` is still unchecked, mark the verified tasks complete and include that file in the implementation PR.
Do not treat a GitHub issue, PR, or merged code path as complete while local OpenSpec tasks remain open.

## Pre-Archive Before PR

Once implementation and verification are complete, archive the OpenSpec change
before the first implementation commit and before opening the PR. The PR should
contain the whole record: code, tests, completed `tasks.md`, synced main specs,
and `openspec/changes/archive/YYYY-MM-DD-<change_id>/`.

Required sequence:

1. Confirm `openspec instructions apply --change <change_id> --json` reports
   `remaining: 0`.
2. Inspect `openspec/changes/<change_id>/specs/**/spec.md`. If a delta spec
   adds a capability and `openspec/specs/<capability>/spec.md` does not exist,
   create the main spec file with `## Purpose` and `## Requirements` before
   archiving.
3. Validate the active change before it is moved to the archive:
   ```bash
   openspec validate <change_id> --strict
   ```
   This catches invalid delta spec format that main-spec validation after
   archive can no longer see.
4. Run:
   ```bash
   openspec archive <change_id> --yes
   ```
5. Validate every affected main spec, for example:
   ```bash
   openspec validate <capability> --strict
   ```
6. Commit the implementation and archive together.

Do not mark the GitHub issue `status:archived` during pre-archive. The issue
stays `status:in-progress` until the PR is opened, then `status:in-review`
until merge. If PR review changes requirements or tasks, edit the archived
change files and main specs in the same PR; do not move the archived change
back to `openspec/changes/<change_id>/`.

## PR

Open a formal PR:

```text
title: concise change title
base: $OPENSPEC_BUDDY_BASE_BRANCH
body: summary, verification, origin issue reference
```

Do not let `gh pr create` fall back to the repository default branch; pass
`--base "$OPENSPEC_BUDDY_BASE_BRANCH"` explicitly.
Do not hand-write closing keywords in `gh pr create`. `configure-pr-metadata.sh`
is responsible for the Development-link policy and verification.

After the ready PR exists, call the core review marker:

```bash
<openspec-buddy-skill-dir>/scripts/mark-review.sh <issue-number> <pr-number-or-url>
```

Auto mode must not reimplement PR metadata, label, assignee, Project, review
request, or Development-link rules. `mark-review.sh` verifies the PR base and
ready state, calls `configure-pr-metadata.sh`, posts
`OPENSPEC_BUDDY_PR_REVIEW_REQUEST` through `request-pr-review.sh`, runs
`verify-pr-coordination.sh`, and only then sets the issue to
`status:in-review`. This must leave the issue and PR Project `Status` as
`In Progress`. If any coordination step fails, stop before review waiting; do
not silently continue with an untracked or unreviewed PR.

Call `mark-review.sh` only after OpenSpec task progress is `complete == total`;
otherwise finish or reconcile the local tasks first.

If the user invoked `openspec-buddy-auto --no-pr`, stop before any `gh pr`
operation. Run local review and verification only, fix findings in the same
branch, and merge locally onto `$OPENSPEC_BUDDY_BASE_BRANCH` without opening a
PR. In this mode, skip `mark-review.sh`, `wait-for-review-clear.sh`,
`verify-review-clear.sh`, and `mark-achieved.sh` because no GitHub review or
issue state exists. This exception applies only to a selected local-only change
created through `openspec-buddy propose --no-issue`; issue-backed changes keep
the standard PR and issue synchronization flow.

## Merge And Achieve

After PR merge:

1. Keep the claim branch until issue achievement sync is complete.
2. Fast-forward the claim branch to `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
3. Verify the merged PR already contains
   `openspec/changes/archive/YYYY-MM-DD-<change_id>/` and synced main specs.
4. Recheck the archived `tasks.md` source before marking achieved. All tasks
   must be checked. If the PR merged without the archive path or with incomplete
   tasks, stop and use the legacy archive recovery path instead of marking the
   issue archived.
5. Validate the synced spec or affected spec set, for example:
   ```bash
   openspec validate <capability> --strict
   ```
   A failing unrelated spec in `openspec validate --all --strict` is not a reason
   to edit unrelated capabilities in the current issue-sync step; record it as
   existing debt unless the claimed change caused it.
6. Run `mark-achieved.sh <issue-number> <archive-path> <pr-url>` to sync the
   GitHub issue and Project state, then reconcile completed series parents.
7. Verify the issue has exactly one `status:*` label and that it is `status:archived`.
   If the issue is already closed or the Project item is already `Done`, still rerun
   `mark-achieved.sh` to reconcile the label, archive comment, and Project `End`.
8. Verify the linked series parent. If every child issue under the parent is
   closed with `status:archived`, Project `Status: Done`, and Project `End`
   set, the parent must also be closed with the same terminal state. For a
   direct repair or audit, use:
   ```bash
   <openspec-buddy-skill-dir>/scripts/close-completed-series-parent.sh <child-or-parent-issue>
   ```
   If this reports repairable terminal drift in a child issue, rerun
   `mark-achieved.sh` for that child before continuing.
9. Delete the remote claim branch before deleting the local branch. Local `git branch -d`
   can reject deletion while the local branch still tracks an older remote claim branch,
   even when the branch is merged to current `HEAD`.

The post-merge achievement step must set the issue to `status:archived`, close the issue, set Project `Status` to `Done`, and set Project `End` to the current local date.
The same completion rule applies to a series parent after its last child change is archived.
Buddy automation must not merge or push `$OPENSPEC_BUDDY_RELEASE_BRANCH`;
promoting `$OPENSPEC_BUDDY_BASE_BRANCH` to `$OPENSPEC_BUDDY_RELEASE_BRANCH`
is a manual release decision unless the project configures otherwise.
