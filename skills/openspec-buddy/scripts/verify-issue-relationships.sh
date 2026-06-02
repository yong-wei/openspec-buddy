#!/usr/bin/env bash
set -euo pipefail

require_parent=false
refs=()

usage() {
  cat >&2 <<'EOF'
Usage: verify-issue-relationships.sh [--require-parent] <issue-number-or-url>...

Batch-fetches GitHub parent/subIssue and blockedBy/blocking relationships for
the provided issues in one GraphQL request, then verifies relationship
consistency with verify-issue-relationships.mjs.
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --require-parent)
      require_parent=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      refs+=("$1")
      ;;
  esac
  shift
done

if [[ "${#refs[@]}" -eq 0 ]]; then
  usage
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')"
owner="${repo%%/*}"
name="${repo#*/}"

numbers=()
seen=","
for ref in "${refs[@]}"; do
  number="${ref##*/}"
  number="${number#\#}"
  if [[ ! "$number" =~ ^[0-9]+$ ]]; then
    echo "Invalid issue reference: $ref" >&2
    exit 2
  fi
  if [[ "$seen" != *",$number,"* ]]; then
    numbers+=("$number")
    seen+="$number,"
  fi
done

issue_fields='
        id
        number
        title
        url
        state
        labels(first: 40) { nodes { name } }
        parent { number title url state labels(first: 40) { nodes { name } } }
        subIssues(first: 100) { nodes { number title url state labels(first: 40) { nodes { name } } } }
        blockedBy(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
        blocking(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
'

query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {'
for index in "${!numbers[@]}"; do
  query+=" issue${index}: issue(number: ${numbers[$index]}) { ${issue_fields} }"
done
query+=' } }'

response="$(gh api graphql \
  -f query="$query" \
  -f owner="$owner" \
  -f name="$name")"

printf '%s' "$response" | node -e '
const fs = require("node:fs");
const response = JSON.parse(fs.readFileSync(0, "utf8"));
const repository = response.data?.repository || {};
const issues = Object.values(repository).filter(Boolean);
process.stdout.write(JSON.stringify({
  issues,
  requireParent: process.argv[1] === "true"
}));
' "$require_parent" | "$script_dir/verify-issue-relationships.mjs"
