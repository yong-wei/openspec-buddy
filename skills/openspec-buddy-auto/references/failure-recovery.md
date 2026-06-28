# Failure Recovery

## Stop And Escalate

Set `status:needs-human` when:

```text
issue metadata disagrees with OpenSpec files
status:ready issue already has a claim branch, Development link, claim comment, or open PR
active claim belongs to another worktree
claim branch is bound to another local worktree
current worktree is detached HEAD outside a read-only sync step
bound permanent worktree is not on its configured `buddy.boundBranch`
claim branch exists with unknown commits
open PR exists for the same claim branch
dependency status is ambiguous
review loop exceeds configured limit
mergeability is blocked by non-actionable external state
archive produces spec conflicts requiring design judgment
review-response-gate cannot verify an evidence reply or resolve an addressed thread
```

Set `status:failed` only for reproducible execution failure with command output.

## Missing Archive In Merged PR

Current Buddy PRs must include `openspec/changes/archive/YYYY-MM-DD-<change_id>/`
and synced main specs before review. If a merged PR lacks that archive path,
do not mark the issue `status:archived` from metadata alone.

If the merged PR contains the archive path on the configured bound base but the
issue or Project terminal state drifted, do not switch to the claim branch.
Run the controller again. It will internally run post-merge truth checks and
achievement synchronization from the bound coordination branch. That sync verifies the PR
is merged, verifies the archive `tasks.md` exists and is complete on
`buddy.boundBase` or `origin/$OPENSPEC_BUDDY_BASE_BRANCH`, verifies review
threads are resolved, then synchronizes `status:archived`, Project `Done`,
Project `End`, issue closeout, and parent reconciliation.

Use this as legacy recovery only:

1. Verify the merged PR, issue number, and `change_id` match.
2. Confirm the implementation is already on `$OPENSPEC_BUDDY_BASE_BRANCH`.
3. Confirm `openspec instructions apply --change <change_id> --json` reports
   `remaining: 0` and the active `tasks.md` has no unchecked tasks.
4. Run the archive command on a recovery branch or the normal claimed branch,
   validate the affected specs, and include the archive path plus synced main
   specs in the recovery update.
5. Only after that archive update is present on the base branch, run the
   controller again so it can re-check post-merge achievement truth.

If the active change directory is missing, the archive command conflicts, or
the merged implementation cannot be matched to the OpenSpec change with high
confidence, set `status:needs-human` instead of synthesizing an archive record.

## Stale Claim

A stale claim can be recovered only when:

```text
there is no other ready/backlog/unlabeled claimable issue
lease_until has expired
no open PR exists
claim branch has no commits beyond recorded base_sha
no newer claim comment exists
issue has no new assignee or status change after the stale claim
```

Otherwise stop. Do not force-push or delete another agent's branch.

## Unresolved Review Thread

If the controller blocks because unresolved actionable Codex review threads
exist, do not request another review directly and do not merge by timeout.

Recover only by:

1. Fixing the finding or verifying that it is non-actionable.
2. Committing and pushing any required change.
3. Replying in the same review thread with the fix commit or non-actionable
   rationale plus verification evidence.
4. Running the controller again so it can execute the response gate and
   current-head review request path.
5. Continuing only after the controller reports that GraphQL confirms the
   addressed actionable threads are resolved.

If the gate refuses to resolve because a reply is missing or lacks evidence,
write the missing reply. If the resolve mutation fails or a fresh GraphQL read
still shows the thread unresolved, stop and set `status:needs-human` rather than
opening another review round.

## Resume Or Branch Drift

After a resume, compaction, or manual branch operation, verify the current
branch before editing or committing. For GitHub-backed Buddy work, the
controller-owned claim/worktree guard must pass before editing, committing, pushing, requesting review,
waiting for review, merging, or marking achieved. If it reports
`foreign-claim-detected` or says the active claim belongs to another worktree,
stop. Do not switch to the other worktree, do not reuse its branch, and do not
continue from its claim unless the user explicitly asks for takeover.

For local diagnosis, also inspect:

```bash
git status --short --branch
git branch --show-current
```

If the branch is not the claimed `change_id`, preserve local work first:

```bash
git stash push -u -m "wip <change_id> before branch correction"
git switch <change_id>
git merge --ff-only "$OPENSPEC_BUDDY_BASE_BRANCH"
git stash pop
```

Do not commit implementation work on a coordination branch. If a coordination
branch contains already committed skill or documentation updates that should
land before the claimed change, merge those updates to `$OPENSPEC_BUDDY_BASE_BRANCH`
first, then fast-forward or rebase the claim branch onto the updated base branch.

## Project Status Script Recovery

When Project status synchronization fails, fix the Buddy script before
continuing the state transition. Verification must include:

```bash
bash -n <openspec-buddy-skill-dir>/scripts/*.sh
<openspec-buddy-skill-dir>/scripts/set-project-status.sh <issue> status:in-review
```

Use the real GitHub Project field and option names from:

```bash
gh project field-list <project-number> --owner <owner> --format json --limit 100
```

## Goal Mode Failure Policy

In goal mode:

- Mark blocked/unsafe issues and continue to the next executable issue only if the current issue has no local code changes.
- If local code changes exist, preserve them and stop.
- Never skip a failing verification by opening a PR anyway.
