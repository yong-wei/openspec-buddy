# OpenSpec Buddy Issue Template

Default propose keeps the GitHub record small. OpenSpec artifacts remain the
source of proposal detail.

```markdown
<!-- openspec-buddy change_id: example-change-id -->

## Goal

Describe the outcome in a few sentences.

## Scope

- State the important implementation boundary.

## Acceptance

- State the observable completion condition.

Proposal: <commit or repository link>
```

Apply these required labels:

```text
type:change
status:ready
```

The marker must appear exactly once. Search open and closed Issues for the same
marker before creating a new Issue. Extra labels and sections are optional.

Use GitHub native `blockedBy` relationships for real dependencies. Do not copy
parent or dependency edges into the Issue body. A tracking parent may be used
when it improves navigation, but it is not required for scheduling executable
changes.
