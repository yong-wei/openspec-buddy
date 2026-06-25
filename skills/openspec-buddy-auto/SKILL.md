---
name: openspec-buddy-auto
description: Use when the user asks to automatically process GitHub Issue-backed or explicitly local-only OpenSpec changes end to end, including selecting executable changes, claiming work, implementing, opening PRs, handling review loops, merging, archiving, or iterating through all available changes.
compatibility: Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and a foreground shell wait for review pauses.
---

# OpenSpec Buddy Auto

OpenSpec Buddy Auto is the high-permission execution layer for OpenSpec changes.
It must use OpenSpec Buddy helpers for claim, PR coordination, review waiting,
merge gates, and achievement sync.

<EXTREMELY_IMPORTANT>
EVERY OPENSPEC-BUDDY-AUTO STEP MUST START BY RUNNING THE AUTO DRIVER.

RUN THIS BEFORE SELECTION, CLAIM, IMPLEMENTATION, COMMIT, PUSH, PR REVIEW,
REVIEW-FIX, MERGE, ACHIEVE, OR GOAL-LOOP CONTINUATION:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs
```

WHEN ISSUE OR PR CONTEXT IS KNOWN, PASS IT:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs --issue <issue-number> --pr <pr-number-or-url>
```

DO NOT HAND-WRITE `sleep`, `gh pr view`, `gh api`, REVIEW POLLING, MERGE
JUDGMENTS, OR STATE TRANSITIONS IN PLACE OF THE DRIVER'S NEXT LEGAL COMMAND.
</EXTREMELY_IMPORTANT>

Resolve `<openspec-buddy-auto-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

## Operating Rule

Run the driver. Execute only the next legal command it prints. Then run the
driver again. If the driver reports a blocked state, fix that state before
continuing.

For review phases, prefer:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs --issue <issue-number> --pr <pr-number-or-url> --run-next
```

The driver writes local receipts under `openspec/.buddy-cache/auto-state/`.
Receipts do not replace GitHub truth; they only prevent the agent from skipping
the required Buddy helper sequence.

## Required References

- `references/driver-states.md`: state receipts and next-command rules
- `references/selection-rules.md`: executable issue selection
- `references/execution-loop.md`: detailed one-change lifecycle
- `references/review-waiting.md`: foreground review wait and review-fix loop
- `references/failure-recovery.md`: stale claim, unsafe recovery, and stop conditions

## GitHub-Backed Path

The driver and helpers must enforce:

- selection uses the smallest claimable executable issue
- claim happens before implementation
- PRs go through `mark-review.sh` before any review wait
- review wait uses `wait-for-review-clear.sh` as the foreground wait
- review-fix commits pass independent review, same-thread reply, and
  `review-response-gate.sh` before requesting a new current-head review
- merge and achievement require current review clearance, PR coordination,
  archived tasks, and worktree claim ownership

## Local-Only Exception

`--no-pr` is valid only for a selected local-only change created through
`openspec-buddy propose --no-issue`. In that path, do not create GitHub issue,
PR, Project, review, or achievement state. Run local review and verification
instead.

## Forbidden Manual Substitutes

- manual `sleep` or time checks during review wait
- manual `gh pr view --comments` review clearance
- direct `request-pr-review.sh` before PR coordination
- direct `wait-for-review-clear.sh` when `mark-review` has not passed
- direct merge or `mark-achieved.sh` without current-head review clearance
- takeover of a claim owned by another worktree unless the user explicitly
  requests a takeover workflow

## Final Report

Report the driver stages, issue, change id, branch, PR, review rounds,
verification commands, and any blocker or reusable workflow gap.
