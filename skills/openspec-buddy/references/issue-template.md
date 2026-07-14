# OpenSpec Buddy Issue Template

Use this template when running `openspec-buddy propose`.

```markdown
---
change_id: example-change-id
claim_branch: example-change-id
series: example-series
coupling_group: example-coupling-group
execution_mode: isolated
base_branch: example-base-branch
required_branch:
depends_on: []
parent_issue:
blocked_by: []
blocking: []
openspec_path: openspec/changes/example-change-id
risk: medium
area: example-area
---

## Goal

Describe the user-visible or engineering outcome.

## Scope

- List the implementation boundaries.
- Keep the scope tied to this single change.

## Out of Scope

- List adjacent changes that must not be implemented here.

## Acceptance Checklist

- [ ] AC-1: Observable, testable outcome. Owner: independent reviewer.
  Evidence: validation command, automated test, or manual check.
- [ ] AC-2: Another outcome if needed. Owner: independent reviewer.
  Evidence: validation command, automated test, or manual check.

## Tasks

- [ ] Task 1: Concrete implementation step.
  Covers: AC-1
  Acceptance: what must be true for this task to satisfy the linked AC.
  Evidence: command, test, file check, or manual check expected from implementation.
  Reviewer Check: what the independent reviewer must confirm before AC-1 can be checked.
- [ ] Task 2: Another concrete implementation or validation step.
  Covers: AC-2
  Acceptance: what must be true for this task to satisfy the linked AC.
  Evidence: command, test, file check, or manual check expected from implementation.
  Reviewer Check: what the independent reviewer must confirm before AC-2 can be checked.

## Agent Guardrails

- Only execute this issue's change.
- Implementation agents may propose satisfied AC ids with evidence, but must not check Acceptance Checklist items themselves.
- Check AC items only after an independent reviewer confirms the linked task evidence.
- Use the claim branch named in front matter.
- Do not execute other planned OpenSpec changes.
- Stop if dependency, coupling group, or branch constraints fail.
- Stop if GitHub blockedBy relationships still contain open blockers.
```

Keep proposal review decisions beside the OpenSpec change rather than adding
them to Issue front matter. For a single vertical slice,
`.buddy/proposal-review.yaml` can contain:

```yaml
split_status: single-change
vertical_slice_status: valid
blocking_edges_status: valid
wide_refactor_strategy: none
children: []
```

For a series, set `split_status: series-required` and list the child change IDs
under `children`. For a broad mechanical migration, set
`wide_refactor_strategy: expand-migrate-contract` and explain the expansion,
migration, and contraction sequence in the change design.

For non-empty list fields, use YAML block lists:

```yaml
depends_on:
  - upstream-change-id
blocked_by:
  - 123
blocking:
  - 456
```

Do not write non-empty lists inline as `[upstream-change-id]`; the Buddy
metadata parser rejects that form. Empty lists should remain inline as `[]`.

Labels to apply:

```text
status:ready
type:change
level:<level> # when the project uses level labels
area:<area>
series:<series>
risk:<low|medium|high>
mode:<isolated|fixed-branch|stacked|docs-only>
coupling:<coupling_group> # when coupling_group is not none
```

Before creating the issue, verify each planned label exists in the repository.
Create missing Buddy-required labels or stop and report the exact missing label;
do not silently omit labels or substitute a different coordination label.
