---
name: openspec-buddy
description: Use when the user explicitly invokes openspec-buddy explore, claim, propose, apply, or achieve for OpenSpec changes coordinated through GitHub Issues across branches, agents, or worktrees.
compatibility: Requires openspec CLI and GitHub CLI.
---

# OpenSpec Buddy

OpenSpec Buddy is the coordination layer for OpenSpec work. GitHub Issues are
the default coordination record; `openspec-buddy propose --no-issue` is the
explicit local-only exception.

<EXTREMELY_IMPORTANT>
EVERY OPENSPEC-BUDDY PHASE MUST START BY RUNNING THE DRIVER SCRIPT.

RUN THIS BEFORE EXPLORE, CLAIM, PROPOSE, APPLY, ACHIEVE, REVIEW, MERGE, OR ISSUE STATE
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
run the driver again, except for propose registration: the propose HANDOFF is
the complete model-owned workflow and ends after its single live read-back.

## Core Invariant

For GitHub-backed work:

```text
one GitHub Issue = one change_id = one claim branch = one OpenSpec change = one PR
```

`claim_branch` must equal `change_id`. GitHub Issue, PR, Project, review, and
claim ownership state are truth. Cache and local notes are accelerators only.

## Explore Entry

Classify the uncertainty, then invoke the read-only manual Explore phase:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode explore --explore-question <intent|facts|interaction-state|active-change-design>
```

The driver returns exactly one matching optional method or its native fallback.
Explore does not mutate repository or GitHub state and is not a Buddy Auto mode.

## Propose Entry

After the required first driver call identifies propose work, invoke the
lightweight propose handoff explicitly:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode propose --change <change_id>
```

Add `--no-issue` only for an intentionally local-only change. The propose
handoff is model-owned and completes after the single GitHub read-back described
in `references/core-lifecycle.md`; do not rerun it as a state machine.

## Required Configuration

默认 `openspec-buddy init` 只生成 Auto lite 所需的 base branch。Manual Buddy 的
GitHub/Project 协调需要先运行：

```bash
openspec-buddy init --full
```

随后 driver 会要求检查：

```bash
<openspec-buddy-skill-dir>/scripts/check-config.sh
```

Claim, review, and achievement flows require `OPENSPEC_BUDDY_BASE_BRANCH`,
`OPENSPEC_BUDDY_RELEASE_BRANCH`, `OPENSPEC_BUDDY_PROJECT_OWNER`,
`OPENSPEC_BUDDY_PROJECT_NUMBER`, and `OPENSPEC_BUDDY_PROJECT_TITLE`.
Default propose only requires `OPENSPEC_BUDDY_BASE_BRANCH`.
`propose --no-issue` only requires `OPENSPEC_BUDDY_BASE_BRANCH`.

## Auto Entry

需要自动执行时调用 `openspec-buddy-auto` 技能的公开
`scripts/buddy-auto.mjs`。无参数默认为 lite；现有 controller 工作流必须显式调用
`scripts/buddy-auto.mjs full`。Manual Buddy 不直接调用 Auto 的 lite 或 full 内部脚本。

## References

- `references/core-lifecycle.md`: explore, claim, propose, apply, review, achieve stage rules
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
- For propose, keep exactly one stable `change_id` mapping between the local
  OpenSpec change and its GitHub Issue. Use native GitHub `blockedBy` for real
  dependencies; do not duplicate dependency state in Buddy metadata.
- Do not manually infer review clearance from `gh pr view --comments`.
- Do not check Acceptance Checklist items from the implementation thread;
  independent review decides approved AC ids.
- Do not treat `--no-pr` as valid for issue-backed changes. It only applies to
  an explicitly targeted Local-only change with no mapped Issue. Auto 的
  Local-only 默认仍走 PR，只有用户明确选择 `--change <change_id> --no-pr`
  时才直接集成。
- Use the documented Explore and propose driver invocations in normal operation.
  Other options such as `--dry-run`, `--issue`, and `--pr` remain compatibility
  and diagnostic controls for exceptional recovery.

## Final Report

End every Buddy run with a short retrospective:

- what the driver selected or blocked
- which helper commands ran
- verification evidence
- any reusable workflow gap that should become a Buddy rule
