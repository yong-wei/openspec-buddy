# Buddy Auto Controller State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the agent-facing split between single-lane driver, multi-lane driver, and deterministic helpers with one Buddy Auto controller entrypoint that owns mode selection, persistent interrupts, re-verification, and helper execution.

**Architecture:** Add `buddy-auto.mjs` as the only normal auto entrypoint. It stores controller mode and current interrupts in `openspec/.buddy-cache/auto-controller/<worktree>.json`, delegates deterministic execution to the existing single-lane and lane drivers internally, and converts `HANDOFF` / `BLOCKED` into persistent interrupt records. Existing drivers remain compatibility internals, but skill docs stop exposing them as normal commands.

**Tech Stack:** Node.js ESM scripts, shell helpers, local JSON state under `openspec/.buddy-cache/`, existing `node:test`-style eval scripts, GitHub CLI helpers mocked in tests.

---

## Current Findings

- `skills/openspec-buddy-auto/SKILL.md` declares driver-first behavior but still exposes `buddy-auto-driver.mjs` and `buddy-auto-lane-driver.mjs` as separate normal commands.
- `references/review-waiting.md`, `references/execution-loop.md`, and `references/driver-states.md` show copyable helper commands such as `wait-for-review-clear.sh`, `request-pr-review.sh`, and `review-response-gate.sh`.
- `references/failure-recovery.md` and `skills/openspec-buddy-auto/evals/evals.json` also preserve the old helper-facing behavior, so the documentation and eval truth must be updated together.
- `buddy-auto-driver.mjs` signs stage receipts, but `HANDOFF` and `BLOCKED` are only printed. They are not persisted as interrupt state, so the next agent decides how to resume.
- `review-fix` is partly controlled by the volatile `OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT` environment variable. If a process resumes without that variable, the single-lane driver can skip the required response gate path and enter review waiting.
- `buddy-auto-lane-driver.mjs` persists lane state, but it still emits handoff text instructing the agent to continue through `buddy-auto-driver.mjs` or lane-specific helper behavior.
- Multi-lane review waiting cannot safely use `wait-for-review-clear.sh` directly because that blocks the foreground worktree instead of parking a lane and scheduling another lane.

## Target Contract

Normal Buddy Auto usage exposes exactly one command:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto.mjs
```

First-run seed variables are allowed:

```bash
OPENSPEC_BUDDY_AUTO_GOAL=1 <auto-dir>/scripts/buddy-auto.mjs
OPENSPEC_BUDDY_AUTO_MODE=multi OPENSPEC_BUDDY_AUTO_LANES=2 OPENSPEC_BUDDY_AUTO_GOAL=1 <auto-dir>/scripts/buddy-auto.mjs
OPENSPEC_BUDDY_AUTO_TARGET_ISSUE=123 <auto-dir>/scripts/buddy-auto.mjs
OPENSPEC_BUDDY_AUTO_TARGET_PR=456 <auto-dir>/scripts/buddy-auto.mjs
```

After initialization, the controller state is authoritative for mode, target, lanes, and active interrupt. Environment variables may seed or explicitly override only on a fresh controller state.

If controller state already exists, stale environment values must not rewrite
`mode`, `target`, `goal`, or `maxLanes`. A later run may only change these by an
explicit recovery command implemented by the controller, not by ordinary seed
environment variables.

The only planned recovery command in this change is:

```bash
<auto-dir>/scripts/buddy-auto.mjs --reset-controller-state
```

It may run only when the current git worktree is clean. It deletes the
controller state for the current worktree, but it must not delete lane state,
auto receipts, Git branches, GitHub issue/PR state, or OpenSpec files. After a
reset, the next run may seed a fresh controller state from environment values.

Malformed legacy lane state needs a separate recovery command:

```bash
<auto-dir>/scripts/buddy-auto.mjs --reset-lane-state --reason "<why>"
```

It may run only when the current git worktree is clean and a non-empty reason
is supplied. It must move the current worktree's lane state file to a timestamped
`.bak` file in the same directory, then remove the controller state. It must not
delete Git branches, GitHub issue/PR state, OpenSpec files, or auto receipt
files. The next run starts from fresh controller state and GitHub truth. This is
for malformed or abandoned local lane cache only; it is not a claim release and
must not modify GitHub.

Legacy migration rule:

- If no controller state exists but the current worktree has active lane state
  under `openspec/.buddy-cache/auto-lanes/`, initialize controller mode as
  `multi`, inherit `maxLanes` from that lane state, and call the lane driver.
- Active lane state must use the existing `laneReservesCapacity(lane)` rule
  from `lane-state.mjs`, not a raw `stage !== done` check. Residual lanes that
  do not reserve capacity must not force migration to multi.
- In this migration path, ordinary stale env must not downgrade mode to
  `single` or overwrite existing lanes.
- If legacy lane state is malformed, return `BLOCKED legacy-lane-state` and ask
  the agent to inspect the local cache or run `buddy-auto.mjs --reset-lane-state
  --reason "<why>"` if the local lane cache is abandoned or unrecoverable.
  `--reset-controller-state` must not be advertised as a fix for malformed lane
  state because it intentionally does not delete lane state. Do not silently
  initialize single-lane mode.

`HANDOFF` and `BLOCKED` mean:

- The controller has written an interrupt record.
- The agent may perform only the described external work.
- After external work, the agent must run `buddy-auto.mjs` again.
- The controller re-runs the relevant verifier or failed stage before advancing.

## Files

- Create: `skills/openspec-buddy-auto/scripts/controller-state.mjs`
- Create: `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`
- Create: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/lane-state.mjs`
- Modify: `skills/openspec-buddy-auto/SKILL.md`
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/execution-loop.md`
- Modify: `skills/openspec-buddy-auto/references/failure-recovery.md`
- Modify: `skills/openspec-buddy-auto/references/review-waiting.md`
- Modify: `skills/openspec-buddy-auto/evals/evals.json`
- Create: `docs/release-notes/v0.20.0.md` or the next appropriate release note file
- Modify: `skills/openspec-buddy/SKILL.md` only if needed to align core-vs-auto wording
- Modify: `test/run-all-tests.mjs` to include the new controller eval

## Task 1: Controller State Module

**Files:**
- Create: `skills/openspec-buddy-auto/scripts/controller-state.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] **Step 1: Add failing state tests**

