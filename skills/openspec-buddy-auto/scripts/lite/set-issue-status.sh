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
if [[ "$existing" != "$target_status" ]]; then
  args=(issue edit "$issue_number")
  if [[ -n "$existing" ]]; then
    args+=(--remove-label "$existing")
  fi
  if [[ ",${existing}," != *",${target_status},"* ]]; then
    args+=(--add-label "$target_status")
  fi
  gh "${args[@]}"
fi

observed="$(read_statuses)"
if [[ "$observed" != "$target_status" ]]; then
  echo "Status verification failed for issue #$issue_number: expected $target_status, observed ${observed:-<none>}." >&2
  exit 1
fi
