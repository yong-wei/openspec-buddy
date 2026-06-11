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
repo_nwo="$(buddy_repo_nwo)"

parent_json="$(gh issue view -R "$repo_nwo" "$parent_ref" --json id,number,url)"
child_json="$(gh issue view -R "$repo_nwo" "$child_ref" --json id,number,url)"
parent_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$parent_json")"
child_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$child_json")"
parent_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$parent_json")"
child_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$child_json")"

gh api graphql \
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

printf 'Parent relationship confirmed: #%s -> #%s\n' "$parent_number" "$child_number"
