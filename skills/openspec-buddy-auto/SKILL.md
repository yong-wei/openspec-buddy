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

AFTER STARTING THE DRIVER: DO NOT RUN COMMANDS, DO NOT QUERY GITHUB, DO NOT
CHECK TIME, DO NOT OUTPUT PROGRESS, AND DO NOT SUMMARIZE. WAIT SILENTLY UNTIL
THE DRIVER RETURNS `DONE`, `BLOCKED`, OR `HANDOFF`.

DO NOT HAND-WRITE `sleep`, `gh pr view`, `gh api`, REVIEW POLLING, MERGE
JUDGMENTS, OR STATE TRANSITIONS IN PLACE OF THE DRIVER'S NEXT LEGAL COMMAND.
</EXTREMELY_IMPORTANT>

Resolve `<openspec-buddy-auto-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

## Operating Rule

Run the driver without arguments. The driver owns deterministic helper
execution for the current phase. It returns only when the phase has a result, a
blocker, or an agent-owned handoff.

If the user names a specific issue or PR, seed that target before running the
same driver:

```bash
OPENSPEC_BUDDY_AUTO_TARGET_ISSUE=<issue-number> <openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs
OPENSPEC_BUDDY_AUTO_TARGET_PR=<pr-number> <openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs
```

Target seeds are normal operation, not manual workflow substitution. A target
issue must not be overwritten by an ambient current PR from the worktree.

If the user explicitly asks for goal mode, completion of all available changes,
or continuing until no executable changes remain, authorize the same driver to
select the next issue:

```bash
OPENSPEC_BUDDY_AUTO_GOAL=1 <openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs
```

Goal authorization is the only empty-context path that may run the selector and
claim the next issue. Without it, an empty worktree context must stop.

## Multi-Lane Opt-In

Use multi-lane mode only when the user explicitly asks to work on another issue
while submitted PRs wait for online Codex review:

```bash
OPENSPEC_BUDDY_AUTO_GOAL=1 OPENSPEC_BUDDY_AUTO_LANES=2 <openspec-buddy-auto-skill-dir>/scripts/buddy-auto-lane-driver.mjs
```

After starting the lane driver, obey the same silence rule. Multi-lane is
single-writer scheduling, not parallel implementation; do not mix it with a
concurrently running single-lane driver in the same worktree. Details live in
`references/driver-states.md` and `references/review-waiting.md`.

If it reports `BLOCKED`, fix only that blocker. If it reports `HANDOFF`, do
only the requested agent work. After agent-owned work or external state changes,
run the driver again.

The driver writes local receipts under `openspec/.buddy-cache/auto-state/`.
Receipts do not replace GitHub truth; they only prevent skipped helper sequence.

## Required References

- `references/driver-states.md`: receipts, lane states, and next-command rules
- `references/selection-rules.md`: executable issue selection
- `references/execution-loop.md`: one-change lifecycle
- `references/review-waiting.md`: review wait and review-fix loop
- `references/failure-recovery.md`: stale claim and stop conditions

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

Driver options such as `--dry-run`, `--issue`, `--pr`, `--change`, and
`--no-pr` are compatibility and diagnostic controls. Prefer the target
environment variables above for user-specified issue or PR work.

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
