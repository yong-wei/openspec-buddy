# Task 3 Report

## Implemented

- Added the exact eight-field, single-line Testing Strategy template and its
  validator-aligned enum and AC-map syntax.
- Documented the applicability matrix: behavioral, medium-risk, and high-risk
  changes require a public seam; documentation and mechanical changes may use
  `not-applicable` only with an explicit verification method and rationale.
- Defined public behavior, highest public seam, existing seam reuse, mutually
  exclusive per-AC mappings, and justified manual-only acceptance.
- Required Apply and Buddy Auto to consume the approved seam without restarting
  product-level seam selection.
- Kept Matt TDD optional and method-only, with a Buddy-native fallback of
  red-before-green, public-interface tests, one vertical cycle at a time, and
  minimal implementation.
- Made provider availability neutral to Buddy state, receipts, artifacts, and
  gates, without importing provider-specific refactoring guidance as a Buddy
  lifecycle gate.
- Extended the documentation contract eval and the Auto eval expectation.
- Hardened the Issue template validation fixture to select the fenced Markdown
  body that starts with YAML front matter and contains `change_id`, with
  regression assertions that the preceding Testing Strategy fence is not used
  as the Issue body.
- Synchronized the manual-only contract with the substantive validator rule:
  each entry now records why automation is not applicable, a literal `|`, and
  the manual evidence check; multiple AC entries remain semicolon-separated.
- Required `Rationale` for required seams to substantively explain why the
  selected seam is sufficient for the public behavior and AC coverage.

## TDD Evidence

- Red: `rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`
  failed because the exact Testing Strategy contract was absent.
- Green: the same focused eval passed after the documentation changes.
- Red/green follow-up: the documentation contract eval rejected the stale
  one-segment manual-only template, then passed after the template and guidance
  adopted the two-segment validator syntax.

## Verification

- `rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`: pass
- `rtk node skills/openspec-buddy/evals/propose-issue-body-validation.test.mjs`:
  pass
- Auto `evals.json` parse check: pass
- `rtk git diff --check`: pass
- `rtk npm run test:fast`: pass

## Concerns

None within Task 3. The implementation plan remains untracked and excluded from
the commits.
