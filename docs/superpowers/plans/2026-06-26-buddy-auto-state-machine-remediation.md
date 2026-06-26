# Buddy Auto State Machine Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Buddy Auto from a stage hint driver into an executable state machine, and reduce unnecessary GitHub REST and GraphQL calls.

**Architecture:** `buddy-auto-driver.mjs` owns deterministic transitions and calls narrow helpers. Agents receive `HANDOFF` only for implementation, evidence writing, conflict resolution, scope judgment, or human intervention. GitHub remains truth, but helpers must expose lightweight probes before falling back to full REST bundles or GraphQL thread bodies.

**Tech Stack:** Node.js ESM scripts, Bash helpers, GitHub CLI REST/GraphQL, Buddy cache under `openspec/.buddy-cache/`, Node/bash eval tests.
---

## Current Problems

- `OPENSPEC_BUDDY_AUTO_TARGET_ISSUE=<issue>` stays at `implement-or-open-pr` after a PR exists; agents must switch manually to `OPENSPEC_BUDDY_AUTO_TARGET_PR=<pr>`.
- Review-fix has resolve and gate helpers, but no same-thread reply helper, so agents hand-write GraphQL.
- Many shell helpers lack `-h|--help`, so help attempts become misleading positional errors.
- `review-response-gate.sh` can resolve threads, then fail on final transient fetch, leaving state unclear.
- Archive belongs on the bound/base branch after merge, but `mark-achieved.sh` currently verifies claim-branch ownership when a PR is supplied.
- Driver does not detect already-achieved GitHub truth, so it keeps returning `merge-or-achieve` handoff.
- Wait/request paths still call heavy reviewThreads GraphQL at stages where REST or thread-status probes are enough.

## Target Boundary

Driver-owned deterministic operations:

- Goal selection and claim.
- Target issue to exact PR discovery.
- PR metadata, review request, review wait, review gates.
- Review thread reply when a body file is supplied.
- Resolve addressed review threads after evidence exists.
- Post-merge archive truth verification.
- Achievement sync and parent reconciliation.
- Already-achieved truth detection and receipt repair.

Agent-owned handoffs:

- Code implementation and tests.
- Writing review evidence or non-actionable rationale.
- Merge/archive conflict resolution.
- Scope decisions and needs-human cases.
- Local-only no-PR review judgment.

Query rules:

- REST probes first for PR state, head sha, merged state, counts, issue state, labels.
- Full PR REST bundle only for PR coordination, review-clear verification, or final merge gates.
- GraphQL review thread status query only when `isResolved` is enough.
- GraphQL review thread body query only for evidence checks and final merge gates.
- Do not run reviewThreads GraphQL on first review request by default.
- Do not weaken review-fix safety: if the driver lacks proof that no actionable
  Codex thread needs an evidence reply, run the full thread-body gate or stop.

## Files

Driver:

- Modify `skills/openspec-buddy-auto/scripts/buddy-auto-driver.mjs`.
- Modify `skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs`.

Query layer:

- Modify `skills/openspec-buddy/scripts/github-fetch.sh`.
- Add `skills/openspec-buddy/scripts/find-issue-pr.sh`.
- Add `skills/openspec-buddy/scripts/verify-achieved-truth.mjs`.

Review:

- Add `skills/openspec-buddy/scripts/reply-review-thread.sh`.
- Modify `skills/openspec-buddy/scripts/review-response-gate.sh`.
- Modify `skills/openspec-buddy/scripts/review-response-gate.mjs`.
- Modify `skills/openspec-buddy/scripts/request-pr-review.sh`.
- Modify `skills/openspec-buddy/scripts/wait-for-review-clear.sh`.
- Modify `skills/openspec-buddy/scripts/verify-review-clear.sh`.

Achievement:

- Add `skills/openspec-buddy/scripts/mark-achieved-post-merge.sh`.
- Modify `skills/openspec-buddy/scripts/mark-achieved.sh`.
- Modify `skills/openspec-buddy/scripts/verify-claim-worktree.sh` only if a narrow post-merge option is required.

Tests and docs:

- Add evals under `skills/openspec-buddy/evals/`.
- Modify `skills/openspec-buddy-auto/SKILL.md`.
- Modify `skills/openspec-buddy-auto/references/driver-states.md`.
- Modify `skills/openspec-buddy-auto/references/execution-loop.md`.
- Modify `skills/openspec-buddy-auto/references/review-waiting.md`.
- Modify `skills/openspec-buddy-auto/references/failure-recovery.md`.
- Add release notes and update `docs/memory/02-recent-summary.md` when shipping.

