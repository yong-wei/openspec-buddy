#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
created_branch_lock=""
viewer="$(gh api user --jq .login)"

cleanup() {
  if [[ -n "$created_branch_lock" ]]; then
    git push origin ":refs/heads/$created_branch_lock" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

if [[ -z "$issue_number" ]]; then
  gh issue list \
    --state open \
    --limit "${OPENSPEC_BUDDY_CLAIM_ISSUE_LIMIT:-200}" \
    --json number,title,labels,assignees,url,state,body > "$tmp_dir/issues.json"

  node -e '
const fs = require("fs");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(JSON.stringify({ viewer: process.argv[2], issues }));
' "$tmp_dir/issues.json" "$viewer" | node "$script_dir/select-claim-issue.mjs" > "$tmp_dir/selection.json"
  issue_number="$(
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(data.selected?.number ? String(data.selected.number) : "");
' "$tmp_dir/selection.json"
  )"

  if [[ -z "$issue_number" ]]; then
    cat "$tmp_dir/selection.json" >&2
    exit 1
  fi
fi

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"

gh issue view "$issue_number" --json id,number,title,labels,assignees,body,url,state > "$issue_file"
issue_number="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(issue.number));' "$issue_file")"
node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"

if node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file" 2> "$tmp_dir/parse-error.txt"; then
  "$script_dir/claim-change.sh" "$issue_number"
  exit 0
fi

if node -e '
const fs = require("fs");
const body = fs.readFileSync(process.argv[1], "utf8");
process.exit(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body) || /<!--\s*openspec-buddy\s*\r?\n/.test(body) ? 0 : 1);
' "$body_file"; then
  echo "Issue #$issue_number already contains OpenSpec Buddy metadata, but it is invalid:" >&2
  cat "$tmp_dir/parse-error.txt" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(JSON.stringify({ viewer: process.argv[2], issues: [issue] }));
' "$issue_file" "$viewer" | node "$script_dir/select-claim-issue.mjs" > "$tmp_dir/single-selection.json"

if ! node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(data.selected ? 0 : 1);
' "$tmp_dir/single-selection.json"; then
  cat "$tmp_dir/single-selection.json" >&2
  exit 1
fi

if ! gh issue develop --help >/dev/null 2>&1; then
  echo "gh issue develop is required to create the linked Development branch. Update GitHub CLI before claiming Buddy issues." >&2
  exit 1
fi

node "$script_dir/build-open-issue-metadata.mjs" "$issue_file" > "$tmp_dir/adoption.json"
node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(data.updatedBody);
' "$tmp_dir/adoption.json" > "$tmp_dir/adopted-body.md"
node "$script_dir/parse-issue-metadata.mjs" "$tmp_dir/adopted-body.md" > "$metadata_file"

change_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.change_id);' "$metadata_file")"
claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
coupling_group="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.coupling_group);' "$metadata_file")"
base_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.base_branch);' "$metadata_file")"

issue_id="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.id);' "$issue_file")"
blocked_by_file="$tmp_dir/blocked-by.json"
gh api graphql \
  -f query='
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      blockedBy(first: 40) {
        nodes { number title state labels(first: 40) { nodes { name } } }
      }
    }
  }
}' \
  -f id="$issue_id" > "$blocked_by_file"

if ! node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
function normalizedLabels(issue) {
  return issue.labels.nodes.map((label) => label.name.replace(/^status:\s+/, "status:"));
}
const blockers = data.data.node.blockedBy.nodes.filter((issue) => {
  const labels = normalizedLabels(issue);
  return issue.state !== "CLOSED" && !labels.includes("status:archived") && !labels.includes("status:merged");
});
if (blockers.length > 0) {
  process.stderr.write(JSON.stringify(blockers.map((issue) => ({ number: issue.number, title: issue.title })), null, 2));
  process.stderr.write("\n");
  process.exit(1);
}
' "$blocked_by_file"; then
  echo "Issue #$issue_number still has open blockedBy relationships." >&2
  exit 1
fi

gh issue list --state open --limit 200 --json number,title,labels,body > "$tmp_dir/issues-for-coupling.json"
node "$script_dir/find-coupling-conflicts.mjs" "$tmp_dir/issues-for-coupling.json" "$issue_number" "$coupling_group" > /dev/null

git fetch origin "$base_branch" >/dev/null
base_sha="$(git rev-parse "origin/$base_branch")"
if git ls-remote --exit-code --heads origin "$claim_branch" >/dev/null 2>&1; then
  echo "Remote claim branch already exists: $claim_branch" >&2
  exit 1
fi
gh issue develop "$issue_number" --name "$claim_branch" --base "$base_branch" >/dev/null
created_branch_lock="$claim_branch"
if ! git ls-remote --exit-code --heads origin "$claim_branch" >/dev/null 2>&1; then
  echo "gh issue develop did not create remote branch: $claim_branch" >&2
  exit 1
fi
linked_branches="$(gh issue develop --list "$issue_number" 2>/dev/null || true)"
if [[ "$linked_branches" != *"$claim_branch"* ]]; then
  echo "gh issue develop created $claim_branch, but the issue Development branch list did not show it." >&2
  exit 1
fi

gh issue edit "$issue_number" --body-file "$tmp_dir/adopted-body.md"

claim_id="$(uuidgen 2>/dev/null || node -e 'console.log(crypto.randomUUID())')"
lease_until="$(node -e 'const hours=Number(process.env.OPENSPEC_BUDDY_CLAIM_TTL_HOURS); console.log(new Date(Date.now()+hours*3600*1000).toISOString())')"

gh issue edit "$issue_number" --add-assignee "$viewer"
"$script_dir/set-status-label.sh" "$issue_number" "status:claimed"

gh issue comment "$issue_number" --body "$(cat <<EOF
OpenSpec Buddy Claim

claim_id: $claim_id
agent: @$viewer
change_id: $change_id
branch: $claim_branch
base_branch: $base_branch
base_sha: $base_sha
lease_until: $lease_until
adopted_from_open_issue: true
EOF
)"

gh issue view "$issue_number" --json labels,assignees,body > "$tmp_dir/claimed.json"
node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const viewer = process.argv[2];
const labels = issue.labels.map((label) => label.name.replace(/^status:\s+/, "status:"));
const assignees = issue.assignees.map((assignee) => assignee.login);
if (!labels.includes("status:claimed") || !assignees.includes(viewer)) process.exit(1);
if (!/<!--\s*openspec-buddy\s*\r?\n/.test(issue.body || "")) process.exit(2);
' "$tmp_dir/claimed.json" "$viewer"

created_branch_lock=""
"$script_dir/set-project-date.sh" "$issue_number" "Start" "$(date +%F)"
printf 'Claimed open issue #%s for change %s on branch %s with claim %s\n' "$issue_number" "$change_id" "$claim_branch" "$claim_id"
