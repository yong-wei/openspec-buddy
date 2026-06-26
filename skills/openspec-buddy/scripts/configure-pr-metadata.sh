#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
pr_ref="${2:-}"
mode="${3:-}"

if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: configure-pr-metadata.sh <issue-number> <pr-number-or-url> [--dry-run]"
  exit 0
fi

if [[ -z "$issue_number" || -z "$pr_ref" ]]; then
  echo "Usage: configure-pr-metadata.sh <issue-number> <pr-number-or-url> [--dry-run]" >&2
  exit 2
fi

dry_run=0
if [[ "$mode" == "--dry-run" ]]; then
  dry_run=1
elif [[ -n "$mode" ]]; then
  echo "Unknown option: $mode" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
openspec_buddy_require_core_config
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cache_dir="$(buddy_cache_dir)"
buddy_signal_apply "$cache_dir"

project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"
development_link_mode="$OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE"
pr_cache_file=""
pr_mutated=0

issue_file="$tmp_dir/issue.json"
pr_file="$tmp_dir/pr.json"
labels_file="$tmp_dir/labels.txt"
pr_label_file="$tmp_dir/pr-labels.txt"
body_file="$tmp_dir/body.md"
development_link_file="$tmp_dir/development-link.json"

buddy_issue_json "$issue_number" "$cache_dir" "$issue_file"
buddy_pr_json "$pr_ref" "$cache_dir" "$pr_file"

issue_url="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.url);' "$issue_file")"
pr_url="$(node -e 'const fs=require("fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(pr.url);' "$pr_file")"
pr_number="$(node -e 'const fs=require("fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(pr.number));' "$pr_file")"
repo_nwo="$(buddy_repo_nwo)"
default_branch="$(buddy_repo_default_branch "$cache_dir")"
pr_cache_file="$(buddy_cache_path pr "$pr_number" "$cache_dir")"

node "$script_dir/build-pr-labels.mjs" "$issue_file" "$pr_file" "$labels_file" "$pr_label_file"

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  if [[ "$dry_run" == "1" ]]; then
    printf '[dry-run] ensure label %s\n' "$name"
    return 0
  fi
  gh label create "$name" --color "$color" --description "$description" >/dev/null 2>&1 || true
}

while IFS= read -r label_name; do
  [[ -z "$label_name" ]] && continue
  if [[ "$label_name" == "pr:openspec-buddy" ]]; then
    ensure_label "$label_name" "5319e7" "OpenSpec Buddy pull request"
  elif [[ "$label_name" == pr:base-* ]]; then
    ensure_label "$label_name" "0e8a16" "Pull request target base branch"
  fi
done < "$pr_label_file"

labels_json_file="$tmp_dir/labels.json"
node -e '
const fs = require("fs");
const labels = fs.readFileSync(process.argv[1], "utf8").split(/\n/).filter(Boolean);
fs.writeFileSync(process.argv[2], JSON.stringify({ labels }));
' "$labels_file" "$labels_json_file"

if [[ -s "$labels_file" ]]; then
  if [[ "$dry_run" == "1" ]]; then
    labels_csv="$(node -e 'const fs=require("fs"); const labels=fs.readFileSync(process.argv[1],"utf8").split(/\n/).filter(Boolean); process.stdout.write(labels.join(","));' "$labels_file")"
    printf '[dry-run] add PR labels to %s: %s\n' "$pr_url" "$labels_csv"
  else
    gh api "repos/$repo_nwo/issues/$pr_number/labels" \
      -X POST \
      --input "$labels_json_file" >/dev/null
    pr_mutated=1
  fi
fi

assignees_file="$tmp_dir/assignees.txt"
node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const assignees = (issue.assignees || []).map((assignee) => assignee.login).filter(Boolean);
fs.writeFileSync(process.argv[2], `${assignees.join("\n")}${assignees.length ? "\n" : ""}`);
' "$issue_file" "$assignees_file"

if [[ -s "$assignees_file" ]]; then
  if [[ "$dry_run" == "1" ]]; then
    assignees_csv="$(node -e 'const fs=require("fs"); const assignees=fs.readFileSync(process.argv[1],"utf8").split(/\n/).filter(Boolean); process.stdout.write(assignees.join(","));' "$assignees_file")"
    printf '[dry-run] add PR assignees to %s: %s\n' "$pr_url" "$assignees_csv"
  else
    while IFS= read -r assignee; do
      [[ -z "$assignee" ]] && continue
      gh pr edit "$pr_ref" --add-assignee "$assignee" >/dev/null
      pr_mutated=1
    done < "$assignees_file"
  fi