## Task 1: Issue Target To PR Bridge

**Acceptance:** A target issue with an exact PR enters PR state automatically. A target issue without an exact PR remains at implementation/open-PR handoff. Ambient PR is ignored.

- [ ] Add driver test: target issue has claimed receipt and exact PR `707`.

Stub output from `find-issue-pr.sh 675`:

```json
{"issue":675,"pr":707,"head":"abc123","state":"OPEN","headRefName":"audit-remediation-arena-publication-context"}
```

Expected output:

```text
DONE
stage: mark-review
state_file: .../pr-707.json
```

- [ ] Add driver test: ambient PR `448` exists but `find-issue-pr.sh` returns no exact PR.

Expected output:

```text
HANDOFF
stage: implement-or-open-pr
```

- [ ] Implement `find-issue-pr.sh <issue-number>`.

Allowed evidence:

- issue metadata `claim_branch`
- active claim comment branch
- PR head branch equals claim branch
- PR body marker `openspec-buddy-origin-issue:<issue>`
- PR body line `Origin issue: #<issue>`

Disallowed evidence:

- current worktree ambient `gh pr view`
- PR whose origin issue marker does not match the issue

- [ ] Modify driver:

```text
if targetIssueLocked and claimed receipt exists:
  exact = find-issue-pr.sh(issue)
  if exact.pr:
    set opts.issue, opts.pr, opts.head
    use pr-<number> state file
  else:
    keep issue context
```

- [ ] Record an `issue_pr_bound` receipt with issue, PR, head, branch, and source helper.

## Task 1A: Driver Continuous Execution Contract

**Acceptance:** The driver runs deterministic commands until `HANDOFF`, `BLOCKED`, or terminal `DONE`; it must not stop after intermediate helpers.

- [ ] Replace `shouldContinue()` with explicit per-stage transition policy.
- [ ] Add tests proving one invocation continues through deterministic chains:

```text
mark-review -> wait-review -> merge-gates
goal-select -> claim-issue -> issue-pr-bridge
```

- [ ] Add tests proving the driver stops only for agent-owned stages:

```text
implement-handoff
merge-pr
local-review
needs-human
```

- [ ] Keep a max-step guard that reports the last stage and state file.

## Task 2: Lightweight Query Layer

**Acceptance:** Phase detection uses narrow probes; full bundles and full GraphQL run only at validation points.

- [ ] Add `buddy_pr_signature_rest <repo> <pr> <cache_dir>`.

Output:

```json
{"number":707,"state":"open","merged":false,"head":"abc123","headRefName":"branch","updatedAt":"timestamp","comments":12,"reviewComments":3,"commits":4}
```

- [ ] Add `buddy_issue_status_rest <repo> <issue> <cache_dir>`.

Output:

```json
{"number":675,"state":"OPEN","labels":["status:archived"],"updatedAt":"timestamp"}
```

- [ ] Add `buddy_review_threads_status_graphql <owner> <repo> <pr> <cache_dir>`.

Output:

```json
{"reviewThreads":[{"id":"RT_1","isResolved":true},{"id":"RT_2","isResolved":false}],"pageInfo":{"hasNextPage":false}}
```

- [ ] Preserve `buddy_review_threads_graphql` as the full body query for evidence checks and final merge gates.
- [ ] Add tests that count calls and fail if request/wait startup invokes full reviewThreads GraphQL without a review-fix need.

## Task 3: Review Thread Reply Helper

**Acceptance:** Agents never need to hand-write `addPullRequestReviewThreadReply`.

- [ ] Add `reply-review-thread.sh <pr> <thread-id> --head <sha> --body-file <file>`.

Behavior:

- `-h|--help` exits 0 and prints `Usage:`.
- missing args exit 2.
- empty or missing body file exits 2.
- thread id must exist in the current PR's fetched reviewThreads set.
- `--head` must equal the current PR head sha from GitHub truth; stale or
  forged head exits nonzero.
- reply body must mention the supplied head sha or include non-actionable rationale plus verification evidence.
- GraphQL mutation verifies returned reply id and thread id.
- prints reply URL or reply id.

- [ ] Add `reply-review-thread.test.sh`.
- [ ] Add tests for stale `--head`, thread id from a different PR, and reply
  plan entries whose `head` does not equal the current PR head.
- [ ] Extend `review-response-gate.sh` with explicit reply mode:

```bash
review-response-gate.sh <pr> --reply-plan <json-file> --head <sha>
```

