#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
if [[ -z "$issue_number" ]]; then
  echo "Usage: mark-in-progress.sh <issue-number>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"

gh issue view "$issue_number" --json body,labels > "$issue_file"
node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"
node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file"

claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
current_branch="$(git branch --show-current)"

if [[ "$current_branch" != "$claim_branch" ]]; then
  echo "Current branch '$current_branch' does not match claim_branch '$claim_branch'." >&2
  exit 1
fi

if ! node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const labels=issue.labels.map((l)=>l.name); process.exit(labels.includes("status:claimed") ? 0 : 1);' "$issue_file"; then
  echo "Issue #$issue_number is not status:claimed." >&2
  exit 1
fi

"$script_dir/set-status-label.sh" "$issue_number" "status:in-progress"

gh issue comment "$issue_number" --body "Implementation started on branch \`$claim_branch\`."
