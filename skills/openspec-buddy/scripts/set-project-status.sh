#!/usr/bin/env bash
set -euo pipefail

issue_ref="${1:-}"
target_status="${2:-}"
if [[ -z "$issue_ref" || -z "$target_status" ]]; then
  echo "Usage: set-project-status.sh <issue-number-or-url> <status:label>" >&2
  exit 2
fi

if [[ "$target_status" != status:* ]]; then
  echo "Target status label must start with status:." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"
status_field_name="$OPENSPEC_BUDDY_PROJECT_STATUS_FIELD"
todo_option_name="$OPENSPEC_BUDDY_PROJECT_STATUS_TODO"
in_progress_option_name="$OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS"
done_option_name="$OPENSPEC_BUDDY_PROJECT_STATUS_DONE"

case "$target_status" in
  status:claimed|status:in-progress|status:in-review)
    project_status="$in_progress_option_name"
    ;;
  status:merged|status:archived)
    project_status="$done_option_name"
    ;;
  status:backlog|status:ready|status:blocked|status:tracking|status:stale-claim|status:needs-human|status:failed)
    project_status="$todo_option_name"
    ;;
  *)
    echo "No Project Status mapping for $target_status." >&2
    exit 2
    ;;
esac

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

read -r status_field_id status_option_id < <(node -e '
const fs = require("node:fs");
const project = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fieldName = process.argv[2];
const optionName = process.argv[3];
const field = project.statusField;
if (!field || field.name !== fieldName) process.exit(1);
const option = (field.options || []).find((entry) => entry.name === optionName);
if (!option) process.exit(2);
process.stdout.write(`${field.id} ${option.id}\n`);
' "$project_file" "$status_field_name" "$project_status") || {
  echo "Could not resolve Project field \"$status_field_name\" option \"$project_status\"." >&2
  exit 1
}

item_id="$(buddy_project_item_id_from_subject_file "$subject_file" "$project_title")"
item_present="$(buddy_project_item_present_in_subject_file "$subject_file" "$project_title")"

if [[ -z "$item_id" ]]; then
  if [[ "$item_present" == "1" ]]; then
    echo "Target is already in project \"$project_title\", but gh subject metadata does not expose an editable project item id." >&2
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
  --field-id "$status_field_id" \
  --single-select-option-id "$status_option_id" \
  --format json \
  --jq '.id' >/dev/null

buddy_invalidate_subject_cache_from_file "$subject_file" "$cache_dir"

printf 'Project "%s" Status set to "%s" for %s.\n' "$project_title" "$project_status" "$issue_url"
