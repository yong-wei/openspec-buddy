#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: mark-in-progress.sh <issue-number>"
  exit 0
fi
if [[ -z "$issue_number" ]]; then
  echo "Usage: mark-in-progress.sh <issue-number>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verify_claim_helper="${OPENSPEC_BUDDY_VERIFY_CLAIM_WORKTREE_HELPER:-$script_dir/verify-claim-worktree.sh}"
set_status_helper="${OPENSPEC_BUDDY_SET_STATUS_LABEL_HELPER:-$script_dir/set-status-label.sh}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"

gh issue view "$issue_number" --json body,labels > "$issue_file"
node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"
node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file"

claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
"$verify_claim_helper" --issue "$issue_number" --branch "$claim_branch" >/dev/null

if ! node -e '
const fs=require("fs");
const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const labels=(issue.labels || []).map((l)=>String(l.name || l).replace(/^status:\s+/,"status:"));
const statuses=labels.filter((label)=>label.startsWith("status:"));
const allowed=new Set(["status:claimed","status:in-review","status:in-progress"]);
process.exit(statuses.length === 0 || (statuses.length === 1 && allowed.has(statuses[0])) ? 0 : 1);
' "$issue_file"; then
  echo "Issue #$issue_number must have no status label or exactly one of status:claimed, status:in-review, status:in-progress." >&2
  exit 1
fi

"$set_status_helper" "$issue_number" "status:in-progress"

gh issue comment "$issue_number" --body "Implementation started on branch \`$claim_branch\`."
