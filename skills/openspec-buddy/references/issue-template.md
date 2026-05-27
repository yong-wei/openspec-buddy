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

## Acceptance Criteria

- [ ] Criteria are observable and testable.
- [ ] Validation commands or manual checks are named.

## Agent Guardrails

- Only execute this issue's change.
- Use the claim branch named in front matter.
- Do not execute other planned OpenSpec changes.
- Stop if dependency, coupling group, or branch constraints fail.
- Stop if GitHub blockedBy relationships still contain open blockers.
```

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
