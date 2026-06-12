#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
target_status="${2:-}"
if [[ -z "$issue_number" || -z "$target_status" ]]; then
  echo "Usage: set-status-label.sh <issue-number> <status:label>" >&2
  exit 2
fi

if [[ "$target_status" != status:* ]]; then
  echo "Target status label must start with status:." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/github-fetch.sh"

existing_statuses="$(
  gh issue view "$issue_number" --json labels \
    --jq '[.labels[].name | select(test("^status:\\s*"))] | join(",")'
)"

args=(issue edit "$issue_number")
if [[ -n "$existing_statuses" ]]; then
  args+=(--remove-label "$existing_statuses")
fi
args+=(--add-label "$target_status")

gh "${args[@]}"

cache_dir="$(buddy_cache_dir)"
buddy_invalidate_all_relationship_cache "$cache_dir"

"$script_dir/set-project-status.sh" "$issue_number" "$target_status"
