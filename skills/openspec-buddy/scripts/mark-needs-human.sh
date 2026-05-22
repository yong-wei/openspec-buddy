#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
reason="${2:-}"
if [[ -z "$issue_number" || -z "$reason" ]]; then
  echo "Usage: mark-needs-human.sh <issue-number> <reason>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/set-status-label.sh" "$issue_number" "status:needs-human"
gh issue comment "$issue_number" --body "OpenSpec Buddy needs human attention: $reason"
