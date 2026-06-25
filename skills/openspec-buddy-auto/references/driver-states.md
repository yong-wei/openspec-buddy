# Buddy Auto Driver States

The auto driver is the only entry point for automatic phase progression:

```bash
<openspec-buddy-auto-skill-dir>/scripts/buddy-auto-driver.mjs --issue <issue> --pr <pr>
```

Use `--run-next` only when you want the driver to execute the next legal helper
and write a local receipt.

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
3. `review_clear` exists:
   run merge gates, merge, then call `mark-achieved.sh`.

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
