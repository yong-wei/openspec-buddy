#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
project_root="$tmp_dir/project"
mkdir -p "$project_root"
trap 'rm -rf "$tmp_dir"' EXIT

(
  cd "$project_root"
  git init -q
  git remote add origin https://github.com/owner/repo.git
)

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  if [[ "$*" == *"--json labels"* && "$*" != *"body"* ]]; then
    count_file="$STATE_DIR/label-view-count"
    count=0
    [[ -f "$count_file" ]] && count="$(cat "$count_file")"
    count=$((count + 1))
    printf '%s\n' "$count" > "$count_file"
    if [[ "${STATUS_VERIFY_MODE:-ok}" == "already-in-progress" ]]; then
      printf '%s\n' '{"labels":[{"name":"status:in-progress"},{"name":"type:change"}]}'
    elif [[ "${STATUS_VERIFY_MODE:-ok}" == "target-plus-extra" && "$count" -eq 1 ]]; then
      printf '%s\n' '{"labels":[{"name":"status:in-review"},{"name":"status:in-progress"},{"name":"type:change"}]}'
    elif [[ "${STATUS_VERIFY_MODE:-ok}" == "target-plus-extra" ]]; then
      printf '%s\n' '{"labels":[{"name":"status:in-review"},{"name":"type:change"}]}'
    elif [[ "${STATUS_VERIFY_MODE:-ok}" == "missing" && "$count" -gt 1 ]]; then
      printf '%s\n' '{"labels":[{"name":"type:change"}]}'
    else
      printf '%s\n' '{"labels":[{"name":"status:ready"},{"name":"type:change"}]}'
    fi
    exit 0
  fi
  cat <<'JSON'
{
  "id": "ISSUE_123",
  "number": 123,
  "title": "Issue 123",
  "url": "https://github.com/owner/repo/issues/123",
  "state": "OPEN",
  "updatedAt": "2026-06-12T00:00:00Z",
  "body": "---\nchange_id: demo-change\n---\n",
  "labels": [{ "name": "status:ready" }],
  "assignees": [],
  "projectItems": [{ "id": "ITEM_ISSUE_123", "title": "Major LTE" }]
}
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "edit" ]]; then
  exit 0
fi

if [[ "$1" == "project" && "$2" == "view" ]]; then
  printf '%s\n' '{"id":"PROJECT_1","title":"Major LTE"}'
  exit 0
fi

if [[ "$1" == "project" && "$2" == "field-list" ]]; then
  cat <<'JSON'
{"fields":[{"id":"FIELD_STATUS","name":"Status","options":[{"id":"OPT_TODO","name":"Todo"},{"id":"OPT_PROGRESS","name":"In Progress"},{"id":"OPT_DONE","name":"Done"}]},{"id":"FIELD_START","name":"Start","type":"ProjectV2Field"},{"id":"FIELD_END","name":"End","type":"ProjectV2Field"}]}
JSON
  exit 0
fi

if [[ "$1" == "project" && "$2" == "item-edit" ]]; then
  printf '"ITEM_ISSUE_123"\n'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  if [[ "${PROJECT_VERIFY_MODE:-ok}" == "wrong-status" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ITEM_ISSUE_123","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Todo"},"date":{"date":"2026-06-13"}}}}
JSON
  elif [[ "${PROJECT_VERIFY_MODE:-ok}" == "wrong-date" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ITEM_ISSUE_123","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"In Progress"},"date":{"date":"2026-06-12"}}}}
