#!/usr/bin/env bash
set -euo pipefail

limit="${1:-100}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"

repo="$(buddy_repo_nwo)"
owner="${repo%%/*}"
name="${repo#*/}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir" "$repo"
scan_cache_file="$(buddy_open_ready_scan_cache_file "$cache_dir" "$limit")"

if ! buddy_cache_is_stale "$scan_cache_file" "$buddy_ready_scan_cache_ttl_seconds"; then
  buddy_cache_tool data "$scan_cache_file"
  exit 0
fi

issues_file="$tmp_dir/issues.json"
candidate_numbers_file="$tmp_dir/candidate-numbers.txt"
candidate_bodies_file="$tmp_dir/candidate-bodies.json"
relationships_file="$tmp_dir/relationships.json"

buddy_open_issues_rest "$limit" > "$issues_file"

node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const normalizeLabels = (labels) => (labels || [])
  .map((entry) => entry?.name || "")
  .filter(Boolean)
  .map((name) => name.replace(/^(status|type|area|series|risk|mode):\s+/, "$1:"));
const candidates = issues.filter((issue) => {
  const labels = normalizeLabels(issue.labels);
  if (String(issue.state || "").toUpperCase() !== "OPEN") return false;
  if (labels.includes("type:series-parent") || labels.includes("status:tracking")) return false;
  return labels.includes("status:ready");
});
fs.writeFileSync(process.argv[2], `${candidates.map((issue) => issue.number).join("\n")}\n`);
' "$issues_file" "$candidate_numbers_file"

if [[ "${OPENSPEC_BUDDY_OPEN_ISSUES_NEEDS_BODY:-}" == "1" ]]; then
  : > "$candidate_bodies_file"
  node -e 'process.stdout.write("{}\n")' > "$candidate_bodies_file"
  while IFS= read -r number; do
    [[ -n "$number" ]] || continue
    body="$(buddy_issue_body_rest "$number")"
    node -e '
const fs = require("node:fs");
const [file, number, body] = process.argv.slice(1);
const current = JSON.parse(fs.readFileSync(file, "utf8"));
current[number] = body;
fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
' "$candidate_bodies_file" "$number" "$body"
  done < "$candidate_numbers_file"
else
  node -e 'process.stdout.write("{}\n")' > "$candidate_bodies_file"
fi

candidate_numbers=()
while IFS= read -r number; do
  [[ -n "$number" ]] || continue
  candidate_numbers+=("$number")
done < "$candidate_numbers_file"
if [[ "${#candidate_numbers[@]}" -gt 0 ]]; then
  buddy_issue_relationships_graphql "$owner" "$name" "${candidate_numbers[@]}" > "$relationships_file"
else
  printf '[]\n' > "$relationships_file"
fi

merged_file="$tmp_dir/merged.json"
node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fetchedBodies = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const relationships = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const byNumber = new Map(relationships.map((issue) => [issue.number, issue]));
const merged = issues.map((issue) => {
  const number = issue.number;
  const relationship = byNumber.get(number);
  const next = relationship ? { ...issue, ...relationship } : { ...issue };
  if (!next.body && fetchedBodies[number]) {
    next.body = fetchedBodies[number];
  }
  return next;
});
process.stdout.write(`${JSON.stringify({ issues: merged }, null, 2)}\n`);
' "$issues_file" "$candidate_bodies_file" "$relationships_file" > "$merged_file"

buddy_cache_set_from_file "$scan_cache_file" rest relationship "ready-scan-limit-$limit" "$merged_file"
cat "$merged_file"
