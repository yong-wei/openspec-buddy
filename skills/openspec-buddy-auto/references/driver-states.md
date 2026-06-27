# Buddy Auto Driver States

The auto driver is the only entry point for automatic phase progression:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs
```

Normal selection/continuation uses no arguments. When the user specifies a
target, seed the target with `OPENSPEC_BUDDY_AUTO_TARGET_ISSUE` or
`OPENSPEC_BUDDY_AUTO_TARGET_PR` before running the same driver.

Target rules:

- A target issue is authoritative. The driver must not replace it with an
  ambient PR from the current worktree.
- A target PR is authoritative. The driver may infer its origin issue and head
  only by reading that target PR.
- If no concrete context is available, the driver must return `HANDOFF` and
  must not claim new work or mutate GitHub state.
- If goal mode is explicitly authorized with `OPENSPEC_BUDDY_AUTO_GOAL=1` or
  `--goal`, an empty context may run the selector, choose the smallest
  executable issue-backed candidate, and claim it through the same driver.

Options such as `--dry-run`, `--issue`, `--pr`, `--change`, and `--no-pr` are
diagnostic or recovery controls only.

## Multi-Lane State

Multi-lane scheduling is opt-in through:

```bash
OPENSPEC_BUDDY_AUTO_GOAL=1 OPENSPEC_BUDDY_AUTO_LANES=2 <openspec-buddy-auto-skill-dir>/scripts/buddy-auto-lane-driver.mjs
```

The lane driver stores scheduler state under:

```text
openspec/.buddy-cache/auto-lanes/
```

Lane state is local scheduling evidence, not GitHub truth. The lane driver must
still use GitHub helpers for claim ownership, PR head, review request, review
clearance, merge, Project, and achievement decisions.

Allowed lane stages:

```text
implementing
waiting_review
review_fix
merge_ready
done
blocked
retryable_blocked
```

The lane driver holds an exclusive per-worktree lock while it runs. A second
lane driver in the same worktree must stop with
`BLOCKED lane-driver-already-running`. Do not run the legacy single-lane driver
manually in the same worktree while a lane driver is active; the lane lock does
not protect against that manual bypass.

Default lane concurrency is `2`; the hard maximum is `3`. A lane can be parked
only after commit, push, current-head review request, clean worktree, matching
PR head, and claim-worktree guard all pass.

Blocked lanes that still own an issue, PR, branch, or claim id reserve capacity.
They are not empty slots. A transient GitHub failure such as EOF, rate limit,
timeout, or 5xx enters `retryable_blocked`; the next lane driver run must first
reconcile that lane from GitHub truth before selecting another issue.

Recovery controls:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-lane-driver.mjs --reconcile
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-lane-driver.mjs --release-lane <issue-number> --reason "<why>"
```

Use `--reconcile` when local lane state may lag GitHub truth. Use
`--release-lane` only for a confirmed erroneous claim; it calls
`release-claim.sh`, restores `status:ready`, and clears matching local lane
state. Do not hand-edit `openspec/.buddy-cache/auto-lanes/*.json` during normal
operation.

## Receipts

Receipts are stored under:

```text
openspec/.buddy-cache/auto-state/
```

Override with `OPENSPEC_BUDDY_AUTO_STATE_DIR` in tests or special local runs.
Receipts are local state-machine evidence, not GitHub truth. They only prove
that the local agent passed a Buddy helper at a given phase. The driver signs
receipts with a local secret under the state directory and ignores unsigned or
tampered receipts. The helpers still read GitHub truth for claim, PR, review,
Project, and merge state.

Known receipt stages:

- `claimed`
- `issue_pr_bound`
- `in_progress`
- `pr_opened`
- `mark_review_passed`
- `review_requested`
- `review_clear`
- `merge_gates_passed`
- `post_merge_achieved`
- `merged`
- `achieved`

The driver is an executor, not a stage hint printer. A successful deterministic
helper must immediately advance to the next deterministic helper until the
state reaches `HANDOFF`, `BLOCKED`, or terminal `DONE`. The normal graph is:

```text
goal-select -> claim-issue -> issue-pr-bridge -> implement-handoff
issue-pr-bridge -> mark-review -> wait-review -> merge-gates -> achieved-truth
achieved-truth -> merge-pr-handoff
achieved-truth -> post-merge-achieve -> achieved
achieved-truth -> achieved
```

## Review Progression

For a GitHub-backed PR:

1. No `mark_review_passed` receipt:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-review.sh <issue> <pr>
   ```
2. `mark_review_passed` exists but `review_clear` does not:
   ```bash
   <openspec-buddy-skill-dir>/scripts/wait-for-review-clear.sh <pr>
   ```
3. `review_clear` exists but `merge_gates_passed` does not:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-review-clear.sh <pr>
   ```
4. `merge_gates_passed` exists:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-achieved-truth.mjs <issue> <pr>
   ```
   If the PR is not merged, the driver returns `HANDOFF merge-pr`. If the PR
   is merged and the archive exists on the configured bound base, the driver
   runs `mark-achieved-post-merge.sh`. If all terminal issue, Project, archive,
   review, and parent invariants are already satisfied, it records `achieved`.

Do not manually use `sleep`, `gh pr view`, `gh api`, or text inspection to move
between these states. If a manual observation contradicts the driver, rerun the
driver or the underlying verifier and fix the blocking state.

## Review-Fix Follow-Up

After a review-fix commit:

1. Reply in the same review thread with fix commit or non-actionable rationale
   and verification evidence.
2. Run `review-response-gate.sh`.
3. Request a current-head review with `request-pr-review.sh --context-file`.
4. Return to the auto driver for review waiting.

Resolved old threads are not a clean current-head review.

## Claim Progression

For an authorized goal loop with no current issue or PR:

1. Run the bound-worktree gate:
   ```bash
   <openspec-buddy-skill-dir>/scripts/verify-bound-worktree.sh --phase goal-loop-start
   ```
2. Recalculate selection:
   ```bash
   <openspec-buddy-skill-dir>/scripts/select-next-change.sh
   ```
3. If an issue-backed candidate is selected, treat that issue as the next
   context and continue to claim progression below.
4. If a local-only `--no-issue` change is selected, enter the local-only review
   handoff; do not claim or create GitHub state.
5. If no candidate is selected, return `DONE no-available-changes`.

Without explicit goal authorization, an empty context is `HANDOFF
no-goal-context`; it must not run selection or claim.

For a target issue without a PR:

1. No `claimed` receipt:
   ```bash
   <openspec-buddy-skill-dir>/scripts/claim-issue.sh <issue>
   ```
2. `claimed` exists:
   ```bash
   <openspec-buddy-skill-dir>/scripts/find-issue-pr.sh <issue>
   ```
   If an exact issue-bound PR is found from claim branch and PR body evidence,
   switch to the PR state machine. If no exact PR exists, hand off
   implementation and PR opening. Ambient current PRs are ignored.

The driver may hand off implementation after claim; it must not infer an
unrelated current PR from the worktree while a target issue is active.
