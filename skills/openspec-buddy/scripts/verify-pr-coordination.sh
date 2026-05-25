#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
pr_ref="${2:-}"

if [[ -z "$issue_number" || -z "$pr_ref" ]]; then
  echo "Usage: verify-pr-coordination.sh <issue-number> <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

issue_file="$tmp_dir/issue.json"
pr_file="$tmp_dir/pr.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"
labels_file="$tmp_dir/labels.txt"
pr_labels_file="$tmp_dir/pr-labels.txt"

gh issue view "$issue_number" --json number,url,labels,assignees,body,projectItems > "$issue_file"
gh pr view "$pr_ref" --json number,url,body,baseRefName,labels,isDraft,assignees,projectItems,closingIssuesReferences,files,comments > "$pr_file"

node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"
node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file"
node "$script_dir/build-pr-labels.mjs" "$issue_file" "$pr_file" "$labels_file" "$pr_labels_file"

repo_default_branch="$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')"

node "$script_dir/verify-pr-coordination.mjs" \
  "$issue_file" \
  "$pr_file" \
  "$metadata_file" \
  "$labels_file" \
  "$OPENSPEC_BUDDY_BASE_BRANCH" \
  "$OPENSPEC_BUDDY_PROJECT_TITLE" \
  "$OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS" \
  "$OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE" \
  "$repo_default_branch" \
  "${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"

printf 'PR coordination verified for %s from issue #%s.\n' "$pr_ref" "$issue_number"
