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
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir" "$repo"

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

all_numbers=("${numbers[@]}")
buddy_issue_relationships_graphql "$owner" "$name" "${all_numbers[@]}" >/dev/null

while :; do
  relationship_files=()
  for number in "${all_numbers[@]}"; do
    relationship_file="$(buddy_cache_path relationship "issue-$number" "$cache_dir")"
    if [[ -f "$relationship_file" ]]; then
      relationship_files+=("$relationship_file")
    fi
  done

  next_numbers=()
  if [[ "${#relationship_files[@]}" -gt 0 ]]; then
    while IFS= read -r number; do
      [[ -n "$number" ]] || continue
      if [[ "$seen" != *",$number,"* ]]; then
        next_numbers+=("$number")
        seen+="$number,"
      fi
    done < <(buddy_relationship_neighbor_numbers "${relationship_files[@]}")
  fi
  if [[ "${#next_numbers[@]}" -eq 0 ]]; then
    break
  fi

  buddy_issue_relationships_graphql "$owner" "$name" "${next_numbers[@]}" >/dev/null
  for number in "${next_numbers[@]}"; do
    relationship_file="$(buddy_cache_path relationship "issue-$number" "$cache_dir")"
    if [[ -f "$relationship_file" ]]; then
      all_numbers+=("$number")
    fi
  done
done

relationships="$(buddy_issue_relationships_graphql "$owner" "$name" "${all_numbers[@]}")"

printf '%s' "$relationships" | node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(0, "utf8"));
const expected = process.argv.slice(1).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
const present = new Set((Array.isArray(issues) ? issues : []).map((issue) => Number(issue?.number || 0)).filter((value) => Number.isFinite(value) && value > 0));
const missing = expected.filter((value) => !present.has(value));
if (missing.length > 0) {
  process.stderr.write(`Could not fetch relationship metadata for explicit issue(s): ${missing.map((value) => `#${value}`).join(", ")}.\n`);
  process.exit(1);
}
' "${numbers[@]}"

printf '%s' "$relationships" | node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify({
  issues,
  requireParent: process.argv[1] === "true"
}));
' "$require_parent" | "$script_dir/verify-issue-relationships.mjs"
