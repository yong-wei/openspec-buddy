#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
target_status="${2:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: set-status-label.sh <issue-number> <status:label>"
  exit 0
fi
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
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"

status_labels_from_issue_json() {
  node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(0, "utf8"));
const labels = Array.isArray(issue.labels) ? issue.labels : [];
process.stdout.write(labels
  .map((label) => typeof label === "string" ? label : label?.name)
  .filter((name) => /^status:\s*/.test(name || ""))
  .map((name) => name.replace(/^status:\s+/, "status:"))
  .join(","));
'
}

verify_status_label() {
  local issue="$1"
  local expected_status="$2"
  local labels_json status_csv
  labels_json="$(gh issue view "$issue" --json labels)"
  status_csv="$(printf '%s\n' "$labels_json" | status_labels_from_issue_json)"
  if [[ "$status_csv" != "$expected_status" ]]; then
    {
      echo "Status label verification failed for issue #$issue."
      echo "Expected exactly: $expected_status"
      echo "Observed: ${status_csv:-<none>}"
    } >&2
    return 1
  fi
}

existing_statuses="$(
  gh issue view "$issue_number" --json labels | status_labels_from_issue_json
)"

args=(issue edit "$issue_number")
if [[ -n "$existing_statuses" ]]; then
  args+=(--remove-label "$existing_statuses")
fi
args+=(--add-label "$target_status")

gh "${args[@]}"
verify_status_label "$issue_number" "$target_status"

cache_dir="$(buddy_cache_dir)"
buddy_invalidate_issue_cache "$cache_dir" "$issue_number"
buddy_invalidate_ready_scan_cache "$cache_dir"

"$script_dir/set-project-status.sh" "$issue_number" "$target_status"

if [[ "${OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH:-0}" != "1" ]]; then
  buddy_signal_publish set-status "issue:$issue_number" "ready-scan" "project"
fi
