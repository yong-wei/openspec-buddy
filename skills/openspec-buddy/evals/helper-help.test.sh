#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../scripts" && pwd)"

helpers=(
  claim-issue.sh
  claim-change.sh
  mark-review.sh
  request-pr-review.sh
  probe-review-state.sh
  check-review-clear-once.sh
  wait-for-review-clear.sh
  verify-review-clear.sh
  review-response-gate.sh
  resolve-review-thread.sh
  reply-review-thread.sh
  release-claim.sh
  mark-achieved.sh
  mark-achieved-post-merge.sh
  verify-post-merge-achievement-inputs.sh
  configure-pr-metadata.sh
  verify-claim-worktree.sh
  verify-bound-worktree.sh
  set-project-status.sh
  set-project-date.sh
  verify-pr-coordination.sh
  verify-current-head-review-request.sh
  verify-review-threads-resolved.sh
  set-status-label.sh
  mark-in-progress.sh
  mark-failed.sh
  mark-needs-human.sh
)

for helper in "${helpers[@]}"; do
  output="$("$script_dir/$helper" --help)"
  if [[ "$output" != Usage:* ]]; then
    echo "$helper --help did not print Usage:" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
done

echo "helper help tests passed"
