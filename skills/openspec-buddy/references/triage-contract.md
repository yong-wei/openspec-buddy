# Triage Contract

Buddy triage records repository and issue judgment in `.buddy/triage.json`. The
record is local evidence bound to a specific issue update and Git base; it does
not replace GitHub status, OpenSpec artifacts, or live repository truth.

```json
{
  "subject": { "issue": 42, "change_id": "example-change" },
  "truth": {
    "problem_reproduced": "yes",
    "evidence": ["The failing CLI fixture reproduces the reported behavior"]
  },
  "duplication": {
    "existing_implementation": "none",
    "conflicting_specs": [],
    "active_changes": [],
    "superseded_by": null
  },
  "readiness": {
    "information": "sufficient",
    "disposition": "executable",
    "reason": "The repository evidence defines an independently executable change"
  },
  "binding": {
    "issue_updated_at": "2026-07-14T08:00:00Z",
    "base_sha": "0123456789abcdef0123456789abcdef01234567",
    "generated_at": "2026-07-14T08:05:00Z"
  }
}
```

## Fields

- `subject.issue` is a positive GitHub issue number or `null` for a local
  proposal. `subject.change_id` is always a string and identifies the OpenSpec
  change. It may be empty while an ordinary issue has been minimally claimed
  but the change identity has not yet been assigned.
- `truth.problem_reproduced` is `yes`, `no`, or `not-applicable`.
  `truth.evidence` contains at least one concrete evidence statement.
- `duplication.existing_implementation` is `none`, `partial`, or `complete`.
  Conflict and active-change fields are arrays of identifiers;
  `superseded_by` is an identifier or `null`.
- `readiness.information` is `sufficient` or `insufficient`.
  `readiness.disposition` is `executable`, `series-parent`, `needs-human`,
  `blocked`, or `close`. `reason` records the judgment.
- `binding.issue_updated_at` is the issue timestamp used for triage and must be
  non-null when `subject.issue` contains an issue number. It must be `null` for
  a local subject without an issue.
  `binding.base_sha` is the inspected Git base SHA, or an empty string when no
  Git base applies. `binding.generated_at` records when the judgment was made.
  Both timestamp fields use RFC3339 with an explicit `Z` or numeric timezone.

The validator checks required fields, types, enum values, evidence presence,
and caller-supplied subject identity, issue-time, and Git bindings. Claim binds
the exact Issue number and assigned change ID; local propose binds `issue:null`
and the requested change ID. It deliberately does not infer a disposition from
the evidence. That judgment remains agent-owned.

## Validation

```bash
rtk node skills/openspec-buddy/scripts/validate-triage.mjs \
  .buddy/triage.json \
  --issue 42 \
  --change-id example-change \
  --issue-updated-at 2026-07-14T08:00:00Z \
  --base-sha 0123456789abcdef0123456789abcdef01234567
```

Success writes a machine-readable normalized result:

```json
{"disposition":"executable"}
```

A changed expected issue timestamp or base SHA fails validation as stale. Field,
type, enum, and binding failures are written to standard error with a nonzero
exit status.
