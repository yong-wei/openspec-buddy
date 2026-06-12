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
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
repo="$(buddy_repo_nwo)"
owner="${repo%%/*}"
name="${repo#*/}"
buddy_signal_apply "$(buddy_cache_dir)" "$repo"

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

relationships="$(buddy_issue_relationships_graphql "$owner" "$name" "${numbers[@]}")"

printf '%s' "$relationships" | node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify({
  issues,
  requireParent: process.argv[1] === "true"
}));
' "$require_parent" | "$script_dir/verify-issue-relationships.mjs"
