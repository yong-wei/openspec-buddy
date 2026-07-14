---
name: openspec-buddy
description: Use when the user explicitly invokes openspec-buddy claim, propose, apply, or achieve for OpenSpec changes coordinated through GitHub Issues across branches, agents, or worktrees.
compatibility: Requires openspec CLI and GitHub CLI.
---

# OpenSpec Buddy

OpenSpec Buddy is the coordination layer for OpenSpec work. GitHub Issues are
the default coordination record; `openspec-buddy propose --no-issue` is the
explicit local-only exception.

<EXTREMELY_IMPORTANT>
EVERY OPENSPEC-BUDDY PHASE MUST START BY RUNNING THE DRIVER SCRIPT.

RUN THIS BEFORE CLAIM, PROPOSE, APPLY, ACHIEVE, REVIEW, MERGE, OR ISSUE STATE
SYNC:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs
```

AFTER STARTING THE DRIVER: DO NOT RUN COMMANDS, DO NOT QUERY GITHUB, DO NOT
CHECK TIME, DO NOT OUTPUT PROGRESS, AND DO NOT SUMMARIZE. WAIT SILENTLY UNTIL
THE DRIVER RETURNS `DONE`, `BLOCKED`, OR `HANDOFF`.

DO NOT SUBSTITUTE MANUAL `gh`, `git`, `sleep`, HANDWRITTEN GRAPHQL, OR TEXT
INSPECTION FOR THE DRIVER'S NEXT LEGAL ACTION.
</EXTREMELY_IMPORTANT>

Resolve `<openspec-buddy-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

## First Command

Run the driver without arguments:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs
```

The driver owns deterministic helper execution for the current phase. It
returns only when the phase has a result, a blocker, or an agent-owned handoff.
If it reports `BLOCKED`, fix only that blocker. If it reports `HANDOFF`, do
only the requested agent work. After agent-owned work or external state changes,
run the driver again.

## Core Invariant

For GitHub-backed work:

```text
one GitHub Issue = one change_id = one claim branch = one OpenSpec change = one PR
```

`claim_branch` must equal `change_id`. GitHub Issue, PR, Project, review, and
claim ownership state are truth. Cache and local notes are accelerators only.

## Required Configuration

Before normal GitHub-backed commands, the driver will direct you to:

```bash
<openspec-buddy-skill-dir>/scripts/check-config.sh
```

Default GitHub-backed flows require `OPENSPEC_BUDDY_BASE_BRANCH`,
`OPENSPEC_BUDDY_RELEASE_BRANCH`, `OPENSPEC_BUDDY_PROJECT_OWNER`,
`OPENSPEC_BUDDY_PROJECT_NUMBER`, and `OPENSPEC_BUDDY_PROJECT_TITLE`.
`propose --no-issue` only requires `OPENSPEC_BUDDY_BASE_BRANCH`.

## References

- `references/core-lifecycle.md`: claim, propose, apply, review, achieve stage rules
- `references/explore-routing.md`: read-only explore question and method routing
- `references/claim-locking.md`: claim race and partial-claim handling
- `references/issue-template.md`: issue body template
- `references/metadata-schema.md`: Buddy metadata format
- `references/issue-relationships.md`: parent, dependency, and blocked-by rules
- `references/project-coordination.md`: GitHub Project rules
- `references/status-flow.md`: issue status transitions

## Non-Negotiable Rules

- Do not start implementation before the claim lock has been written and
  re-read from GitHub truth.
- Do not create GitHub issue bodies ad hoc; for propose, first create
  `openspec/changes/<change_id>/.buddy/issue.md` and validate it with
  `validate-issue-body.mjs`.
- Do not manually infer review clearance from `gh pr view --comments`.
- Do not check Acceptance Checklist items from the implementation thread;
  independent review decides approved AC ids.
- Do not treat `--no-pr` as valid for issue-backed changes. It only applies to
  explicitly local-only `--no-issue` changes.
- Do not use driver options in normal operation. Options such as `--dry-run`,
  `--mode`, `--issue`, `--pr`, and `--change` are compatibility and diagnostic
  controls for exceptional recovery only.

## Final Report

End every Buddy run with a short retrospective:

- what the driver selected or blocked
- which helper commands ran
- verification evidence
- any reusable workflow gap that should become a Buddy rule
