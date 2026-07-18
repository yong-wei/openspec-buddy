# PR #26 full internal path fix

## RED

`rtk node skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs` failed after adding the repository reference scan. The first reported stale reference was the old `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs` path, proving that the smoke test detects migrated full-module paths outside `scripts/full/`.

## GREEN

- Updated the executable eval reference in `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs` to `scripts/full/buddy-auto-driver.mjs`.
- Extended `skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs` to scan tracked runtime source, tests/evals, README, current skill documentation, and references for old full internal module paths. The public `scripts/buddy-auto.mjs` entry remains allowed.
- Historical plans, release notes, and memory documents are intentionally outside the scan and were not changed.

## Verification

- PASS: full-entry-smoke
- PASS: five lite tests: entry, selector, claim, status, skill-contract
- PASS: cli-lite-init
- PASS: node syntax checks for both changed eval files
- PASS: npm pack --dry-run (`openspec-buddy-0.26.0.tgz`)
- PASS: git diff --check
- PARTIAL: propose-acceptance-gates now reads the relocated driver successfully, then fails at its pre-existing Auto eval wording assertion (`Auto eval contract must preserve approved seam selection and provider-neutral receipts`). This is unrelated to path resolution and was not changed.

## Files

- `skills/openspec-buddy-auto/evals/full-entry-smoke.test.mjs`
- `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

## Commit

`ce0b92f6618ba11c770651e7f4dda214bfe0e3dc`

## Incremental review fix

### RED

Added an assertion that the active stale-path scan contains both formal eval manifests. The smoke test failed with `skills/openspec-buddy/evals/evals.json must be included in the stale-path scan`, demonstrating that the extension filter excluded JSON manifests.

### GREEN

Added `.json` to the active file extension whitelist. Both `skills/openspec-buddy/evals/evals.json` and `skills/openspec-buddy-auto/evals/evals.json` are now asserted members of the scanned collection. Historical plans, release notes, and memory remain excluded by the existing tracked-path roots.
