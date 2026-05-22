#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
if [[ -z "$issue_number" ]]; then
  echo "Usage: claim-change.sh <issue-number>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config
tmp_dir="$(mktemp -d)"
created_branch_lock=""

cleanup() {
  if [[ -n "$created_branch_lock" ]]; then
    git push origin ":refs/heads/$created_branch_lock" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"
issues_file="$tmp_dir/issues.json"

gh issue view "$issue_number" --json id,number,title,labels,assignees,body,url > "$issue_file"
node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"
node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file"

change_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.change_id);' "$metadata_file")"
claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
coupling_group="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.coupling_group);' "$metadata_file")"
base_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.base_branch);' "$metadata_file")"

if [[ "$change_id" != "$claim_branch" ]]; then
  echo "claim_branch must equal change_id." >&2
  exit 1
fi

if ! gh issue develop --help >/dev/null 2>&1; then
  echo "gh issue develop is required to create the linked Development branch. Update GitHub CLI before claiming Buddy issues." >&2
  exit 1
fi

if ! node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const labels=issue.labels.map((l)=>l.name); process.exit(labels.includes("status:ready") ? 0 : 1);' "$issue_file"; then
  echo "Issue #$issue_number is not status:ready." >&2
  exit 1
fi

if node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const labels=issue.labels.map((l)=>l.name); process.exit(labels.includes("type:series-parent") ? 0 : 1);' "$issue_file"; then
  echo "Issue #$issue_number is a series parent and cannot be claimed." >&2
  exit 1
fi

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
const blockers = data.data.node.blockedBy.nodes.filter((issue) => {
  const labels = issue.labels.nodes.map((label) => label.name);
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

if command -v openspec >/dev/null 2>&1; then
  openspec list --json > "$tmp_dir/openspec-list.json"
  if ! node -e '
const fs = require("fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const active = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const activeNames = new Set((active.changes || []).map((change) => change.name));
const unfinished = (metadata.depends_on || []).filter((changeId) => activeNames.has(changeId));
if (unfinished.length > 0) {
  process.stderr.write(`depends_on contains active unfinished changes: ${unfinished.join(", ")}\n`);
  process.exit(1);
}
' "$metadata_file" "$tmp_dir/openspec-list.json"; then
    exit 1
  fi
fi

gh issue list --state open --limit 200 --json number,title,labels,body > "$issues_file"
node "$script_dir/find-coupling-conflicts.mjs" "$issues_file" "$issue_number" "$coupling_group" > /dev/null

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

viewer="$(gh api user --jq .login)"
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
EOF
)"

gh issue view "$issue_number" --json labels,assignees > "$tmp_dir/claimed.json"
node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const viewer = process.argv[2];
const labels = issue.labels.map((label) => label.name);
const assignees = issue.assignees.map((assignee) => assignee.login);
if (!labels.includes("status:claimed") || !assignees.includes(viewer)) process.exit(1);
' "$tmp_dir/claimed.json" "$viewer"

created_branch_lock=""
"$script_dir/set-project-date.sh" "$issue_number" "Start" "$(date +%F)"
printf 'Claimed issue #%s for change %s on branch %s with claim %s\n' "$issue_number" "$change_id" "$claim_branch" "$claim_id"