Reply plan:

```json
{"threads":[{"id":"RT_1","head":"abc123","bodyFile":"/tmp/reply-RT_1.md"}]}
```

- [ ] Keep default gate behavior strict: no silent reply, no silent resolve when evidence is missing.

## Task 4: Review Response Gate Reliability

**Acceptance:** Resolve success and final verification failure are reported separately.

- [ ] Add one retry around final `fetch_threads` for `401`, `EOF`, `timeout`, `502`, `503`, `504`, and `secondary rate`.
- [ ] Print structured final status:

```text
resolved_count: 2
final_verify: passed
```

or:

```text
resolved_count: 2
final_verify: transient-failed
safe_to_rerun: true
```

- [ ] Add tests:

- resolve succeeds and verify succeeds
- resolve succeeds, first final fetch fails, retry succeeds
- resolve succeeds, final fetch fails twice, exits nonzero with `safe_to_rerun: true`

## Task 5: Post-Merge Achievement Executor

**Acceptance:** Achievement can run from the bound branch after merge and is idempotent.

- [ ] Add `mark-achieved-post-merge.sh <issue> <archive-path> <pr>`.

Preconditions:

- `verify-bound-worktree.sh --phase post-merge` passes.
- PR is merged.
- PR origin issue matches issue.
- archive path exists on the configured bound base ref: `buddy.boundBase` when present, otherwise `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
- archived `tasks.md` has all tasks checked.
- review threads are resolved.

Actions:

- set `status:archived`
- set Project `Done`
- set Project `End`
- close or comment issue
- run `close-completed-series-parent.sh`
- run `reconcile-completed-series-parents.sh`
- invalidate issue, PR, relationship, ready-scan, project caches
- publish cache signal

- [ ] Refactor `mark-achieved.sh` so both legacy and post-merge paths share the sync body.
- [ ] Add tests for bound branch success, archive missing, already terminal issue with Project/End repair, parent reconciliation, and legacy claim-branch compatibility.

## Task 6: Driver Achieved Truth And Merge-Or-Achieve Automation

**Acceptance:** `merge-or-achieve` is no longer a generic manual bucket.

- [ ] Add driver test: PR merged, archive present, issue already archived.

Expected:

```text
DONE
stage: achieved
```

- [ ] Add driver test: PR merged, archive present, issue not archived.

Expected:

```text
DONE
stage: mark-achieved-post-merge
next_stage: achieved
```

- [ ] Add driver test: PR not merged.

Expected:

```text
HANDOFF
stage: merge-pr
```

- [ ] Add `verify-achieved-truth.mjs`.

Output examples:

```json
{"achieved":true,"reason":"issue closed, status archived, Project Done, End set, PR merged, archive present, parents reconciled"}
```

```json
{"achieved":false,"next":"mark-achieved-post-merge","reason":"issue not archived"}
```

- [ ] Modify driver:

```text
if achieved truth true:
  record achieved
  DONE achieved
else if PR merged and archive present:
  run mark-achieved-post-merge
  record achieved
else if PR not merged:
  HANDOFF merge-pr
else:
  BLOCKED with exact missing condition
