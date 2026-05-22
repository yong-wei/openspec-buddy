#!/usr/bin/env bash
set -euo pipefail

issue_ref="${1:-}"
field_name="${2:-}"
date_value="${3:-}"

if [[ -z "$issue_ref" || -z "$field_name" || -z "$date_value" ]]; then
  echo "Usage: set-project-date.sh <issue-number-or-url> <Start|End> <YYYY-MM-DD>" >&2
  exit 2
fi

if [[ "$field_name" != "Start" && "$field_name" != "End" ]]; then
  echo "Project date field must be Start or End." >&2
  exit 2
fi

if [[ ! "$date_value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "Date must use YYYY-MM-DD." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"
if [[ "$field_name" == "Start" ]]; then
  field_name="$OPENSPEC_BUDDY_PROJECT_START_FIELD"
elif [[ "$field_name" == "End" ]]; then
  field_name="$OPENSPEC_BUDDY_PROJECT_END_FIELD"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

if [[ "$issue_ref" == http://* || "$issue_ref" == https://* ]]; then
  issue_url="$issue_ref"
else
  issue_url="$(gh issue view "$issue_ref" --json url --jq '.url')"
fi

project_file="$tmp_dir/project.json"
fields_file="$tmp_dir/fields.json"
items_file="$tmp_dir/items.json"

gh project view "$project_number" \
  --owner "$project_owner" \
  --format json > "$project_file"

project_id="$(node -e '
const fs = require("fs");
const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(project.id || "");
' "$project_file")"

if [[ -z "$project_id" ]]; then
  echo "Could not resolve project id for \"$project_title\"." >&2
  exit 1
fi

gh project field-list "$project_number" \
  --owner "$project_owner" \
  --format json \
  --limit 100 > "$fields_file"

field_id="$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fieldName = process.argv[2];
const field = (data.fields || []).find((entry) => entry.name === fieldName && entry.type === "ProjectV2Field");
if (field) process.stdout.write(field.id);
' "$fields_file" "$field_name")"

if [[ -z "$field_id" ]]; then
  echo "Could not resolve Project date field \"$field_name\"." >&2
  exit 1
fi

gh project item-list "$project_number" \
  --owner "$project_owner" \
  --format json \
  --limit 200 > "$items_file"

item_id="$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const issueUrl = process.argv[2];
const item = (data.items || []).find((entry) => entry.content && entry.content.url === issueUrl);
if (item) process.stdout.write(item.id);
' "$items_file" "$issue_url")"

if [[ -z "$item_id" ]]; then
  item_id="$(
    gh project item-add "$project_number" \
      --owner "$project_owner" \
      --url "$issue_url" \
      --format json \
      --jq '.id'
  )"
fi

gh project item-edit \
  --id "$item_id" \
  --project-id "$project_id" \
  --field-id "$field_id" \
  --date "$date_value" \
  --format json \
  --jq '.id' >/dev/null

printf 'Project "%s" %s set to "%s" for %s.\n' "$project_title" "$field_name" "$date_value" "$issue_url"
