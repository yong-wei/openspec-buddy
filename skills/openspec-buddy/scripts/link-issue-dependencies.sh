#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 || $(( $# % 2 )) -ne 0 ]]; then
  echo "Usage: link-issue-dependencies.sh <blocked-issue> <blocking-issue> [<blocked-issue> <blocking-issue> ...]" >&2
  echo "Example: A depends on B => link-issue-dependencies.sh <A> <B>" >&2
  exit 2
fi

while [[ "$#" -gt 0 ]]; do
  blocked_ref="$1"
  blocking_ref="$2"
  shift 2

  blocked_json="$(gh issue view "$blocked_ref" --json id,number,url)"
  blocking_json="$(gh issue view "$blocking_ref" --json id,number,url)"
  blocked_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$blocked_json")"
  blocking_id="$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.id);' "$blocking_json")"

  gh api graphql \
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
done
