#!/usr/bin/env bash
set -euo pipefail

limit="${1:-100}"
if [[ "$limit" == "--limit" ]]; then
  limit="${2:-100}"
elif [[ "$limit" == "-h" || "$limit" == "--help" ]]; then
  cat >&2 <<'EOF'
Usage: reconcile-completed-series-parents.sh [limit]

Scans open type:series-parent issues and finalizes parents whose children have
all reached the archived terminal state. Repairable child drift is reported as
a failure so automation cannot silently leave parent issues hanging.
EOF
  exit 0
fi

if [[ ! "$limit" =~ ^[0-9]+$ || "$limit" -lt 1 ]]; then
  echo "Limit must be a positive integer." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"

openspec_buddy_require_core_config
repo_nwo="$(buddy_repo_nwo)"

parents_json="$(gh issue list -R "$repo_nwo" --state open --label type:series-parent --limit "$limit" --json number,labels,state,title)"
mapfile -t parent_numbers < <(printf '%s' "$parents_json" | node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(0, "utf8"));
for (const issue of Array.isArray(issues) ? issues : []) {
  const labels = (issue.labels || []).map((entry) => entry.name).filter(Boolean);
  if (issue.state === "OPEN" && labels.includes("type:series-parent") && labels.includes("status:tracking")) {
    process.stdout.write(`${issue.number}\n`);
  }
}
')

if [[ "${#parent_numbers[@]}" -eq 0 ]]; then
  echo "No open tracking series parent issues found."
  exit 0
fi

status=0
for parent_number in "${parent_numbers[@]}"; do
  if ! "$script_dir/close-completed-series-parent.sh" "$parent_number"; then
    status=1
  fi
done

exit "$status"
