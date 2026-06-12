#!/usr/bin/env bash
set -euo pipefail

issue_url="${1:-}"
if [[ -z "$issue_url" ]]; then
  echo "Usage: add-issue-to-project.sh <issue-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cache_dir="$(buddy_cache_dir)"
subject_file="$tmp_dir/issue.json"

buddy_issue_json "$issue_url" "$cache_dir" "$subject_file"
existing_id="$(buddy_project_item_id_from_subject_file "$subject_file" "$project_title")"
existing_present="$(buddy_project_item_present_in_subject_file "$subject_file" "$project_title")"

if [[ -n "$existing_id" || "$existing_present" == "1" ]]; then
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
buddy_invalidate_cache "$(buddy_cache_path project project "$cache_dir")"
issue_number="$(node -e 'const fs=require("node:fs"); const subject=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(subject.number || ""));' "$subject_file")"
[[ -n "$issue_number" ]] && buddy_invalidate_cache "$(buddy_cache_path issue "$issue_number" "$cache_dir")"
"$script_dir/set-project-status.sh" "$issue_url" "status:ready"
