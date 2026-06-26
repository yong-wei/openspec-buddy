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
- `in_progress`
- `pr_opened`
- `mark_review_passed`
- `review_requested`
- `review_clear`
- `merge_gates_passed`
- `merged`
- `achieved`

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
   merge the PR, archive the local change, then call `mark-achieved.sh`.

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
   continue implementation, independent acceptance review, commit, push, and
   open a ready PR through the Buddy workflow.

The driver may hand off implementation after claim; it must not infer an
unrelated current PR from the worktree while a target issue is active.
