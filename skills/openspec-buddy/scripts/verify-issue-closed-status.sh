#!/usr/bin/env bash
set -euo pipefail

repo_args=()
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: verify-issue-closed-status.sh [--repo owner/name] <issue-number> <status:label>"
  exit 0
fi

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --repo|-R)
      repo_args=(-R "${2:-}")
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

issue_number="${1:-}"
target_status="${2:-}"
if [[ -z "$issue_number" || -z "$target_status" ]]; then
  echo "Usage: verify-issue-closed-status.sh [--repo owner/name] <issue-number> <status:label>" >&2
  exit 2
fi
if [[ "$target_status" != status:* ]]; then
  echo "Target status label must start with status:." >&2
  exit 2
fi

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT
gh issue view "${repo_args[@]}" "$issue_number" --json state,labels > "$tmp_file"

node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const issueNumber = process.argv[2];
const expectedStatus = process.argv[3];
const labels = Array.isArray(issue.labels) ? issue.labels : [];
const statusLabels = labels
  .map((label) => typeof label === "string" ? label : label?.name)
  .filter((name) => /^status:\s*/.test(name || ""))
  .map((name) => name.replace(/^status:\s+/, "status:"));
const failures = [];
if (issue.state !== "CLOSED") failures.push(`expected CLOSED, observed ${issue.state || "<none>"}`);
if (statusLabels.length !== 1 || statusLabels[0] !== expectedStatus) {
  failures.push(`expected exactly ${expectedStatus}, observed ${statusLabels.join(",") || "<none>"}`);
}
if (failures.length) {
  process.stderr.write(`Issue close verification failed for issue #${issueNumber}: ${failures.join("; ")}.\n`);
  process.exit(1);
}
' "$tmp_file" "$issue_number" "$target_status"
