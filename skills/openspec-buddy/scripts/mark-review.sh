#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
pr_url="${2:-}"
if [[ -z "$issue_number" || -z "$pr_url" ]]; then
  echo "Usage: mark-review.sh <issue-number> <pr-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
cache_dir="$(buddy_cache_dir)"
export OPENSPEC_BUDDY_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
buddy_signal_apply "$cache_dir"
"$script_dir/ensure-pr-base.sh" "$pr_url"
"$script_dir/verify-claim-worktree.sh" --issue "$issue_number" --pr "$pr_url" >/dev/null

if [[ "$(gh pr view "$pr_url" --json isDraft --jq '.isDraft')" == "true" ]]; then
  echo "Buddy PR must be ready for review, not draft: $pr_url" >&2
  exit 1
fi

OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH=1 "$script_dir/configure-pr-metadata.sh" "$issue_number" "$pr_url"
OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH=1 "$script_dir/request-pr-review.sh" "$pr_url"
"$script_dir/verify-pr-coordination.sh" "$issue_number" "$pr_url"
OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH=1 "$script_dir/set-status-label.sh" "$issue_number" "status:in-review"

gh issue comment "$issue_number" --body "PR opened for review: $pr_url"
pr_number="$(node -e 'const value=process.argv[1]; const match=String(value).match(/\/pull\/([0-9]+)/); process.stdout.write(match ? match[1] : value);' "$pr_url")"
buddy_signal_publish mark-review "issue:$issue_number" "pr:$pr_number" "project"
