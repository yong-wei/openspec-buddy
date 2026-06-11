# Selecting A Claim Target

Recalculate candidates at the start of every iteration.

## Candidate Source

For GitHub-coordinated changes, `openspec-buddy claim` is the first action. If
the user supplies an issue number, claim that issue. If not, select the
smallest claimable open issue number and claim it before doing deeper
exploration or decomposition.

For ordinary open issues, use:

```bash
<openspec-buddy-skill-dir>/scripts/claim-issue.sh [issue-number]
```

The claim selector skips closed issues, issues assigned to another user, series
parents, and issues labeled with active or terminal `status:*` values. Missing
status, `status:backlog`, and `status:ready` are claimable.
Automatic selection uses the lowest issue number among those candidates.

After claim, immediately classify the issue:

- Simple issue: adopt it as one executable Buddy change and continue with the
  apply flow.
- Complex issue: keep the source issue claimed while creating child change
  issues, then make the source issue a `status:tracking` series parent.

For an ordinary open issue, claim and normalize that original issue in place by
adding Buddy metadata at the top. Do not create a second issue that mirrors the
same task; child issues are only for executable pieces of a genuinely complex
parent.

## Prepared Change Source

For already prepared Buddy issues with active OpenSpec changes, use both
sources:

```bash
openspec list --json
<openspec-buddy-skill-dir>/scripts/list-ready-change-relationships.sh 100
```

Then feed the active OpenSpec changes, relationship issue list, and optional current series into:

```bash
node <openspec-buddy-skill-dir>/scripts/select-next-change.mjs < selection-input.json
```

For the common case, use the wrapper:

```bash
<openspec-buddy-skill-dir>/scripts/select-next-change.sh [current-series]
```

A prepared issue is executable only when:

```text
local active OpenSpec change exists on latest $OPENSPEC_BUDDY_BASE_BRANCH
issue front matter parses successfully
issue change_id equals the OpenSpec change name
issue openspec_path exists
claim_branch equals change_id
base_branch equals $OPENSPEC_BUDDY_BASE_BRANCH
issue has status:ready
issue is not a type:series-parent tracking issue
native blockedBy contains no open, unarchived issue
no open PR exists for claim_branch
origin/<claim_branch> does not exist
depends_on entries are not active unfinished OpenSpec changes
same coupling_group has no claimed or in-progress issue
```

## Local-Only Prepared Change Source

If `openspec list --json` returns an active change explicitly marked as local
only, such as `no_issue: true`, `noIssue: true`, `issue: false`, or
`coordination: local`, treat it as a no-issue candidate. This path exists only
for changes intentionally created by `openspec-buddy propose --no-issue`.

For local-only changes:

- evaluate this path before any GitHub claim step
- do not call `claim`
- do not require GitHub issue metadata, labels, Project membership, or branch locks
- do not synthesize a placeholder issue
- prefer the current series when that metadata exists locally
- fall back to local-only selection only when no executable issue-backed change
  is ready or when the user explicitly asked for the local-only change

The selector wrapper must preserve structured `openspec list --json` entries
instead of collapsing every active change to a plain string, otherwise the
no-issue marker is lost before selection.

If any condition is unclear, mark the issue `status:blocked` or `status:needs-human` with a comment rather than guessing.

## Tie Breaker

Prepared executable changes prefer:

1. Issues from the current series when goal mode or the previous iteration has already started that series.
2. Issues that unblock downstream changes through GitHub `blocking` relationships.
3. Issues with larger direct or transitive blocking impact.
4. Lower-risk issues.
5. Older issue number.

This deliberately prioritizes clearing dependency chains over sampling unrelated ready issues.

Never select an issue solely because it appears first in an old cached list.

## Current Series Preference

Auto mode should keep a `currentSeries` value after claiming or completing a change. On the next iteration:

- If the same series has any executable issue, select from that series.
- If the same series has no executable issue, clear the preference and select globally.
- If another agent claimed the preferred issue first, recalculate relationships and retry selection once.
