# Task 3 Report: Native Explore Routing Documentation

## Result

- Added the manual Buddy Explore routing reference.
- Documented the four uncertainty routes: intent, facts, interaction/state,
  and active-change design.
- Documented native fallbacks, the read-only boundary, and explicit Buddy Auto
  exclusion.
- Linked the reference from the main skill and core lifecycle.
- Added acceptance-gate assertions for the documentation contract.

## TDD Evidence

RED:

```text
AssertionError: manual Buddy must document native explore routing
```

GREEN:

```text
rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs
propose acceptance gates eval passed
```

## Verification

- Focused acceptance-gate eval: exit 0.
- `rtk npm pack --dry-run`: exit 0.
- `rtk proxy npm pack --dry-run --json`: exit 0; package manifest includes
  `skills/openspec-buddy/scripts/detect-method-skills.mjs` and
  `skills/openspec-buddy/references/explore-routing.md`.
- Full `rtk timeout 900 npm test`: all observed groups through
  `sync-base-branch.test.sh` passed, then the run remained in the known
  `wait-for-review-clear.test.sh` baseline stall. The run was terminated per
  task-owner direction and is not reported as a full-suite pass.

## Concerns

- The full-suite baseline stall prevents a fresh complete-suite success claim;
  no Task 3-specific failure was observed.