else
  echo "Issue #$issue_number has no assignee to mirror onto PR $pr_url." >&2
fi

issue_project_item="$(buddy_project_item_id_from_subject_file "$issue_file" "$project_title")"
issue_project_present="$(buddy_project_item_present_in_subject_file "$issue_file" "$project_title")"

if [[ -z "$issue_project_item" && "$issue_project_present" != "1" ]]; then
  echo "Issue #$issue_number is not in project \"$project_title\"; cannot add PR to the same project." >&2
  exit 1
fi

pr_project_item="$(buddy_project_item_id_from_subject_file "$pr_file" "$project_title")"
pr_project_present="$(buddy_project_item_present_in_subject_file "$pr_file" "$project_title")"

if [[ "$dry_run" == "1" ]]; then
  if [[ -n "$pr_project_item" || "$pr_project_present" == "1" ]]; then
    printf '[dry-run] PR already present in project "%s": %s\n' "$project_title" "$pr_project_item"
  else
    printf '[dry-run] add PR to project "%s": %s\n' "$project_title" "$pr_url"
  fi
  printf '[dry-run] set PR project Status to In Progress\n'
else
  if [[ -z "$pr_project_item" && "$pr_project_present" != "1" ]]; then
    gh project item-add "$project_number" \
      --owner "$project_owner" \
      --url "$pr_url" \
      --format json \
      --jq '.id' >/dev/null
    buddy_invalidate_cache "$(buddy_cache_path project project "$cache_dir")"
    buddy_invalidate_cache "$(buddy_cache_path pr "$pr_number" "$cache_dir")"
    pr_mutated=1
  fi
  "$script_dir/set-project-status.sh" "$pr_url" "status:in-review"
fi

set +e
node "$script_dir/build-pr-development-note.mjs" "$pr_file" "$issue_number" "$default_branch" "$development_link_mode" "$body_file" "$development_link_file"
body_status=$?
set -e
if [[ "$body_status" == "0" ]]; then
  if [[ "$dry_run" == "1" ]]; then
    link_mode="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.mode);' "$development_link_file")"
    printf '[dry-run] append origin issue reference to PR body: #%s (development-link-mode=%s)\n' "$issue_number" "$link_mode"
  else
    body_json_file="$tmp_dir/body.json"
    node -e '
const fs = require("fs");
const body = fs.readFileSync(process.argv[1], "utf8");
fs.writeFileSync(process.argv[2], JSON.stringify({ body }));
' "$body_file" "$body_json_file"
    gh api "repos/$repo_nwo/pulls/$pr_number" \
      -X PATCH \
      --input "$body_json_file" >/dev/null
    pr_mutated=1
  fi
elif [[ "$body_status" == "2" ]]; then
  printf 'PR body already records origin issue #%s.\n' "$issue_number"
else
  exit "$body_status"
fi

link_mode="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.mode);' "$development_link_file")"
if [[ "$link_mode" == "keyword" && "$dry_run" != "1" ]]; then
  linked_issue_seen=0
  for _ in 1 2 3 4 5; do
    if gh pr view "$pr_ref" --json closingIssuesReferences --jq '.closingIssuesReferences[].number' | grep -Fx "$issue_number" >/dev/null; then
      linked_issue_seen=1
      break
    fi
    sleep 2
  done
  if [[ "$linked_issue_seen" != "1" ]]; then
    echo "PR body was updated with a closing keyword for #$issue_number, but GitHub did not report it in closingIssuesReferences. Stop and verify the Development link before review." >&2
    exit 1
  fi
elif [[ "$link_mode" == "manual" ]]; then
  echo "PR Development link requires manual GitHub sidebar linking because this PR does not target the repository default branch." >&2
fi

if [[ "$pr_mutated" == "1" ]]; then
  buddy_invalidate_cache "$pr_cache_file"
  if [[ "${OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH:-0}" != "1" ]]; then
    buddy_signal_publish configure-pr-metadata "pr:$pr_number" "project"
  fi
fi

printf 'Configured PR metadata for %s from issue #%s.\n' "$pr_url" "$issue_number"
