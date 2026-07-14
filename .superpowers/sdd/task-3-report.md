# Task 3 Report: Series and Migration Rules

## Result

- Documented the four proposal review decisions and `children` in the local
  `.buddy/proposal-review.yaml` contract.
- Defined child independence as independently claimable, testable, reviewable,
  and deliverable in one PR while allowing database, API, UI, and test work to
  remain tasks within one vertical slice.
- Defined `series-required` tracking parents and executable child changes.
- Kept native GitHub `blockedBy` authoritative and Buddy dependency metadata as
  an auditable mirror.
- Documented `expand-migrate-contract` for broad mechanical migrations and
  rejected artificial slices that cannot pass independently.
- Added a manifest example outside the Issue front matter contract.
- Added no reviewer implementation or reviewer interface.

## TDD Evidence

RED:

```text
AssertionError: proposal review guidance must document split_status
```

GREEN:

```text
rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs
propose acceptance gates eval passed
```

## Verification

- `rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`: pass
- `rtk node skills/openspec-buddy/evals/verify-issue-relationships.test.mjs`: pass
- `rtk bash skills/openspec-buddy/evals/verify-issue-relationships-wrapper.test.sh`: pass
- `rtk bash skills/openspec-buddy/evals/list-ready-change-relationships.test.sh`: pass
- `rtk npm run test:fast`: pass
- `rtk git diff --check`: pass

## Concerns

None within Task 3. The untracked implementation plan remains untouched and is
not part of the task commit.
