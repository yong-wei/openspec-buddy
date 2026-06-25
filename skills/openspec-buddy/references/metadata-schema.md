# OpenSpec Buddy Metadata Schema

GitHub Issue metadata is the machine-readable task record.

Prepared Buddy issues created by `propose` should use YAML front matter at the
start of the issue body. Ordinary collaborator issues adopted through
`claim-issue.sh` keep their human-readable body and receive a hidden metadata
block in the same original issue instead:

```markdown
<!-- openspec-buddy
change_id: issue-27-student-flow
claim_branch: issue-27-student-flow
series: student-flow
coupling_group: none
execution_mode: isolated
base_branch: integration
required_branch:
depends_on: []
openspec_path: openspec/changes/issue-27-student-flow
risk: medium
area: workflow
-->
```

`parse-issue-metadata.mjs` accepts both forms. If both are present, front matter
wins; avoid that mixed state unless repairing an old issue. `propose` must run
`validate-issue-body.mjs` before creating or updating a GitHub Issue; that
script first applies metadata parsing and then checks the Buddy Acceptance
Checklist and task-to-AC contract. Do not create a second "Buddy" issue to
mirror the original task; that breaks PR association and issue history. Complex
issues may create child executable issues, but only after the original issue has
been claimed and kept as the tracking parent.

## Required Fields

| Field | Meaning | Rule |
| --- | --- | --- |
| `change_id` | OpenSpec change name | kebab-case |
| `claim_branch` | Branch reserved for the implementation | must equal `change_id` |
| `series` | Larger work series | non-empty |
| `coupling_group` | Mutual-exclusion group | non-empty; use `none` only for truly independent work |
| `execution_mode` | Branching mode | `isolated`, `fixed-branch`, `stacked`, or `docs-only` |
| `base_branch` | Branch used as base | must equal `$OPENSPEC_BUDDY_BASE_BRANCH`; automation rejects `$OPENSPEC_BUDDY_RELEASE_BRANCH` |
| `depends_on` | Upstream changes | list; use `[]` if none |
| `openspec_path` | Local OpenSpec change path | should be `openspec/changes/<change_id>` |
| `risk` | Review and validation level | `low`, `medium`, or `high` |
| `area` | Product or code area | non-empty |

## Optional Field

| Field | Meaning | Rule |
| --- | --- | --- |
| `required_branch` | Existing branch that must be used | empty unless execution mode requires it |
| `parent_issue` | Series parent issue number or URL | mirror of GitHub parent relationship |
| `blocked_by` | Issue numbers or change ids blocking this change | mirror of GitHub `blockedBy`; list |
| `blocking` | Issue numbers or change ids this change blocks | mirror of GitHub `blocking`; list |

## Validation Rules

- `change_id` must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- `claim_branch` must equal `change_id`.
- `base_branch` must equal `$OPENSPEC_BUDDY_BASE_BRANCH` for normal Buddy automation.
- `openspec_path` should equal `openspec/changes/<change_id>`.
- `depends_on` must parse as a list, including an empty list.
- `blocked_by` and `blocking`, when present, must parse as lists.
- Empty list fields should be written as `[]`.
- Non-empty `depends_on`, `blocked_by`, and `blocking` fields must be written
  as YAML block lists:
  ```yaml
  depends_on:
    - upstream-change-id
  blocked_by:
    - 123
  blocking:
    - 456
  ```
- Do not write non-empty list fields inline as `[upstream-change-id]`; the
  parser rejects that form so downstream dependency checks cannot misread the
  metadata.
- `execution_mode: fixed-branch` requires `required_branch` to equal `claim_branch`.
- `execution_mode: stacked` requires `depends_on` to be non-empty.
- A prepared Buddy change can be claimed only from `status:ready`.
- An ordinary open issue can be claimed by `claim-issue.sh` when it is open,
  unassigned or assigned to the current viewer, not a series parent, and has no
  active or terminal `status:*` label. Missing status, `status:backlog`, and
  `status:ready` are claimable.
