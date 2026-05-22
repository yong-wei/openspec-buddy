# OpenSpec Buddy Metadata Schema

GitHub Issue front matter is the machine-readable task record.

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
- A change can be claimed only from `status:ready`.
