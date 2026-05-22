#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
archive_path="${2:-}"
pr_url="${3:-}"
if [[ -z "$issue_number" || -z "$archive_path" ]]; then
  echo "Usage: mark-achieved.sh <issue-number> <archive-path> [pr-url]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/set-status-label.sh" "$issue_number" "status:archived"
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
