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
)

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  if [[ "$*" == *"--json labels"* && "$*" != *"body"* ]]; then
    printf '%s\n' '{"labels":[{"name":"status:ready"},{"name":"type:change"}]}'
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
  "labels": [
    { "name": "status:archived" },
    { "name": "type:change" }
  ],
  "assignees": [],
  "projectItems": [
    { "id": "ITEM_ISSUE_123", "title": "Major LTE", "status": { "name": "Todo" } }
  ]
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

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

cache_dir="$project_root/openspec/.buddy-cache"
mkdir -p "$cache_dir/relationships"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"unknown","objectType":"relationship","key":"issue-123","data":{"number":123}}' > "$cache_dir/relationships/issue-123.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"unknown","objectType":"relationship","key":"issue-999","data":{"number":999}}' > "$cache_dir/relationships/issue-999.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"unknown","objectType":"relationship","key":"ready-scan-limit-25","data":[]}' > "$cache_dir/relationships/ready-scan-limit-25.json"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"

"$repo_root/skills/openspec-buddy/scripts/set-status-label.sh" 123 status:archived >"$tmp_dir/out.txt"

if [[ -e "$cache_dir/relationships/issue-123.json" ]]; then
  echo "set-status-label.sh should invalidate the updated issue relationship cache entry" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/ready-scan-limit-25.json" ]]; then
  echo "set-status-label.sh should invalidate ready scan caches after status changes" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/issue-999.json" ]]; then
  echo "set-status-label.sh should invalidate all relationship cache entries because neighboring issue labels are embedded in cached relationships" >&2
  exit 1
fi

echo "set-status-label cache invalidation tests passed"