Add tests that create an isolated fake Git repo and assert:

```text
readControllerState() creates empty state with mode unset
initializeControllerState() persists mode single by default
initializeControllerState() persists mode multi and maxLanes from seed env
writeInterrupt() persists type, stage, issue, pr, allowedWork, resumeAction
clearInterrupt() removes the interrupt without losing mode or lanes
```

- [ ] **Step 2: Implement controller state helpers**

Implement:

```javascript
controllerStateDir(cwd)
controllerStatePath(cwd)
readControllerState({ cwd })
writeControllerState(state, { cwd })
initializeControllerState(seed, { cwd })
writeInterrupt(state, interrupt, { cwd })
clearInterrupt(state, { cwd })
```

State shape:

```json
{
  "version": 1,
  "worktree": { "path": "", "alias": "", "pathHash": "", "boundBranch": "", "boundBase": "" },
  "mode": "single",
  "goal": false,
  "maxLanes": 1,
  "target": { "issue": "", "pr": "", "change": "" },
  "reviewFix": { "pending": false, "head": "", "pr": "", "evidence": "" },
  "interrupt": null,
  "updatedAt": ""
}
```

- [ ] **Step 3: Verify state tests**

Run:

```bash
node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
```

Expected: PASS.

## Task 2: Unified Controller Entrypoint

**Files:**
- Create: `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`
- Modify: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] **Step 1: Add failing controller routing tests**

Test with stub single and lane drivers:

```text
default fresh run initializes mode single and invokes buddy-auto-driver.mjs
OPENSPEC_BUDDY_AUTO_MODE=multi initializes mode multi and invokes buddy-auto-lane-driver.mjs
subsequent run without env keeps persisted multi mode
existing multi mode ignores OPENSPEC_BUDDY_AUTO_MODE=single on resume
existing target issue ignores stale OPENSPEC_BUDDY_AUTO_TARGET_PR on resume
existing target PR ignores stale OPENSPEC_BUDDY_AUTO_TARGET_ISSUE on resume
existing goal=false ignores stale OPENSPEC_BUDDY_AUTO_GOAL=1 on resume
existing goal=true ignores stale OPENSPEC_BUDDY_AUTO_GOAL=0 or an unset goal env on resume
existing maxLanes ignores stale OPENSPEC_BUDDY_AUTO_LANES on resume
fresh controller run with active legacy lane state initializes mode multi
fresh controller run with active legacy lane state ignores OPENSPEC_BUDDY_AUTO_MODE=single
fresh controller run with active legacy lane state inherits legacy maxLanes in controller state and child env
fresh controller run with residual non-capacity lane state does not force mode multi
fresh controller run with malformed legacy lane state returns BLOCKED and does not initialize single mode
target issue seed is passed to single driver on first run
goal + lanes seed is passed to lane driver on first run
persisted reviewFix.pending causes single driver child invocation to receive OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT=1
--reset-controller-state refuses when git status is dirty
--reset-controller-state removes only the controller state file and allows a new seed on the next run
--reset-lane-state refuses when git status is dirty
--reset-lane-state refuses without --reason
--reset-lane-state moves only the current worktree lane state file to a .bak file and clears controller state
```

