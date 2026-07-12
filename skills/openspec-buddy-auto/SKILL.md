---
name: openspec-buddy-auto
description: Use when the user asks to automatically process GitHub Issue-backed or explicitly local-only OpenSpec changes end to end, including selecting executable changes, claiming work, implementing, opening PRs, handling review loops, merging, archiving, or iterating through all available changes.
compatibility: Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and a foreground shell wait for review pauses.
---

# OpenSpec Buddy Auto

OpenSpec Buddy Auto is the high-permission execution layer for OpenSpec
changes. The auto controller owns selection, claim, PR coordination, review
waiting, lane scheduling, merge gates, and achievement sync.

<EXTREMELY_IMPORTANT>
EVERY OPENSPEC-BUDDY-AUTO STEP MUST START BY RUNNING THE AUTO CONTROLLER.

RUN THIS BEFORE SELECTION, CLAIM, IMPLEMENTATION, COMMIT, PUSH, PR REVIEW,
REVIEW-FIX, MERGE, ACHIEVE, GOAL-LOOP CONTINUATION, OR RECOVERY:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

AFTER STARTING THE CONTROLLER: DO NOT RUN COMMANDS, DO NOT QUERY GITHUB, DO NOT
CHECK TIME, DO NOT OUTPUT PROGRESS, AND DO NOT SUMMARIZE. WAIT SILENTLY UNTIL
THE CONTROLLER RETURNS `DONE`, `BLOCKED`, OR `HANDOFF`.

DO NOT RUN DETERMINISTIC HELPERS DIRECTLY. DO NOT HAND-WRITE `sleep`, `gh pr
view`, `gh api`, REVIEW POLLING, MERGE JUDGMENTS, OR STATE TRANSITIONS IN PLACE
OF THE CONTROLLER.
</EXTREMELY_IMPORTANT>

Resolve `<openspec-buddy-auto-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

## First Run Seeds

Normal continuation uses no arguments:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

If the user names a specific issue or PR, seed the first controller run:

```bash
OPENSPEC_BUDDY_AUTO_TARGET_ISSUE=<issue-number> <openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
OPENSPEC_BUDDY_AUTO_TARGET_PR=<pr-number> <openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

If the user explicitly asks for goal mode, completion of all available changes,
or continuing until no executable changes remain, seed goal mode:

```bash
OPENSPEC_BUDDY_AUTO_GOAL=1 <openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

If the user explicitly asks to work on another issue while submitted PRs wait,
seed multi-lane mode:

```bash
OPENSPEC_BUDDY_AUTO_MODE=multi OPENSPEC_BUDDY_AUTO_LANES=2 OPENSPEC_BUDDY_AUTO_GOAL=1 <openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

Seeds are first-run inputs. After controller state exists,
`openspec/.buddy-cache/auto-controller/` is authoritative for mode, target,
goal, lanes, and active interrupt. Do not switch between single-lane and
multi-lane commands; there is only the controller.

## Interrupt Rule

`HANDOFF` and `BLOCKED` are persistent controller interrupts, not permission to
choose a helper script.

- If the controller reports `HANDOFF`, do only the described agent-owned work.
- If the controller reports `BLOCKED`, fix only that blocker.
- After any external work or state change, run `buddy-auto.mjs` again.
- The controller will re-run the relevant verifier or failed phase and decide
  whether to repeat, advance, or stop.

The controller writes local state under:

```text
openspec/.buddy-cache/auto-controller/
openspec/.buddy-cache/auto-state/
openspec/.buddy-cache/auto-lanes/
```

These files do not replace GitHub truth; they only prevent skipped sequence and
recover from handoff, blocked, or review-fix interruption.

## Recovery Commands

Use recovery commands only when the controller tells you to or the user
explicitly asks for recovery:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --reset-controller-state
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --reset-lane-state --reason "<why>"
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs --recover-unauthorized-merge --reason "<user-approved reason>"
```

The reset commands require a clean git worktree. `--reset-controller-state` clears only the
controller file for this worktree. `--reset-lane-state` moves this worktree's
local lane cache to a `.bak` file and clears controller state; it does not
modify GitHub, branches, OpenSpec files, or claims.

## Required References

- `references/driver-states.md`: controller receipts, interrupts, lane states
- `references/selection-rules.md`: executable issue selection
- `references/execution-loop.md`: one-change lifecycle
- `references/review-waiting.md`: review wait and review-fix loop
- `references/failure-recovery.md`: stale claim and stop conditions

## GitHub-Backed Path

The controller must enforce:

- selection uses the smallest claimable executable issue
- claim happens before implementation
- PR coordination and review request happen before review wait
- review wait is controller-owned; single-lane may block internally, multi-lane
  parks waiting PRs and schedules other lanes
- review-fix commits pass independent review, same-thread reply, response gate,
  and current-head review request before another wait
- merge and achievement require current review clearance, PR coordination,
  archived tasks, worktree claim ownership, and matching controller merge authorization
- quota/service-limit responses enter `review_unavailable`; remote merges without authorization enter `unauthorized_merge`

## Local-Only Exception

`--no-pr` is valid only for a selected local-only change created through
`openspec-buddy propose --no-issue`. In that path, do not create GitHub issue,
PR, Project, review, or achievement state. Run local review and verification
instead.

## Forbidden Manual Substitutes

- direct deterministic helper invocation during normal auto flow
- manual `sleep` or time checks during review wait
- manual `gh pr view --comments` review clearance
- direct review request, review wait, response gate, merge, achievement sync, or `gh pr merge`
- takeover of a claim owned by another worktree unless the user explicitly
  requests a takeover workflow

## Final Report

Report controller stages, issue, change id, branch, PR, review rounds, verification commands, and blockers.
