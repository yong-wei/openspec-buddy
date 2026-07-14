# Single-mode Unauthorized Merge Recovery Design

## Problem

`buddy-auto.mjs --recover-unauthorized-merge --reason <reason>` is advertised as
a controller command. The controller forwards recovery intent to either child
driver, but only the multi-lane driver consumes it. The single-mode driver can
detect an unauthorized merge, yet cannot persist or recover that condition.

The full test suite also compresses production review waits into one- and
two-second windows. Under host load, the outer test timeout can expire before
the helper completes its required boundary checks, producing an unrelated
baseline failure.

## Recovery State and Authorization

Single-mode receipt state gains two signed stages:

- `unauthorized_merge` records the remote merged truth and the missing normal
  authorization chain.
- `unauthorized_merge_recovered` records explicit controller-owned recovery,
  including the non-empty user reason and a binding to the violation receipt.

Detection persists the violation before returning `BLOCKED`. Normal reruns
remain blocked. Recovery is accepted only in controller-child mode, with a
non-empty reason, matching signed violation receipt, and freshly fetched remote
truth proving the same repository, PR, issue, and head are merged.

Achievement work is authorized by either a valid normal chain
(`review_clear -> merge_authorized -> merged`) or a valid recovery chain
(`unauthorized_merge -> unauthorized_merge_recovered`). Recovery never creates
synthetic normal merge receipts.

## Test Time Budget Retry

Time-sensitive scenarios in `wait-for-review-clear.test.sh` receive one retry
only when the first attempt exhausts its outer wall-clock budget. The retry uses
twice the original outer timeout and resets all scenario counters, output files,
and comment logs first. Assertion failures and unexpected helper exit codes do
not trigger a retry.

The timeout-boundary clean-review scenario must still run its final verifier and
must not request a retry review. The two-round timeout scenario must still return
the helper's own status `124`, include `after 2 wait rounds`, and issue exactly
one contextual retry request.

## Verification

- Single-driver evals cover persistence, ordinary rerun blocking, invalid
  recovery attempts, successful recovery, and idempotent completion.
- Controller evals prove the public CLI reaches single-mode recovery.
- Multi-lane recovery tests remain unchanged and passing.
- The review-wait eval passes under normal timing and its doubled-budget retry.
- `npm test` and `npm pack --dry-run` pass before review.