JSON
  else
    cat <<'JSON'
{"data":{"node":{"id":"ITEM_ISSUE_123","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"In Progress"},"date":{"date":"2026-06-13"},"projectItems":{"nodes":[{"id":"ITEM_ISSUE_123","project":{"id":"PROJECT_1","title":"Major LTE"}}]}}}}
JSON
  fi
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export STATE_DIR="$tmp_dir/state"
mkdir -p "$STATE_DIR"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1

STATUS_VERIFY_MODE=already-in-progress "$repo_root/skills/openspec-buddy/scripts/set-status-label.sh" 123 status:in-progress > "$tmp_dir/already-status.out"
if grep -F "issue edit 123" "$tmp_dir/gh.log" >/dev/null; then
  echo "set-status-label.sh should not remove and re-add a status label that is already present" >&2
  cat "$tmp_dir/gh.log" >&2
  exit 1
fi
if ! grep -F "project item-edit" "$tmp_dir/gh.log" >/dev/null; then
  echo "set-status-label.sh should still sync the Project status when the issue status label is already present" >&2
  cat "$tmp_dir/gh.log" >&2
  exit 1
fi
rm -f "$tmp_dir/gh.log" "$STATE_DIR/label-view-count"

STATUS_VERIFY_MODE=target-plus-extra "$repo_root/skills/openspec-buddy/scripts/set-status-label.sh" 123 status:in-review > "$tmp_dir/target-plus-extra.out"
if ! grep -F "issue edit 123 --remove-label status:in-progress" "$tmp_dir/gh.log" >/dev/null; then
  echo "set-status-label.sh should remove only extra status labels when the target status is already present" >&2
  cat "$tmp_dir/gh.log" >&2
  exit 1
fi
if grep -F -- "--add-label status:in-review" "$tmp_dir/gh.log" >/dev/null; then
  echo "set-status-label.sh should not re-add a target status label that is already present" >&2
  cat "$tmp_dir/gh.log" >&2
  exit 1
fi
rm -f "$tmp_dir/gh.log" "$STATE_DIR/label-view-count"

set +e
STATUS_VERIFY_MODE=missing "$repo_root/skills/openspec-buddy/scripts/set-status-label.sh" 123 status:archived > "$tmp_dir/missing-label.out" 2> "$tmp_dir/missing-label.err"
missing_label_status="$?"
set -e
if [[ "$missing_label_status" -eq 0 ]]; then
  echo "set-status-label.sh should fail when the post-edit issue read does not show the target status label" >&2
  exit 1
fi
if ! grep -F "Status label verification failed" "$tmp_dir/missing-label.err" >/dev/null; then
  echo "set-status-label.sh should explain failed status label verification" >&2
  cat "$tmp_dir/missing-label.err" >&2
  exit 1
fi

set +e
PROJECT_VERIFY_MODE=wrong-status "$repo_root/skills/openspec-buddy/scripts/set-project-status.sh" 123 status:in-progress > "$tmp_dir/wrong-status.out" 2> "$tmp_dir/wrong-status.err"
wrong_status_result="$?"
set -e
if [[ "$wrong_status_result" -eq 0 ]]; then
  echo "set-project-status.sh should fail when Project Status verification does not show the expected option" >&2
  exit 1
fi
if ! grep -F "Project Status verification failed" "$tmp_dir/wrong-status.err" >/dev/null; then
  echo "set-project-status.sh should explain failed Project Status verification" >&2
  cat "$tmp_dir/wrong-status.err" >&2
  exit 1
fi

set +e
PROJECT_VERIFY_MODE=wrong-date "$repo_root/skills/openspec-buddy/scripts/set-project-date.sh" 123 Start 2026-06-13 > "$tmp_dir/wrong-date.out" 2> "$tmp_dir/wrong-date.err"
wrong_date_result="$?"
set -e
if [[ "$wrong_date_result" -eq 0 ]]; then
  echo "set-project-date.sh should fail when Project date verification does not show the expected date" >&2
  exit 1
fi
if ! grep -F "Project date verification failed" "$tmp_dir/wrong-date.err" >/dev/null; then
  echo "set-project-date.sh should explain failed Project date verification" >&2
  cat "$tmp_dir/wrong-date.err" >&2
  exit 1
fi

echo "status write verification tests passed"
