#!/usr/bin/env bash
set -euo pipefail

current_series="${1:-}"
limit="${2:-100}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

openspec list --json > "$tmp_dir/openspec.json"
"$script_dir/list-ready-change-relationships.sh" "$limit" > "$tmp_dir/issues.json"

node -e '
const fs = require("fs");
const active = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const relationships = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const currentSeries = process.argv[3] || "";
const activeChanges = (active.changes || active).map((entry) => typeof entry === "string" ? entry : entry.name || entry.id).filter(Boolean);
process.stdout.write(JSON.stringify({
  activeChanges,
  issues: relationships.issues || relationships,
  currentSeries,
}, null, 2));
' "$tmp_dir/openspec.json" "$tmp_dir/issues.json" "$current_series" \
  | node "$script_dir/select-next-change.mjs"
