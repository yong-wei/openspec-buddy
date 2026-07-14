# Core Lifecycle Reference

The top-level `SKILL.md` is intentionally short. It tells the agent to run the
driver first. This file holds the stage rules the driver points to.

## Driver Rule

Every manual Buddy phase starts with:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode <claim|propose|apply|achieve>
```

Use `--issue`, `--pr`, `--change`, `--no-issue`, or `--run-next` when the
driver asks for them. Do not substitute manual `gh`, `git`, `sleep`, or
handwritten GraphQL checks for a Buddy helper.

## Explore

Explore is a read-only manual Buddy phase for resolving uncertainty before a
claim, proposal, or implementation decision. It may inspect repository and
primary-source evidence, clarify intent, or run a disposable experiment, but
it must not mutate repository or GitHub state. Follow
`references/explore-routing.md` for question classification, optional method
selection, and the native fallback.

## Claim

Use claim for an existing GitHub issue. The claim helper is the hard gate:

```bash
<openspec-buddy-skill-dir>/scripts/claim-issue.sh [issue-number]
```

It verifies the bound worktree, synchronizes the base branch, reads current
GitHub truth, writes only the minimal claim lock, then re-reads GitHub truth.
Only after the lock belongs to this run and worktree may it create or reuse the
Development branch, Project fields, and remote claim branch.

If the issue is ordinary, claim adopts that same issue by adding hidden Buddy
metadata. If the issue is too large, decompose it into child issues and make the
source issue a `type:series-parent` tracking record.

## Propose

Use propose to create a local OpenSpec change and, by default, the matching
GitHub issue.

Required local artifact:

```text
openspec/changes/<change_id>/.buddy/issue.md
```

This file is the exact GitHub issue body. Validate it before any GitHub issue
mutation:

```bash
<openspec-buddy-skill-dir>/scripts/validate-issue-body.mjs openspec/changes/<change_id>/.buddy/issue.md
```

The issue body must include a Buddy Acceptance Checklist and task-to-AC mapping:

- `## Acceptance Checklist`
- unchecked sequential `AC-1`, `AC-2`, ...
- `Evidence:` for every AC
- `## Tasks`
- every task has `Covers: AC-*`, `Acceptance:`, `Evidence:`, and
  `Reviewer Check:`
- every referenced AC exists
- every AC is covered by at least one task

Implementation threads may propose `Proposed satisfied: AC-...` with evidence,
but only an independent reviewer may approve which checklist items are checked.

Use `--no-issue` only for intentionally local-only changes. That path creates
no GitHub issue, Project item, Development link, or claim branch.

## Apply

Use apply only after claim ownership is clear. Before editing files:

```bash
<openspec-buddy-skill-dir>/scripts/sync-base-branch.sh
<openspec-buddy-skill-dir>/scripts/mark-in-progress.sh <issue-number>
```

The implementation branch is the declared `claim_branch` and must equal
`change_id`. Before opening a PR, local OpenSpec progress must be complete:

```bash
openspec instructions apply --change <change_id> --json
openspec validate <change_id> --strict
openspec archive <change_id> --yes
openspec validate <affected-capability> --strict
```

If a delta introduces a new capability and the main spec does not exist, create
the main spec skeleton before archiving.

If the issue contains an Acceptance Checklist, do not let the implementation
thread approve its own checklist items. Before the first implementation commit
or PR creation, run an independent review with the issue body, task-to-AC
mapping, current diff, and evidence. The review must explicitly return:

```text
approved_to_commit
approved_ac
rejected_ac
scope_status
regression_risk
required_fixes
```

Commit or PR creation may proceed only when `approved_to_commit: yes`. Only
items listed in `approved_ac` may be checked in the GitHub issue checklist or
issue tasks.

## Review And PR

For GitHub-backed work, do not implement PR coordination by hand. Use:

```bash
<openspec-buddy-skill-dir>/scripts/mark-review.sh <issue-number> <pr-number-or-url>
```

The helper configures PR labels, assignees, Project state, origin issue,
Development-link policy, review request, and coordination verification before
the issue enters `status:in-review`.

Review waiting belongs to Buddy Auto's driver. Manual Buddy runs may call the
same helper only when the PR coordination gate has passed:

```bash
<openspec-buddy-skill-dir>/scripts/wait-for-review-clear.sh <pr-number-or-url>
```

Do not infer clean review from `gh pr view --comments`.

## Achieve

After merge, keep the claim branch until issue achievement sync is complete:

```bash
<openspec-buddy-skill-dir>/scripts/verify-review-clear.sh <pr-number-or-url>
<openspec-buddy-skill-dir>/scripts/mark-achieved.sh <issue-number> <archive-path> <pr-number-or-url>
```

`mark-achieved.sh` verifies archived tasks, sets `status:archived`, updates
Project `Done` and `End`, closes the issue, and reconciles completed series
parents.
