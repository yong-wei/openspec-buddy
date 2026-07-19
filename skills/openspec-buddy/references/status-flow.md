# OpenSpec Buddy Status Flow

Default lightweight propose creates `status:ready` directly and does not require
a Project. The remaining transitions belong to legacy/full coordination: use
labels as the agent-facing state record and mirror them to a configured GitHub
Project through `set-status-label.sh`.

## Status Labels

```text
status:backlog
status:ready
status:claimed
status:in-progress
status:in-review
status:merged
status:archived
status:blocked
status:tracking
status:stale-claim
status:needs-human
status:failed
```

Only one `status:*` label should be present on an issue. Do not modify status labels directly; use `scripts/set-status-label.sh` so the Project board stays synchronized.

## Normal Flow

```text
Backlog -> Ready -> Claimed -> In Progress -> In Review -> Archived
```

For an ordinary collaborator issue, `claim` is the first Buddy transition:

```text
Open issue -> Claimed on the original issue -> Simple executable change -> In Progress
Open issue -> Claimed on the original issue -> Complex decomposition -> Tracking parent + Ready child issues
```

Complex issue decomposition is not deferred to a later phase. After the claim
lock succeeds, classify immediately. Only convert the source issue to
`status:tracking` after child executable issues have been created and linked.
Never create a duplicate issue just to carry Buddy metadata for the source
issue; the original issue is either the executable change or the tracking
parent.

## Triage Dispositions

Triage feeds the existing status model; it does not introduce another label
system:

| Triage result | Existing Buddy transition |
| --- | --- |
| executable | continue the ordinary claim or proposal path |
| series-parent | use `status:tracking` for the source and `status:ready` for independently executable children |
| blocked | use `status:blocked` with the recorded dependency or conflict evidence |
| insufficient information / needs-human | use `status:needs-human` and wait for human input |
| complete or superseded / close | close with the recorded implementation or supersession evidence |

Complete or superseded work must close with evidence and must not create a
duplicate issue or another change. For a claimed issue, the close disposition
is applied only after claim ownership and the evidence-bound triage result are
revalidated. For a local proposal, stop before GitHub Issue creation.

In the default pre-archive PR flow, the OpenSpec files move to
`openspec/changes/archive/` before review, but the GitHub issue remains
`status:in-review` until the PR merges. After merge, `mark-achieved.sh` moves
the issue directly to `status:archived`, sets Project `Done`, sets `End`, and
closes it.

`status:merged` is retained only as a legacy/recovery state for older flows
where a PR was merged before the OpenSpec archive landed.

`Blocked` can be entered from `Backlog` or `Ready` when dependencies, branch constraints, or coupling-group constraints prevent execution. `Stale-claim`, `needs-human`, and `failed` are recovery labels for automation.
`Tracking` is reserved for non-executable series parent issues. A series parent moves from `tracking` to `archived` only after all child change issues are closed and labeled `status:archived`.

## Agent Actions

| Action | From | To | Required proof |
| --- | --- | --- |
| default lightweight propose | none | ready | pushed local OpenSpec change, lightweight `change_id` mapping, required labels, and native `blockedBy` links confirmed |
| legacy/full propose | none/backlog | ready | issue front matter, coordination labels, relationship links, and configured Project `Todo` created |
| claim prepared change | ready | claimed | assignee and claim comment confirmed |
| claim open issue | open/backlog/ready | claimed | branch lock, hidden metadata, assignee, status, and Project sync confirmed |
| decompose complex claim | claimed | tracking parent + ready children | child issues exist and are linked |
| start work | claimed | in-progress | branch exists and OpenSpec change is selected |
| open pre-archived PR | in-progress | in-review | PR URL comment and archive path included in PR |
| achieve merged PR | in-review | archived | PR merge commit, archived tasks complete, archive path |
| legacy merge PR | in-review | merged | PR merge commit without archive path |
| legacy archive | merged | archived | OpenSpec archive path |
| finish series parent | tracking | archived | every child issue is closed and `status:archived` |
| stale claim | claimed/in-progress | stale-claim | expired lease and safe branch/PR recovery proof |
| human escalation | any active state | needs-human | ambiguity, repeated review loops, or unsafe recovery |
| failure | any active state | failed | reproducible failure with command output |

## Coupling Rule

Before claiming a prepared issue, check open issues in the same `coupling_group`.
For an ordinary open issue, `claim-issue.sh` derives `coupling_group: none`
unless an existing label such as `coupling:<name>` provides a stricter group.

Stop if any issue other than the current one has:

```text
status:claimed
status:in-progress
```

This rule prevents two worktrees from executing strongly coupled changes at the same time.

## Claim Lock Rule

`status:claimed` is valid only when the issue also has:

```text
origin/<change_id> exists
latest OpenSpec Buddy Claim comment records the branch
claim lease has not expired
```

If the label and branch disagree, stop and mark the issue `status:needs-human` unless the recovery condition in `claim-locking.md` is satisfied.
