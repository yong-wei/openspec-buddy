#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
archive_path="${2:-}"
pr_url=""
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: mark-achieved.sh <issue-number> <archive-path> [pr-url]"
  exit 0
fi
if [[ -z "$issue_number" || -z "$archive_path" ]]; then
  echo "Usage: mark-achieved.sh <issue-number> <archive-path> [pr-url]" >&2
  exit 2
fi
shift 2 || true
post_merge="${OPENSPEC_BUDDY_POST_MERGE:-0}"
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --post-merge)
      echo "--post-merge is internal to mark-achieved-post-merge.sh; call that helper instead." >&2
      exit 2
      ;;
    *)
      if [[ -z "$pr_url" ]]; then
        pr_url="$1"
        shift
      else
        echo "Unknown option: $1" >&2
        exit 2
      fi
      ;;
  esac
done
if [[ "$post_merge" == "1" && -z "$pr_url" ]]; then
  echo "Post-merge achievement requires a PR; call mark-achieved-post-merge.sh <issue-number> <archive-path> <pr-number-or-url>." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir"
if [[ -n "$pr_url" ]]; then
  if [[ "$post_merge" == "1" ]]; then
    "$script_dir/verify-post-merge-achievement-inputs.sh" "$issue_number" "$archive_path" "$pr_url" >/dev/null
    "$script_dir/verify-review-threads-resolved.sh" "$pr_url" --post-merge
  else
    "$script_dir/verify-claim-worktree.sh" --issue "$issue_number" --pr "$pr_url" >/dev/null
    "$script_dir/verify-review-threads-resolved.sh" "$pr_url"
  fi
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
buddy_invalidate_issue_cache "$cache_dir" "$issue_number"
buddy_invalidate_ready_scan_cache "$cache_dir"
if [[ -n "$pr_url" ]]; then
  pr_number="$(node -e 'const value=process.argv[1]; const match=String(value).match(/\/pull\/([0-9]+)/); process.stdout.write(match ? match[1] : value);' "$pr_url")"
  buddy_invalidate_pr_cache "$cache_dir" "$pr_number"
  buddy_signal_publish mark-achieved "issue:$issue_number" "pr:$pr_number" "ready-scan" "project"
else
  buddy_signal_publish mark-achieved "issue:$issue_number" "ready-scan" "project"
fi
