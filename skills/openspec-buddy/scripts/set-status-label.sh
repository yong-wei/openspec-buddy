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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/set-project-status.sh" "$issue_number" "$target_status"
