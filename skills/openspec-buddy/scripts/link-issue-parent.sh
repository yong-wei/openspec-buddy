#!/usr/bin/env bash
set -euo pipefail

parent_ref="${1:-}"
child_ref="${2:-}"
replace_parent="${3:-false}"

if [[ -z "$parent_ref" || -z "$child_ref" ]]; then
  echo "Usage: link-issue-parent.sh <parent-issue-number-or-url> <child-issue-number-or-url> [replace-parent:true|false]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir" "$repo_nwo"

parent_json="$(gh issue view -R "$repo_nwo" "$parent_ref" --json id,number,url)"
child_json="$(gh issue view -R "$repo_nwo" "$child_ref" --json id,number,url)"
parent_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$parent_json")"
child_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$child_json")"
parent_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$parent_json")"
child_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$child_json")"
old_parent_number=""

if [[ "$replace_parent" == "true" ]]; then
  owner="${repo_nwo%%/*}"
  repo_name="${repo_nwo#*/}"
  old_parent_number="$(buddy_issue_relationships_graphql "$owner" "$repo_name" "$child_number" | node -e '
const fs = require("node:fs");
const relationships = JSON.parse(fs.readFileSync(0, "utf8"));
const issue = Array.isArray(relationships) ? relationships[0] : null;
process.stdout.write(issue?.parent?.number ? String(issue.parent.number) : "");
')"
fi

buddy_graphql_api \
  -f query='
mutation($parent: ID!, $child: ID!, $replaceParent: Boolean!) {
  addSubIssue(input: {issueId: $parent, subIssueId: $child, replaceParent: $replaceParent}) {
    issue { number url }
    subIssue { number url }
  }
}' \
  -f parent="$parent_id" \
  -f child="$child_id" \
  -F replaceParent="$replace_parent" \
  --jq '.data.addSubIssue | "Linked issue #\(.subIssue.number) to parent #\(.issue.number)."'

buddy_invalidate_issue_relationship_cache "$cache_dir" "$old_parent_number" "$parent_number" "$child_number"
buddy_invalidate_ready_scan_cache "$cache_dir"
buddy_signal_publish link-parent "relationship:issue:$parent_number" "relationship:issue:$child_number" "${old_parent_number:+relationship:issue:$old_parent_number}" "ready-scan"

printf 'Parent relationship confirmed: #%s -> #%s\n' "$parent_number" "$child_number"
