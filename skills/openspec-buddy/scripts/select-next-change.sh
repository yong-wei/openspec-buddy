#!/usr/bin/env bash
set -euo pipefail

current_series="${1:-}"
limit="${2:-100}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

openspec list --json > "$tmp_dir/openspec.json"

has_local_only="$(
node -e '
const fs = require("fs");
const active = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const activeChanges = active.changes || active;
const hasLocalOnly = activeChanges.some((entry) => {
  if (!entry || typeof entry === "string") return false;
  if (entry.no_issue === true || entry.noIssue === true) return true;
  if (entry.issue === false) return true;
  const coordination = String(entry.coordination || "").toLowerCase();
  return coordination === "local" || coordination === "no-issue" || coordination === "no_issue";
});
process.stdout.write(hasLocalOnly ? "1" : "0");
' "$tmp_dir/openspec.json"
)"

if [[ "$has_local_only" == "1" ]] && ! openspec_buddy_has_core_config; then
  openspec_buddy_require_local_only_config
  printf '{"issues":[]}\n' > "$tmp_dir/issues.json"
else
  openspec_buddy_require_core_config
  if ! "$script_dir/list-ready-change-relationships.sh" "$limit" > "$tmp_dir/issues.json" 2>"$tmp_dir/issues.err"; then
    if [[ "$has_local_only" == "1" ]]; then
      printf '{"issues":[]}\n' > "$tmp_dir/issues.json"
    else
      cat "$tmp_dir/issues.err" >&2
      exit 1
    fi
  fi
fi

node -e '
const fs = require("fs");
const active = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const relationships = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const currentSeries = process.argv[3] || "";
const activeChanges = active.changes || active;
process.stdout.write(JSON.stringify({
  activeChanges,
  issues: relationships.issues || relationships,
  currentSeries,
}, null, 2));
' "$tmp_dir/openspec.json" "$tmp_dir/issues.json" "$current_series" \
  | node "$script_dir/select-next-change.mjs"
