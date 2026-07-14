# Core Lifecycle Reference

The top-level `SKILL.md` is intentionally short. It tells the agent to run the
driver first. This file holds the stage rules the driver points to.

## Driver Rule

Every manual Buddy phase starts with:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode <explore|claim|propose|apply|achieve>
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

Invoke it with the matching question classification:

```bash
<openspec-buddy-skill-dir>/scripts/buddy-driver.mjs --mode explore --explore-question <intent|facts|interaction-state|active-change-design>
```

## Claim

Use claim for an existing GitHub issue. The claim helper is the hard gate:

```bash
<openspec-buddy-skill-dir>/scripts/claim-issue.sh [issue-number]
```

It verifies the bound worktree, synchronizes the base branch, reads current
GitHub truth, writes only the minimal claim lock, then re-reads GitHub truth.
Only after the lock belongs to this run and worktree may it create or reuse the
Development branch, Project fields, and remote claim branch.

An ordinary open issue is claim-first: acquire and verify the minimal claim
lock, re-read live issue truth, then run triage. Missing triage produces a
`HANDOFF` while the verified lock remains active; it does not authorize later
coordination or implementation mutations. The triage judgment must be bound to
the re-read issue `updatedAt` and inspected base SHA.

If the issue is ordinary, claim adopts that same issue by adding hidden Buddy
metadata. If the issue is too large, decompose it into child issues and make the
source issue a `type:series-parent` tracking record.

## Propose

Use propose to create a local OpenSpec change and, by default, the matching
GitHub issue.

A local proposal is triage-first. Collect bounded repository evidence and
validate `.buddy/triage.json` before proposal validation and before any GitHub
Issue mutation. This ordering avoids creating a duplicate issue or change when
the requested behavior is already complete, superseded, blocked, or not yet
specified well enough to execute.

Matt skills for grilling or research are an optional method for producing a
triage judgment. When they are not installed, use the Buddy-native fallback:
inspect the issue, specs, active and archived changes, bounded matching code
paths, and the current Git base, then record the agent-owned judgment in the
same triage contract. Provider availability must not change Buddy state,
artifacts, status mapping, or lifecycle gates.

Required local artifact:

```text
openspec/changes/<change_id>/.buddy/issue.md
```

This file is the exact GitHub issue body. Validate it before any GitHub issue
mutation:

```bash
<openspec-buddy-skill-dir>/scripts/validate-issue-body.mjs openspec/changes/<change_id>/.buddy/issue.md
```

Proposal review decisions belong in the local manifest at
`openspec/changes/<change_id>/.buddy/proposal-review.yaml`. Record:

- `split_status`: `single-change` or `series-required`
- `vertical_slice_status`: `valid` or `invalid`
- `blocking_edges_status`: `valid` or `incomplete`
- `wide_refactor_strategy`: `none` or `expand-migrate-contract`
- `children`: the child change IDs, or `[]` for a single change

A child is valid only when it is independently claimable, testable, reviewable,
and deliverable as one PR. This test applies to executable outcomes, not to
every layer of their implementation: database, API, UI, and test steps may
remain tasks in the same change when they together deliver one vertical slice.

Broad mechanical migrations are the exception to ordinary vertical slicing.
Set `wide_refactor_strategy: expand-migrate-contract` when expansion,
migration, and contraction must be coordinated across a wide surface. Do not
invent pseudo-slices that cannot pass independently merely to reduce diff size.

The issue body must include a Buddy Acceptance Checklist and task-to-AC mapping:

- `## Acceptance Checklist`
- unchecked sequential `AC-1`, `AC-2`, ...
- `Evidence:` for every AC
- `## Tasks`
- every task has `Covers: AC-*`, `Acceptance:`, `Evidence:`, and
  `Reviewer Check:`
- every referenced AC exists
- every AC is covered by at least one task

The change design must also declare its testing contract in one
`## Testing Strategy` section. Behavioral, `medium-risk`, and `high-risk`
changes require `Seam status: required`. Documentation and mechanical changes
may use `not-applicable`, but `Public seam` must then name an explicit
verification method and `Rationale` must explain why a public seam does not
apply. For `Seam status: required`, `Rationale` must give a substantive
explanation of why the selected seam is sufficient for the public behavior and
AC coverage; a label or restatement of the seam is not enough.

`Public behavior` names the observable outcome. `Public seam` names the highest
public interface at which that outcome can be verified, rather than an internal
helper. `Existing seam reused` identifies the established test boundary when
one exists. Every issue AC must appear exactly once across `AC coverage` and
`Manual-only acceptance`; use `none` only when the entire map is empty. A
manual-only entry must state why automation is not applicable, then a literal
`|`, then the manual evidence check: `AC-N: automation rationale | manual
evidence check`. Both sides of `|` must be substantive. Multiple AC entries in
either map remain semicolon-separated.

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

Apply consumes the already approved public seam from the change's Testing
Strategy. It must not restart product-level seam selection or ask the user to
choose another seam. If implementation evidence shows the approved contract is
invalid, stop and return to proposal/design work instead of silently replacing
it.

Matt TDD is an optional provider that changes the implementation method only.
When it is unavailable, the Buddy-native fallback is red-before-green,
public-interface tests, one vertical cycle at a time, and minimal
implementation. Provider availability never changes Buddy state, receipts,
artifacts, or lifecycle gates. Provider-specific refactoring advice is not a
Buddy gate; the existing independent review requirements below remain
authoritative.

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
