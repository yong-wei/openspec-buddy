# Selecting An Executable Change

Recalculate candidates at the start of every iteration.

## Candidate Source

Use both sources:

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

An issue is executable only when:

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

If any condition is unclear, mark the issue `status:blocked` or `status:needs-human` with a comment rather than guessing.

## Tie Breaker

Prefer:

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
