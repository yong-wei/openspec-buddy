#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
pr_url="${2:-}"
if [[ -z "$issue_number" || -z "$pr_url" ]]; then
  echo "Usage: mark-review.sh <issue-number> <pr-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/ensure-pr-base.sh" "$pr_url"

if [[ "$(gh pr view "$pr_url" --json isDraft --jq '.isDraft')" == "true" ]]; then
  echo "Buddy PR must be ready for review, not draft: $pr_url" >&2
  exit 1
fi

"$script_dir/configure-pr-metadata.sh" "$issue_number" "$pr_url"
"$script_dir/request-pr-review.sh" "$pr_url"
"$script_dir/verify-pr-coordination.sh" "$issue_number" "$pr_url"
"$script_dir/set-status-label.sh" "$issue_number" "status:in-review"

gh issue comment "$issue_number" --body "PR opened for review: $pr_url"