```

Achieved truth must require all terminal invariants:

- issue is closed
- issue has exactly one `status:*` label and it is `status:archived`
- Project Status is `Done`
- Project `End` is set
- PR is merged
- archive path exists on the configured bound base ref
- archived `tasks.md` is complete
- review threads are resolved
- completed series parent is closed/archived or reconciliation has just run

If any invariant except PR merged or archive presence is missing, the driver
must run `mark-achieved-post-merge.sh` instead of writing an `achieved` receipt.

## Task 7: Review Wait And Request Query Reduction

**Acceptance:** First review request and wait startup do not always call heavy GraphQL.

- [ ] Modify `request-pr-review.sh` to run `verify-review-threads-resolved.sh` only when one of these is true:

- `OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT=1`
- caller passes `--require-threads-resolved`
- driver receipt indicates review-fix was handled
- no signed receipt proves the current head has no unresolved actionable Codex threads after the last review-fix attempt

- [ ] Modify `wait-for-review-clear.sh`:

- verify current-head request with REST
- use `buddy_pr_signature_rest`
- skip full `verify-review-clear.sh` unless signature changes, final boundary is reached, or a review-fix receipt exists
- do not call full reviewThreads GraphQL at startup by default

Safety rule: skipping full thread-body GraphQL at startup is valid only when no
review-fix receipt exists and lightweight thread-status has no unresolved
threads. If lightweight status reports unresolved threads, run the full evidence
gate before waiting.

- [ ] Modify `verify-review-clear.sh` to accept pre-fetched files:

```bash
verify-review-clear.sh <pr> --pr-file <file> --reviews-file <file> --threads-file <file>
```

No supplied files preserves current behavior.

- [ ] Add call-count tests:

- first request: no reviewThreads GraphQL
- wait startup: no full PR bundle after current-head request exists
- unchanged signature polling: only PR signature REST
- changed signature: full REST bundle and full reviewThreads GraphQL
- final merge gate: full verification still runs

## Task 8: Standard Help For Shell Helpers

**Acceptance:** High-frequency helpers support `-h|--help` and exit 0.

- [ ] Update helpers: `claim-issue.sh`, `claim-change.sh`, `mark-review.sh`,
  `request-pr-review.sh`, `wait-for-review-clear.sh`, `verify-review-clear.sh`,
  `review-response-gate.sh`, `resolve-review-thread.sh`,
  `reply-review-thread.sh`, `mark-achieved.sh`,
  `mark-achieved-post-merge.sh`, `configure-pr-metadata.sh`,
  `verify-claim-worktree.sh`, `verify-bound-worktree.sh`,
  `set-project-status.sh`, `set-project-date.sh`,
  `verify-pr-coordination.sh`, `verify-current-head-review-request.sh`,
  `verify-review-threads-resolved.sh`, `set-status-label.sh`,
  `mark-in-progress.sh`, `mark-failed.sh`, `mark-needs-human.sh`.

- [ ] Add `helper-help.test.sh`:

```bash
for helper in ...; do
  "$helper" --help >/tmp/out
  test "$?" = 0
  grep -q '^Usage:' /tmp/out
done
```

## Task 9: Documentation And Skill Simplification

**Acceptance:** Docs describe the executable state machine and do not invite manual substitutes.

- [ ] Keep `SKILL.md` short: driver command, target env, goal env, silence rule, no manual substitutes.
- [ ] Update `driver-states.md` with this state graph:

```text
goal-select -> claim-issue -> implement-handoff -> issue-pr-bridge -> mark-review -> wait-review -> merge-gates -> merge-pr-handoff -> post-merge-achieve -> achieved
```

- [ ] Update `execution-loop.md`: archive commit belongs on bound/base branch after merge; claim branch is not required for post-merge achievement; bound base means `buddy.boundBase` when configured, otherwise `origin/$OPENSPEC_BUDDY_BASE_BRANCH`.
- [ ] Update `review-waiting.md`: reply helper is mandatory for same-thread replies; resolve gate is not a current-head clean review.
- [ ] Update `failure-recovery.md`: post-merge archive or achieved truth drift is repaired by post-merge helper, not manual claim-branch switching.

## Regression Matrix

Driver:

- target issue no PR -> `implement-or-open-pr`
- target issue exact PR open -> PR state machine
- target issue exact PR merged + achieved truth -> `DONE achieved`
- target issue exact PR merged + not archived -> post-merge achieve
- target issue unrelated ambient PR -> ignored
- goal selected issue -> claim
- goal local-only -> local review handoff

Review: first request does not call reviewThreads GraphQL; review-fix request
requires thread resolution; reply-review-thread sends expected thread id/body;
final transient fetch is rerunnable; unchanged wait uses lightweight signature;
changed wait triggers full verification.

Achievement: post-merge helper runs from bound branch; legacy helper still
protects claim branch before merge; already archived issue is idempotent only
when Project Done, End date, closed state, archive path, review threads, and
parent reconciliation are terminal; archive missing on origin/base blocks.

Help:

- listed helpers support `--help` exit 0
- missing positional args still exit 2

## Rollout

- [ ] Implement in an isolated worktree.
- [ ] Commit by task group.
- [ ] Run focused eval after each task.
- [ ] Run final verification:

```bash
rtk npm test
rtk npm pack --dry-run
```

- [ ] Use high-reasoning subagent review before merge.
- [ ] Merge to `main`, push, remove development worktree, align local `main`.
- [ ] Publish npm and GitHub Release as the next minor version.

## Implementation Order

1. Driver continuous execution contract.
2. Issue target to PR bridge.
3. Post-merge achievement executor.
4. Driver achieved truth and merge-or-achieve automation.
5. Review thread reply helper and gate reliability.
6. Lightweight query layer and review wait/request reduction.
7. Standard helper `--help`.
8. Documentation cleanup and release.
