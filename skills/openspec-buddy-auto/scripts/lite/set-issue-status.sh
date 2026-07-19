#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
target="${2:-}"
allowed="ready, claimed, in-progress, in-review, archived"

if [[ ! "$issue_number" =~ ^[1-9][0-9]*$ ]] || [[ ! "$target" =~ ^(ready|claimed|in-progress|in-review|archived)$ ]]; then
  echo "Usage: set-issue-status.sh <issue-number> <$allowed>" >&2
  exit 2
fi

target_status="status:$target"

read_statuses() {
  gh issue view "$issue_number" --json labels | node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(0, "utf8"));
const labels = (issue.labels || []).map((label) => typeof label === "string" ? label : label?.name);
process.stdout.write(labels.filter((name) => String(name || "").startsWith("status:")).join(","));
'
}

existing="$(read_statuses)"
write_errors=""
if [[ "$existing" != "$target_status" ]]; then
  if [[ -n "$existing" ]]; then
    if ! remove_error="$(gh issue edit "$issue_number" --remove-label "$existing" 2>&1)"; then
      write_errors+="remove status labels failed: ${remove_error:-unknown error}"$'\n'
    fi
  fi
  if ! add_error="$(gh issue edit "$issue_number" --add-label "$target_status" 2>&1)"; then
    write_errors+="add target status failed: ${add_error:-unknown error}"$'\n'
  fi
fi

if ! observed="$(read_statuses 2>&1)"; then
  echo -n "$write_errors" >&2
  echo "Final status truth read failed for issue #$issue_number: ${observed:-unknown error}." >&2
  exit 1
fi
if [[ "$observed" != "$target_status" ]]; then
  echo -n "$write_errors" >&2
  echo "Status verification failed for issue #$issue_number: expected $target_status, observed ${observed:-<none>}." >&2
  exit 1
fi