- [ ] **Step 2: Implement `buddy-auto.mjs`**

Behavior:

```text
parse seed env, --help, --reset-controller-state, and --reset-lane-state only
initialize state from active legacy lane state before considering default single mode
initialize state from seed env only when no controller state and no active legacy lane state exists
ignore stale seed env when controller state already exists
if state.mode == multi: call buddy-auto-lane-driver.mjs internally
else: call buddy-auto-driver.mjs internally
parse child status block
persist interrupts on HANDOFF/BLOCKED
clear interrupt on DONE when the stage has advanced or terminal state is reached
print only controller status and the next permitted agent action
```

The controller may use env overrides for internal child calls:

```text
OPENSPEC_BUDDY_AUTO_SINGLE_DRIVER
OPENSPEC_BUDDY_AUTO_LANE_DRIVER
OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR
```

The controller must not implement broad ad hoc mutation options. Any future
recovery command needs its own explicit tests and documentation.

- [ ] **Step 3: Verify routing tests**

Run:

```bash
node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
```

Expected: PASS.

## Task 3: Persistent Interrupt Semantics

**Files:**
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`
- Modify: `skills/openspec-buddy-auto/scripts/buddy-auto-lane-driver.mjs`
- Test: `skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs`

- [ ] **Step 1: Add failing interrupt tests**

Test:

```text
single-driver HANDOFF implement creates interrupt and rerun invokes same driver for verification
single-driver BLOCKED creates interrupt and rerun retries through controller instead of printing helper command
single-driver review-fix HANDOFF persists reviewFix.pending and rerun still forces review-response-gate without requiring env
lane-driver HANDOFF review-fix creates lane interrupt and rerun preserves multi mode
controller output never includes next_command pointing at wait-for-review-clear.sh
controller output never instructs direct buddy-auto-driver.mjs or buddy-auto-lane-driver.mjs use
```

- [ ] **Step 2: Add machine-readable status fields to child drivers**

Keep backward compatibility, but add stable keys:

```text
status: HANDOFF|BLOCKED|DONE
stage: <stage>
agent_action: <human action>
resume_action: rerun-controller
driver_internal: true
```

For child driver output, reduce or suppress agent-facing `command:` and `next_command:` when `OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD=1`.

- [ ] **Step 3: Implement controller interrupt handling**

On child `HANDOFF`:

```json
{
  "type": "handoff",
  "stage": "<stage>",
  "issue": "<issue>",
  "pr": "<pr>",
  "allowedWork": "<agent_action>",
  "resumeAction": "rerun-controller",
  "child": "single|lane"
}
```

If the child stage is `review-fix`, `review-response-gate`, or an actionable-review handoff from the lane driver, also set:

```json
{
  "reviewFix": {
    "pending": true,
    "head": "<head>",
    "pr": "<pr>",
    "evidence": "response-gate-required"
  }
}
```

Clear `reviewFix.pending` only after the child reports a successful `review_response_gate_passed`, `review-yield`, `review_clear`, or equivalent controller-verified current-head review request state.

On child `BLOCKED`:

```json
{
  "type": "blocked",
  "stage": "<stage>",
  "blockedCode": "<stage-or-reason>",
  "allowedWork": "Fix only this blocker, then rerun buddy-auto.mjs.",
  "resumeAction": "rerun-controller",
  "child": "single|lane"
}
```

- [ ] **Step 4: Verify interrupt tests**

Run:

```bash
node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
```

Expected: PASS.

## Task 4: Collapse Agent-Facing Documentation To One Entrypoint

**Files:**
- Modify: `skills/openspec-buddy-auto/SKILL.md`
- Modify: `skills/openspec-buddy-auto/references/driver-states.md`
- Modify: `skills/openspec-buddy-auto/references/execution-loop.md`
- Modify: `skills/openspec-buddy-auto/references/failure-recovery.md`
- Modify: `skills/openspec-buddy-auto/references/review-waiting.md`
- Modify: `skills/openspec-buddy-auto/evals/evals.json`

- [ ] **Step 1: Rewrite `SKILL.md`**

Required outcome:

```text
Only normal command shown is scripts/buddy-auto.mjs.
Mode selection is first-run seed only.
Single-lane and multi-lane drivers are internal compatibility engines.
HANDOFF/BLOCKED are persisted interrupts, not permission to choose helper scripts.
After external work, run buddy-auto.mjs again.
```

- [ ] **Step 2: Rewrite references**

Replace copyable deterministic helper commands with state names and controller-owned internal behavior. Keep helper names only as non-copyable descriptions, for example:

```text
The controller internally uses the review wait helper in single-lane mode.
In multi-lane mode it internally probes lanes and never exposes the blocking wait helper.
```

- [ ] **Step 3: Add documentation regression checks**

Add tests to `buddy-auto-controller.test.mjs` or a small doc eval:

```text
SKILL.md includes buddy-auto.mjs
SKILL.md does not include buddy-auto-driver.mjs as a normal command block
SKILL.md does not include buddy-auto-lane-driver.mjs as a normal command block
review-waiting.md does not include a copyable wait-for-review-clear.sh command block for auto mode
failure-recovery.md does not include copyable direct deterministic helper commands for auto recovery
evals.json expected output describes controller-owned review wait instead of direct wait-for-review-clear.sh
```

## Task 5: Compatibility And Full Regression

**Files:**
- Modify: tests only as required by changed output
- Create: `docs/release-notes/v0.20.0.md` or next appropriate release note file
- Modify: `test/run-all-tests.mjs`

- [ ] **Step 1: Keep existing drivers testable**

Existing `buddy-auto-driver.mjs` and `buddy-auto-lane-driver.mjs` tests should still pass. Update assertions only where output wording intentionally changes under controller-child mode.

- [ ] **Step 2: Add compatibility guards against split-brain execution**

Add or update tests so that:

```text
when lane lock/state indicates multi-lane controller ownership, direct single-lane driver cannot advance the same worktree unless OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD=1
when controller state mode is multi, direct lane driver use remains diagnostic but docs do not expose it as a normal path
legacy child drivers still support --help and focused evals
```

This guard should be conservative. It must not break core `openspec-buddy` helpers or explicit manual recovery, but normal auto-controlled deterministic stages should be controller-owned.

- [ ] **Step 3: Add release note and runner coverage**

Add the controller eval to `test/run-all-tests.mjs` explicitly. Add a release note for the next version describing:

```text
Buddy Auto now has one normal controller entrypoint.
Single-lane and multi-lane mode are persisted in controller state.
HANDOFF/BLOCKED are persistent interrupts.
Review-fix resume no longer depends on preserving OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT.
Auto documentation no longer exposes deterministic helpers as normal entrypoints.
```

- [ ] **Step 4: Run focused evals**

Run:

```bash
node skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs
node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs
node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs
node skills/openspec-buddy-auto/evals/lane-state.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run package and release verification**

