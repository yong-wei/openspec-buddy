#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
cache_dir="$(buddy_cache_dir)"
repo_nwo="$(buddy_repo_nwo)"
buddy_signal_apply "$cache_dir" "$repo_nwo"

if [[ "$#" -lt 2 || $(( $# % 2 )) -ne 0 ]]; then
  echo "Usage: link-issue-dependencies.sh <blocked-issue> <blocking-issue> [<blocked-issue> <blocking-issue> ...]" >&2
  echo "Example: A depends on B => link-issue-dependencies.sh <A> <B>" >&2
  exit 2
fi

pair_count=$(( $# / 2 ))
buddy_graphql_guard_for_calls "$pair_count"

while [[ "$#" -gt 0 ]]; do
  blocked_ref="$1"
  blocking_ref="$2"
  shift 2

  blocked_json="$(gh issue view "$blocked_ref" --json id,number,url)"
  blocking_json="$(gh issue view "$blocking_ref" --json id,number,url)"
  blocked_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$blocked_json")"
  blocking_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$blocking_json")"
  blocked_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$blocked_json")"
  blocking_number="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(String(data.number));' "$blocking_json")"

  buddy_graphql_api \
    -f query='
mutation($issue: ID!, $blockingIssue: ID!) {
  addBlockedBy(input: {issueId: $issue, blockingIssueId: $blockingIssue}) {
    issue { number url }
    blockingIssue { number url }
  }
}' \
    -f issue="$blocked_id" \
    -f blockingIssue="$blocking_id" \
    --jq '.data.addBlockedBy | "Linked issue #\(.issue.number) as blocked by #\(.blockingIssue.number)."'

  buddy_invalidate_issue_relationship_cache "$cache_dir" "$blocked_number" "$blocking_number"
  buddy_invalidate_ready_scan_cache "$cache_dir"
  buddy_signal_publish link-dependency "relationship:issue:$blocked_number" "relationship:issue:$blocking_number" "ready-scan"
done
