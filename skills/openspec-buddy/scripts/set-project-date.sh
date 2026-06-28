#!/usr/bin/env bash
set -euo pipefail

issue_ref="${1:-}"
field_name="${2:-}"
date_value="${3:-}"

if [[ "$issue_ref" == "-h" || "$issue_ref" == "--help" ]]; then
  echo "Usage: set-project-date.sh <issue-number-or-url> <Start|End> <YYYY-MM-DD>"
  exit 0
fi

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
source "$script_dir/github-fetch.sh"
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
cache_dir="$(buddy_cache_dir)"

subject_file="$tmp_dir/subject.json"
project_file="$tmp_dir/project.json"

buddy_subject_json "$issue_ref" "$cache_dir" "$subject_file"
buddy_project_metadata_json "$cache_dir" "$project_file"

issue_url="$(node -e 'const fs=require("node:fs"); const subject=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(subject.url || "");' "$subject_file")"
project_id="$(node -e 'const fs=require("node:fs"); const project=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(project.id || "");' "$project_file")"

if [[ -z "$project_id" ]]; then
  echo "Could not resolve project id for \"$project_title\"." >&2
  exit 1
fi

verify_project_date() {
  local item="$1"
  local expected_project_id="$2"
  local expected_date="$3"
  local verify_file="$tmp_dir/project-date-verify.json"
  buddy_graphql_api \
    -f id="$item" \
    -f dateField="$field_name" \
    -f query='
query($id: ID!, $dateField: String!) {
  node(id: $id) {
    ... on ProjectV2Item {
      id
      project { id title }
      date: fieldValueByName(name: $dateField) {
        ... on ProjectV2ItemFieldDateValue { date }
      }
    }
  }
}' > "$verify_file"
  node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const expectedItem = process.argv[2];
const expectedProject = process.argv[3];
const expectedDate = process.argv[4];
const item = data?.data?.node;
if (!item || item.id !== expectedItem) {
  process.stderr.write(`Project date verification failed: item ${expectedItem} was not returned.\n`);
  process.exit(1);
}
if (item.project?.id !== expectedProject) {
  process.stderr.write(`Project date verification failed: item ${expectedItem} is not in expected project ${expectedProject}.\n`);
  process.exit(1);
}
if (item.date?.date !== expectedDate) {
  process.stderr.write(`Project date verification failed: expected "${expectedDate}", observed "${item.date?.date || "<none>"}".\n`);
  process.exit(1);
}
' "$verify_file" "$item" "$expected_project_id" "$expected_date"
}

field_id="$(node -e '
const fs = require("node:fs");
const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fieldName = process.argv[2];
const field = project.dateFields?.[fieldName];
if (field?.id) process.stdout.write(field.id);
' "$project_file" "$field_name")"

if [[ -z "$field_id" ]]; then
  echo "Could not resolve Project date field \"$field_name\"." >&2
  exit 1
fi

item_id="$(buddy_project_item_id_for_subject_file "$subject_file" "$project_title" "$project_id")"
item_present="$(buddy_project_item_present_in_subject_file "$subject_file" "$project_title")"

if [[ -z "$item_id" ]]; then
  if [[ "$item_present" == "1" ]]; then
    echo "Target is already in project \"$project_title\", but no editable project item id was found even after a target-scoped GraphQL refresh." >&2
    exit 1
  fi
  item_id="$(
    gh project item-add "$project_number" \
      --owner "$project_owner" \
      --url "$issue_url" \
      --format json \
      --jq '.id'
  )"
  buddy_invalidate_cache "$(buddy_cache_path project project "$cache_dir")"
  buddy_invalidate_subject_cache_from_file "$subject_file" "$cache_dir"
fi

gh project item-edit \
  --id "$item_id" \
  --project-id "$project_id" \
  --field-id "$field_id" \
  --date "$date_value" \
  --format json \
  --jq '.id' >/dev/null
verify_project_date "$item_id" "$project_id" "$date_value"

buddy_invalidate_subject_cache_from_file "$subject_file" "$cache_dir"

printf 'Project "%s" %s set to "%s" for %s.\n' "$project_title" "$field_name" "$date_value" "$issue_url"
