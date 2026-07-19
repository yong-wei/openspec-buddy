# Execution Loop（Full Mode Only）

本参考只描述显式 Full Mode，不适用于默认 lite。代理只能通过公开 `buddy-auto.mjs full` 入口使用 controller。

All automatic phase progression starts with the controller:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs full
```

The controller owns deterministic Buddy helpers. The agent receives only
`DONE`, `HANDOFF`, or `BLOCKED` and must run the controller again after any
external work.

## Start And Worktree Guards

The controller internally verifies bound worktree alignment before selection,
claim, review, merge, and achievement. Detached HEAD, a non-bound coordination
branch, dirty worktree, or foreign claim is a hard stop unless the user
explicitly requests a takeover or recovery workflow.

For permanent worktrees, the project should have these local worktree configs:

```bash
git config extensions.worktreeConfig true
git config --worktree buddy.boundBranch <coordination-branch>
git config --worktree buddy.boundBase origin/$OPENSPEC_BUDDY_BASE_BRANCH
git config --worktree buddy.worktreeAlias <alias>
```

## Claim

For GitHub-coordinated changes, claim is a hard gate. Candidate lists and cache
data are accelerators only; immediately before writing claim state the internal
claim helper must read GitHub truth for the target issue, claim branch, open PR,
and current claim comments.

Before the claim lock is verified, no Development link, Project field, local
branch, remote branch, or implementation file may be created or modified.

If selection returns a local-only change created through
`openspec-buddy propose --no-issue`, the controller enters the local-only path.
There is no GitHub Issue, PR, Project item, Development link, or remote branch
lock in that path.

## Implement

When the controller returns an implementation handoff, the agent may edit code
only for that claimed change and must keep commits scoped to that change.

When a legacy or explicitly detailed change design declares an approved testing
seam, the handoff consumes it rather than silently replacing it. Default
lightweight proposals do not require that contract; the model selects tests
from the observable behavior and repository conventions.

Matt TDD may be used as an optional implementation method. If that provider is
unavailable, use the Buddy-native fallback: red-before-green,
public-interface tests, one vertical cycle at a time, and minimal
implementation. Provider availability must never change Buddy state, receipts,
artifacts, or gates. Provider-specific refactoring guidance does not add an
Auto lifecycle gate.

Before leaving implementation:

- OpenSpec task progress must reach `remaining: 0`.
- Local verification must pass.
- If the issue has an Acceptance Checklist, the implementation thread may only
  record proposed satisfied AC ids with evidence. Independent review decides
  which AC items may be checked.
- Before commit, PR creation, or local `--no-pr` merge, obtain independent
  review of issue scope, current diff, and evidence. Include task-to-AC mapping
  only when the Issue actually defines one.

After implementation work, run the controller again. It decides whether to
repeat verification, open/bridge a PR, or continue.

## Pre-Archive Before PR

Before the first implementation PR, the implementation and OpenSpec archive
must be in the same change set:

1. Confirm OpenSpec task progress is complete.
2. Ensure any new capability has a synced main spec.
3. Run `openspec validate <change_id> --strict`.
4. Run `openspec archive <change_id> --yes`.
5. Validate affected main specs.
6. Commit code, tests, completed tasks, synced main specs, and archive together.

Do not mark the GitHub issue `status:archived` during pre-archive. The issue
stays active until PR merge and achievement sync.

## PR Coordination

After a ready PR exists, run the controller. It internally verifies PR base,
labels, assignees, Project state, origin issue, Development-link policy, review
request, and issue `status:in-review` synchronization.

Do not reimplement PR metadata, review request, or Development-link rules in
the auto thread. If coordination fails, the controller blocks before review
waiting.

In multi-lane mode, the first safe parking point is after the PR is committed,
pushed, coordinated, has a current-head review request, and the worktree is
clean.

## Review Fix Loop

If Codex returns actionable `P0`, `P1`, or `P2` feedback, the controller hands
off review-fix work. The agent may fix or verify only that review feedback and
must obtain independent review before committing the review-fix diff.

After a review-fix commit is pushed, the commit is not complete. The required
state transition is:

```text
same-thread evidence reply -> response gate -> current-head review request -> review wait
```

The controller persists this as `reviewFix.pending`, so a process restart or
context compaction cannot skip the response gate. After reply/evidence work,
run the controller again.

## Merge And Achieve

The controller may hand off merge only after current-head review clearance and
merge gates pass. If the PR is already merged, the controller runs post-merge
truth checks and achievement sync from the bound coordination branch, not the
claim branch.

After merge, terminal state requires:

- archive path exists on the configured base
- archived tasks are complete
- affected specs validate
- issue has `status:archived`
- issue is closed
- Project Status is `Done`
- Project End is set
- completed series parents are reconciled

After any manual merge, archive repair, or blocker fix, run the controller
again. It decides whether to repeat verification, synchronize achievement, or
continue goal selection.

Buddy automation must not merge or push `$OPENSPEC_BUDDY_RELEASE_BRANCH`;
promoting base to release remains a manual release decision unless the project
configures otherwise.
