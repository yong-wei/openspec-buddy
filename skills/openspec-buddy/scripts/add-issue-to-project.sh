#!/usr/bin/env bash
set -euo pipefail

issue_url="${1:-}"
if [[ -z "$issue_url" ]]; then
  echo "Usage: add-issue-to-project.sh <issue-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

gh project item-list "$project_number" \
  --owner "$project_owner" \
  --format json \
  --limit 200 > "$tmp_file"

existing_id="$(
  node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const issueUrl = process.argv[2];
const item = (data.items || []).find((entry) => entry.content && entry.content.url === issueUrl);
if (item) process.stdout.write(item.id);
' "$tmp_file" "$issue_url"
)"

if [[ -n "$existing_id" ]]; then
  printf 'Issue already present in project "%s": %s\n' "$project_title" "$existing_id"
  "$script_dir/set-project-status.sh" "$issue_url" "status:ready"
  exit 0
fi

item_id="$(
  gh project item-add "$project_number" \
    --owner "$project_owner" \
    --url "$issue_url" \
    --format json \
    --jq '.id'
)"

printf 'Added issue to project "%s": %s\n' "$project_title" "$item_id"
"$script_dir/set-project-status.sh" "$issue_url" "status:ready"