Run:

```bash
npm test
npm pack --dry-run
node -e "const pkg=require('./package.json'); const fs=require('fs'); if (!fs.existsSync('docs/release-notes/v' + pkg.version + '.md')) process.exit(1)"
```

Expected: PASS.

## Non-Goals

- Do not rewrite GitHub core helpers.
- Do not remove compatibility scripts.
- Do not change claim, review, merge, archive, or Project semantics.
- Do not introduce hooks in this change.
- Do not require cross-run persistent cache outside `openspec/.buddy-cache/`.

## Acceptance Criteria

- Normal auto skill docs expose one command: `buddy-auto.mjs`.
- First-run mode seeds are persisted; later runs need no mode-specific command.
- Direct helper commands are no longer presented as normal agent actions in auto docs.
- `HANDOFF` and `BLOCKED` persist controller interrupts with allowed work and resume behavior.
- After agent work, rerunning `buddy-auto.mjs` is the only documented resume path.
- Multi-lane mode cannot be accidentally replaced by direct `wait-for-review-clear.sh`.
- Review-fix resume no longer depends on `OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT` being manually preserved.
- Direct single-lane driver execution cannot bypass a live multi-lane controller state in the same worktree.
- Existing single-lane and lane drivers remain usable as controller internals and diagnostic compatibility tools.
- Full tests and `npm pack --dry-run` pass.
- The new controller eval is included in `npm test`.
- The release note for the current package version exists before PR/release.
