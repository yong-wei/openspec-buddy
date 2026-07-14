# Buddy Claim and Propose Triage Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured truth, duplication, conflict, readiness, and disposition contract to claim/propose without creating a second status system.

**Architecture:** A read-only evidence collector produces bounded repository facts; an agent records judgment in `.buddy/triage.json`; a deterministic validator binds it to issue/update and base-SHA facts. Claim preserves minimal-lock-first ordering, while local propose requires triage before issue creation. Auto consumes only the final disposition.

**Tech Stack:** Node.js ESM, JSON schema-style validation without new dependencies, shell/Node eval fixtures.

## Global Constraints

- Ordinary GitHub issues acquire the minimal verified claim lock before deep triage.
- Local propose performs triage before GitHub issue creation.
- No Matt labels or second status model may be introduced.
- Triage files are evidence-bound local artifacts, not substitutes for GitHub or Git truth.
- Ordinary issues are normalized in place; no mirrored Buddy issue is created.
- Existing prepared changes receive a compatibility/backfill path rather than immediate invalidation.

---

### Task 1: Define triage schema and validator

**Files:**
- Create: `skills/openspec-buddy/scripts/validate-triage.mjs`
- Create: `skills/openspec-buddy/evals/validate-triage.test.mjs`
- Create: `skills/openspec-buddy/references/triage-contract.md`

**Interfaces:**
- Consumes: path to `.buddy/triage.json`, optional expected issue timestamp and base SHA.
- Produces: normalized disposition or field/binding errors.

- [ ] **Step 1: Write failing schema tests**

Cover executable, series-parent, needs-human, close, blocked dependency, missing evidence, stale issue timestamp, stale base SHA, and unknown disposition.

- [ ] **Step 2: Verify red**

`rtk node skills/openspec-buddy/evals/validate-triage.test.mjs`

Expected: FAIL because the validator is absent.

- [ ] **Step 3: Implement validation**

Require:

```json
{
  "subject": {"issue": null, "change_id": ""},
  "truth": {"problem_reproduced": "yes|no|not-applicable", "evidence": []},
  "duplication": {"existing_implementation": "none|partial|complete", "conflicting_specs": [], "active_changes": [], "superseded_by": null},
  "readiness": {"information": "sufficient|insufficient", "disposition": "executable|series-parent|needs-human|blocked|close", "reason": ""},
  "binding": {"issue_updated_at": null, "base_sha": "", "generated_at": ""}
}
```

Do not infer judgment from evidence; only validate completeness, enums, and binding.

- [ ] **Step 4: Verify green**

`rtk node skills/openspec-buddy/evals/validate-triage.test.mjs`

Expected: PASS.

### Task 2: Add bounded evidence collection

**Files:**
- Create: `skills/openspec-buddy/scripts/collect-triage-evidence.mjs`
- Create: `skills/openspec-buddy/evals/collect-triage-evidence.test.mjs`

**Interfaces:**
- Consumes: repository root, change id, optional issue JSON fixture/path.
- Produces: JSON facts for specs, active/archived changes, matching code paths, base SHA, and issue update time.

- [ ] Write fixture-based failing tests proving deterministic ordering, bounded results, and no mutation.
- [ ] Implement filesystem/git fact collection with explicit truncation metadata.
- [ ] Verify collection does not call GitHub itself; live issue truth remains supplied by the claim/propose orchestration layer.
- [ ] Run the focused test.

### Task 3: Integrate claim-first and propose-first ordering

**Files:**
- Modify: `skills/openspec-buddy/scripts/buddy-driver.mjs`
- Modify: `skills/openspec-buddy/scripts/claim-issue.sh`
- Modify: `skills/openspec-buddy/evals/open-issue-claim.test.mjs`
- Modify: `skills/openspec-buddy/evals/buddy-driver.test.mjs`
- Modify: `skills/openspec-buddy-auto/references/selection-rules.md`

- [ ] Add failing tests proving ordinary issue order is minimal lock → truth re-read → triage HANDOFF.
- [ ] Add failing tests proving propose order is triage validation → proposal validation → issue mutation.
- [ ] Implement only orchestration hooks; keep evidence interpretation agent-owned.
- [ ] Map dispositions to existing statuses: executable, tracking children, needs-human, blocked, or explicit close.
- [ ] Ensure Auto consumes disposition only and does not execute research/grilling/prototype.

### Task 4: Compatibility and documentation

**Files:**
- Modify: `skills/openspec-buddy/references/core-lifecycle.md`
- Modify: `skills/openspec-buddy/references/claim-locking.md`
- Modify: `skills/openspec-buddy/references/status-flow.md`
- Modify: `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

- [ ] Document backfill for prepared changes and invalidation when issue `updatedAt` or base SHA changes.
- [ ] State that complete/superseded work closes with evidence and does not create another change.
- [ ] State that insufficient information maps to `status:needs-human`.
- [ ] Run focused documentation and claim tests.

### Task 5: Full verification and review

- [ ] Run:

```bash
rtk node skills/openspec-buddy/evals/validate-triage.test.mjs
rtk node skills/openspec-buddy/evals/collect-triage-evidence.test.mjs
rtk timeout 900 npm test
rtk npm pack --dry-run
rtk git diff --check
```

- [ ] Obtain independent whole-branch review, fix findings, and repeat review.
- [ ] Commit only after clearance; then push and open the PR.
