# Buddy Testing Seam Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require approved testing seams during proposal design for behavioral and medium/high-risk changes while preserving explicit not-applicable paths.

**Architecture:** A deterministic validator reads the Testing Strategy section in `design.md` and the AC identifiers in `.buddy/issue.md`. Proposal routing invokes it before issue mutation. Apply consumes the approved contract; optional Matt TDD changes method guidance only.

**Tech Stack:** Node.js ESM, Markdown section parsing, Node assertion evals.

## Global Constraints

- Behavioral code changes and medium/high-risk changes require a declared public seam.
- Documentation and mechanical synchronization may use `not-applicable` with an explicit verification method.
- Every AC maps to an automated seam or a justified manual-only check.
- Apply must not ask the user to select a seam already approved during propose.
- Matt TDD is optional; Buddy-native fallback retains red-before-green, public-interface tests, one vertical cycle at a time, and minimal implementation.

---

### Task 1: Implement Testing Strategy validation

**Files:**
- Create: `skills/openspec-buddy/scripts/validate-testing-strategy.mjs`
- Create: `skills/openspec-buddy/evals/validate-testing-strategy.test.mjs`

**Interfaces:**
- Consumes: `<design.md> <issue.md>`.
- Produces: exit 0 plus `Testing strategy valid`, or field/AC-specific errors.

- [ ] **Step 1: Write failing tests**

Cover behavioral/required, medium-risk/required, docs/not-applicable, mechanical/not-applicable, missing public seam, missing AC mapping, justified manual-only AC, and placeholder rejection.

- [ ] **Step 2: Verify red**

`rtk node skills/openspec-buddy/evals/validate-testing-strategy.test.mjs`

Expected: FAIL because the validator is absent.

- [ ] **Step 3: Implement the Markdown parser**

Recognize:

```markdown
## Testing Strategy
Change class: behavioral | high-risk | documentation | mechanical
Seam status: required | not-applicable
Public behavior:
Public seam:
Existing seam reused:
AC coverage:
Manual-only acceptance:
Rationale:
```

Reject blank required fields and `TBD`/`TODO`/“decide during implementation”. Parse all `AC-N` identifiers from the issue body and require coverage.

- [ ] **Step 4: Verify green**

`rtk node skills/openspec-buddy/evals/validate-testing-strategy.test.mjs`

Expected: PASS.

### Task 2: Add propose-time integration

**Files:**
- Modify: `skills/openspec-buddy/scripts/buddy-driver.mjs`
- Modify: `skills/openspec-buddy/evals/buddy-driver.test.mjs`
- Modify: `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

- [ ] Add failing assertions that propose with a change id validates design and issue artifacts.
- [ ] Add the validator command after issue-body/proposal-shape validation.
- [ ] Ensure claim/apply compatibility paths do not newly reject legacy changes solely because the section is absent.
- [ ] Run focused driver and proposal evals.

### Task 3: Document apply behavior and optional TDD provider

**Files:**
- Modify: `skills/openspec-buddy/references/core-lifecycle.md`
- Modify: `skills/openspec-buddy/references/issue-template.md`
- Modify: `skills/openspec-buddy-auto/references/execution-loop.md`
- Modify: `skills/openspec-buddy-auto/evals/evals.json`

- [ ] Add the exact Testing Strategy template and applicability matrix.
- [ ] State that Auto consumes the approved seam and never restarts product-level seam selection.
- [ ] State the Buddy-native TDD fallback and that provider availability never changes receipts or state.
- [ ] Avoid importing Matt's “all refactoring waits for review” rule as a Buddy hard gate.
- [ ] Run relevant documentation and Auto evals.

### Task 4: Full verification and review

- [ ] Run:

```bash
rtk node skills/openspec-buddy/evals/validate-testing-strategy.test.mjs
rtk timeout 900 npm test
rtk npm pack --dry-run
rtk git diff --check
```

- [ ] Obtain independent whole-branch review, fix findings, and repeat review.
- [ ] Commit only after clearance; then push and open the PR.
