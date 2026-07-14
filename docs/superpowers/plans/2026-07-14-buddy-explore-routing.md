# Buddy Explore Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `explore` phase to manual OpenSpec Buddy with optional Matt-method discovery and a complete native fallback.

**Architecture:** The manual driver owns the phase contract and emits a structured HANDOFF without running configuration or mutation helpers. A focused capability detector reports optional method skills; it never changes whether explore is legal. Buddy Auto remains unchanged.

**Tech Stack:** Node.js ESM, Markdown skill references, Node assertion evals.

## Global Constraints

- Explore performs no Git, GitHub, OpenSpec, or controller-state mutation.
- Explore requires no issue, change id, claim, or `OPENSPEC_BUDDY_*` configuration.
- Matt skills are optional providers; unavailable or detection failure selects `buddy-native` and never blocks.
- Persistent artifacts and transitions must not contain machine-specific Matt installation paths.
- `openspec-buddy-auto` must not gain an explore state.

---

### Task 1: Define the capability detector

**Files:**
- Create: `skills/openspec-buddy/scripts/detect-method-skills.mjs`
- Test: `skills/openspec-buddy/evals/detect-method-skills.test.mjs`

**Interfaces:**
- Consumes: `OPENSPEC_BUDDY_SKILL_ROOTS`, an optional path-delimited test override.
- Produces: JSON `{ grilling, research, prototype }`, each value `"available"` or `"unavailable"`.

- [ ] **Step 1: Write the failing detector tests**

Create temporary skill roots containing selected `SKILL.md` files; assert all-available, partially available, no-root, and unreadable-root results. Run:

`rtk node skills/openspec-buddy/evals/detect-method-skills.test.mjs`

Expected: FAIL because the detector does not exist.

- [ ] **Step 2: Implement the minimal detector**

Search only configured roots plus standard user skill roots. Match capability names, return JSON, suppress filesystem errors, and never print absolute paths.

- [ ] **Step 3: Run the detector tests**

`rtk node skills/openspec-buddy/evals/detect-method-skills.test.mjs`

Expected: PASS.

### Task 2: Add the explore driver contract

**Files:**
- Modify: `skills/openspec-buddy/scripts/buddy-driver.mjs`
- Modify: `skills/openspec-buddy/evals/buddy-driver.test.mjs`

**Interfaces:**
- Consumes: `--mode explore`.
- Produces HANDOFF fields: `mode`, `mutation_allowed`, `coordination_state`, `method_provider`, `recommended_method`, and `next_transition`.

- [ ] **Step 1: Add failing driver assertions**

Assert `--mode explore` exits zero, invokes no config/helper mutation command, and reports:

```text
HANDOFF
mode: explore
mutation_allowed: false
coordination_state: none
next_transition: propose | continue-explore
```

Also assert help lists `explore`.

- [ ] **Step 2: Verify the tests fail**

`rtk node skills/openspec-buddy/evals/buddy-driver.test.mjs`

Expected: FAIL on unsupported mode.

- [ ] **Step 3: Implement explore in the driver**

Extend `inferMode`, `describeNext`, help text, and HANDOFF emission. Call the detector read-only and select `matt` only for recommendations; fall back to `buddy-native`.

- [ ] **Step 4: Verify the driver tests pass**

`rtk node skills/openspec-buddy/evals/buddy-driver.test.mjs`

Expected: PASS.

### Task 3: Document native routing and compatibility

**Files:**
- Modify: `skills/openspec-buddy/SKILL.md`
- Modify: `skills/openspec-buddy/references/core-lifecycle.md`
- Create: `skills/openspec-buddy/references/explore-routing.md`
- Modify: `skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs`

- [ ] **Step 1: Add failing documentation assertions**

Require the intent/facts/solution routing table, the native fallback, read-only constraints, and the explicit Auto exclusion.

- [ ] **Step 2: Write the reference**

Specify: unclear intent → grilling/native one-question clarification; missing facts → research/native primary-source investigation; undecidable interaction/state → prototype/native throwaway experiment; active change design issue → `openspec-explore`.

- [ ] **Step 3: Run focused and full verification**

```bash
rtk node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs
rtk timeout 900 npm test
rtk npm pack --dry-run
```

Expected: all exit 0 and the package includes the new detector and reference.

### Task 4: Review and release readiness

- [ ] Run a fresh independent whole-branch review against `origin/main`.
- [ ] Fix every blocking or important finding and repeat review.
- [ ] Verify `git diff --check`, full tests, and dry-run package.
- [ ] Commit only after review clearance; then push and open the PR.
