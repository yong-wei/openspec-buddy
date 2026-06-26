#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
archive_path="${2:-}"
pr_url="${3:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: mark-achieved.sh <issue-number> <archive-path> [pr-url]"
  exit 0
fi
if [[ -z "$issue_number" || -z "$archive_path" ]]; then
  echo "Usage: mark-achieved.sh <issue-number> <archive-path> [pr-url]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir"
if [[ -n "$pr_url" ]]; then
  "$script_dir/verify-claim-worktree.sh" --issue "$issue_number" --pr "$pr_url" >/dev/null
  "$script_dir/verify-review-threads-resolved.sh" "$pr_url"
fi
OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH=1 "$script_dir/set-status-label.sh" "$issue_number" "status:archived"
"$script_dir/set-project-date.sh" "$issue_number" "End" "$(date +%F)"

body="OpenSpec change archived at \`$archive_path\`."
if [[ -n "$pr_url" ]]; then
  body="$body\n\nMerged PR: $pr_url"
fi

state="$(gh issue view "$issue_number" --json state --jq '.state')"
if [[ "$state" == "OPEN" ]]; then
  gh issue close "$issue_number" --comment "$body"
else
  gh issue comment "$issue_number" --body "$body"
fi

"$script_dir/close-completed-series-parent.sh" "$issue_number"
"$script_dir/reconcile-completed-series-parents.sh"
buddy_invalidate_issue_cache "$cache_dir" "$issue_number"
buddy_invalidate_ready_scan_cache "$cache_dir"
if [[ -n "$pr_url" ]]; then
  pr_number="$(node -e 'const value=process.argv[1]; const match=String(value).match(/\/pull\/([0-9]+)/); process.stdout.write(match ? match[1] : value);' "$pr_url")"
  buddy_invalidate_pr_cache "$cache_dir" "$pr_number"
  buddy_signal_publish mark-achieved "issue:$issue_number" "pr:$pr_number" "ready-scan" "project"
else
  buddy_signal_publish mark-achieved "issue:$issue_number" "ready-scan" "project"
fi
