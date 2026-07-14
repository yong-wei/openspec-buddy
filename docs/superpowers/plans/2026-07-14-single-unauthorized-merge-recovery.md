# Single-mode Unauthorized Merge Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make controller-owned unauthorized-merge recovery work safely in single mode and make compressed review-wait timing tests tolerate one host-load timeout.

**Architecture:** Extend the single driver's signed receipt state with an explicit violation and recovery chain, then allow post-merge achievement through either that chain or the existing normal merge authorization chain. Keep test timing resilience inside the eval harness with a timeout-only, clean-state, double-budget retry.

**Tech Stack:** Node.js ESM, Bash, `node:assert`, signed local receipt state, GitHub CLI REST mocks.

## Global Constraints

- Recovery must be controller-owned and require a non-empty user authorization reason.
- Recovery must re-read remote PR truth and bind repository, issue, PR, and head.
- Recovery must not synthesize `review_clear`, `merge_authorized`, or `merged` receipts.
- Normal reruns after detection remain blocked until explicit recovery.
- Test retries occur only for exhausted outer wall-clock budgets and at most once.
- A retry uses twice the original timeout and starts with reset scenario state.
- Existing multi-lane recovery behavior must remain compatible.

---

### Task 1: Single-mode recovery receipt chain

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`
- Modify: `skills/openspec-buddy-auto/references/failure-recovery.md`

**Interfaces:**
- Consumes: `OPENSPEC_BUDDY_AUTO_UNAUTHORIZED_MERGE_RECOVERY`, `OPENSPEC_BUDDY_AUTO_RECOVERY_REASON`, `OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD`.
- Produces: signed `unauthorized_merge` and `unauthorized_merge_recovered` stages accepted by the single driver's post-merge authorization predicate.

- [ ] **Step 1: Add failing single-driver tests**

Add cases proving detection writes a signed violation receipt; ordinary reruns
stay blocked; missing reason, direct-child bypass, changed head, and unmerged
remote truth are rejected; valid recovery records the reason and permits
achievement; rerunning after completion is idempotent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`

Expected: failure because single mode ignores the recovery environment and does
not persist `unauthorized_merge`.

- [ ] **Step 3: Implement the minimum signed recovery chain**

Add both stages to the stage whitelist. Persist violation evidence before
blocking. Validate controller-child ownership, reason, signed violation context,
and fresh merged PR truth before recording recovery. Replace the achievement
gate with a predicate accepting either the existing normal chain or the signed
recovery chain.

- [ ] **Step 4: Add and run controller integration coverage**

Run: `node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

Expected: `--recover-unauthorized-merge --reason ...` reaches the single driver,
records recovery, and completes achievement.

- [ ] **Step 5: Update recovery documentation and run focused tests**

Run:

```bash
node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs
node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
```

Expected: all three evals pass.

### Task 2: Load-tolerant review-wait eval budget

**Files:**
- Modify: `skills/openspec-buddy/evals/wait-for-review-clear.test.sh`

**Interfaces:**
- Consumes: the existing timeout-boundary and two-round timeout scenarios.
- Produces: a Bash helper that runs a scenario once with its base outer timeout and, only after outer timeout exhaustion, resets scenario state and retries once with double timeout.

- [ ] **Step 1: Add a failing harness-level test condition**

Arrange the scenario runner so a deliberately exhausted first outer budget is
retried once, while a non-timeout assertion failure is returned immediately.

- [ ] **Step 2: Verify RED**

Run: `bash skills/openspec-buddy/evals/wait-for-review-clear.test.sh`

Expected: failure because the current scenarios have fixed one-shot outer
timeouts.

- [ ] **Step 3: Implement timeout-only doubled-budget retry**

Introduce a small Bash runner/reset pattern local to this eval. Preserve helper
status `124` as an expected business result in the two-round scenario by using
the required diagnostic output to distinguish helper completion from an outer
timeout. Reset counters, captured output, and comment logs before retry.

- [ ] **Step 4: Verify focused and full suites**

Run:

```bash
bash skills/openspec-buddy/evals/wait-for-review-clear.test.sh
npm test
npm pack --dry-run
```

Expected: all commands pass; the package contains no unintended files.

### Task 3: Final audit

**Files:**
- Review all files changed since `origin/main`.

- [ ] **Step 1: Check scope and state invariants**

Confirm no normal authorization receipts are synthesized, recovery is signed and
context-bound, normal reruns stay blocked, and timing retry cannot hide assertion
failures.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
npm pack --dry-run
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Independent review**

Provide the full `origin/main...HEAD` review package to a fresh reviewer. Resolve
all blocking findings and repeat review until explicitly clear.
