#!/bin/bash
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
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  cat <<'JSON'
{"nameWithOwner":"owner/repo","defaultBranchRef":{"name":"main"}}
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  if [[ "${ISSUE_ITEM_MODE:-with-id}" == "title-only" ]]; then
    cat <<'JSON'
{
  "id": "ISSUE_123",
  "number": 123,
  "title": "Issue 123",
  "url": "https://github.com/owner/repo/issues/123",
  "state": "OPEN",
  "updatedAt": "2026-06-12T00:00:00Z",
  "body": "---\nchange_id: demo-change\nclaim_branch: demo-change\nseries: alpha\ncoupling_group: none\nexecution_mode: isolated\nbase_branch: integration\ndepends_on: []\nopenspec_path: openspec/changes/demo-change\nrisk: low\narea: demo\n---\n",
  "labels": [
    { "name": "status:ready" },
    { "name": "type:change" },
    { "name": "area:demo" },
    { "name": "risk:low" },
    { "name": "mode:isolated" }
  ],
  "assignees": [{ "login": "student-a" }],
  "projectItems": [
    { "title": "Major LTE", "status": { "name": "Todo" } }
  ]
}
JSON
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
  "body": "---\nchange_id: demo-change\nclaim_branch: demo-change\nseries: alpha\ncoupling_group: none\nexecution_mode: isolated\nbase_branch: integration\ndepends_on: []\nopenspec_path: openspec/changes/demo-change\nrisk: low\narea: demo\n---\n",
  "labels": [
    { "name": "status:ready" },
    { "name": "type:change" },
    { "name": "area:demo" },
    { "name": "risk:low" },
    { "name": "mode:isolated" }
  ],
  "assignees": [{ "login": "student-a" }],
  "projectItems": [
    { "id": "ITEM_ISSUE_123", "title": "Major LTE", "status": { "name": "Todo" } }
  ]
}
JSON
  exit 0
fi

if [[ "$1" == "pr" && "$2" == "view" ]]; then
  if [[ "${PR_VIEW_MODE:-detached}" == "attached" ]]; then
    cat <<'JSON'
{
  "id": "PR_45",
  "number": 45,
  "url": "https://github.com/owner/repo/pull/45",
  "body": "Summary",
  "baseRefName": "integration",
  "isDraft": false,
  "headRefOid": "head-45",
  "updatedAt": "2026-06-12T00:00:00Z",
  "labels": [
    { "name": "type:change" },
    { "name": "area:demo" },
    { "name": "risk:low" },
    { "name": "mode:isolated" }
  ],
  "assignees": [{ "login": "student-a" }],
  "projectItems": [{ "id": "ITEM_PR_45", "title": "Major LTE", "status": { "name": "In Progress" } }],
  "closingIssuesReferences": [],
  "files": [{ "path": "src/demo.js" }],
  "comments": []
}
JSON
    exit 0
  fi
  cat <<'JSON'
{
  "id": "PR_45",
  "number": 45,
  "url": "https://github.com/owner/repo/pull/45",
  "body": "Summary",
  "baseRefName": "integration",
  "isDraft": false,
  "headRefOid": "head-45",
  "updatedAt": "2026-06-12T00:00:00Z",
  "labels": [
    { "name": "type:change" },
    { "name": "area:demo" },
    { "name": "risk:low" },
    { "name": "mode:isolated" }
  ],
  "assignees": [{ "login": "student-a" }],
  "projectItems": [],
  "closingIssuesReferences": [],
  "files": [{ "path": "src/demo.js" }],
  "comments": []
}
JSON
  exit 0
fi

if [[ "$1" == "project" && "$2" == "view" ]]; then
  cat <<'JSON'
{"id":"PROJECT_1","title":"Major LTE"}
JSON
  exit 0
fi

if [[ "$1" == "project" && "$2" == "field-list" ]]; then
  cat <<'JSON'
{
  "fields": [
    {
      "id": "FIELD_STATUS",
      "name": "Status",
      "options": [
        { "id": "OPT_TODO", "name": "Todo" },
        { "id": "OPT_PROGRESS", "name": "In Progress" },
        { "id": "OPT_DONE", "name": "Done" }
      ]
    },
    { "id": "FIELD_START", "name": "Start", "type": "ProjectV2Field" },
    { "id": "FIELD_END", "name": "End", "type": "ProjectV2Field" }
  ]
}
JSON
  exit 0
fi

if [[ "$1" == "project" && "$2" == "item-edit" ]]; then
  printf '"ITEM_ISSUE_123"\n'
  exit 0
fi

if [[ "$1" == "project" && "$2" == "item-add" ]]; then
  printf '"ITEM_NEW"\n'
  exit 0
fi

if [[ "$1" == "project" && "$2" == "item-list" ]]; then
  echo "project item-list should not be called" >&2
  exit 97
fi

if [[ "$1" == "label" && "$2" == "create" ]]; then
  exit 0
fi

if [[ "$1" == "api" && "$2" == repos/*/issues/45/labels ]]; then
  exit 0
fi

if [[ "$1" == "pr" && "$2" == "edit" ]]; then
  exit 0
fi

if [[ "$1" == "api" && "$2" == repos/*/pulls/45 ]]; then
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=manual
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1

"$repo_root/skills/openspec-buddy/scripts/set-project-status.sh" 123 status:ready > "$tmp_dir/status.out"
if ! grep -F 'Status set to "Todo"' "$tmp_dir/status.out" >/dev/null; then
  echo "set-project-status.sh did not complete with cached project metadata" >&2
  exit 1
fi
if grep -F 'project item-list' "$GH_LOG_FILE" >/dev/null; then
  echo "set-project-status.sh should not call project item-list" >&2
  exit 1
fi

mkdir -p "$tmp_dir/cache-project-mismatch"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"gh-project","repo":"unknown","objectType":"project","key":"owner:99:Status:Start:End","data":{"id":"STALE_PROJECT","number":99,"owner":"owner","title":"Old Project","statusField":{"id":"OLD_FIELD","name":"Status","options":[{"id":"OLD_TODO","name":"Todo"}]},"dateFields":{}}}' > "$tmp_dir/cache-project-mismatch/project.json"
: > "$GH_LOG_FILE"
OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-project-mismatch" "$repo_root/skills/openspec-buddy/scripts/set-project-status.sh" 123 status:ready > /dev/null
if ! grep -F 'project view 1 --owner owner --format json' "$GH_LOG_FILE" >/dev/null; then
  echo "set-project-status.sh should refresh project metadata when cached project identity does not match current config" >&2
  exit 1
fi

mkdir -p "$project_root/openspec/.buddy-cache/issues"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"issue","key":"123","data":{"number":123}}' > "$project_root/openspec/.buddy-cache/issues/123.json"
"$repo_root/skills/openspec-buddy/scripts/set-project-status.sh" 123 status:in-review > /dev/null
if [[ -e "$project_root/openspec/.buddy-cache/issues/123.json" ]]; then
  echo "set-project-status.sh should invalidate subject cache after status-only project edits" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
"$repo_root/skills/openspec-buddy/scripts/configure-pr-metadata.sh" 123 45 --dry-run > "$tmp_dir/configure.out"
if ! grep -F '[dry-run] add PR to project "Major LTE": https://github.com/owner/repo/pull/45' "$tmp_dir/configure.out" >/dev/null; then
  echo "configure-pr-metadata.sh did not use target-scoped project detection" >&2
  cat "$tmp_dir/configure.out" >&2
  exit 1
fi
if grep -F 'project item-list' "$GH_LOG_FILE" >/dev/null; then
  echo "configure-pr-metadata.sh should not call project item-list" >&2
  exit 1
fi

cache_root="$project_root/openspec/.buddy-cache"
mkdir -p "$cache_root/prs"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"pr","key":"45","data":{"number":45}}' > "$cache_root/prs/45.json"
PR_VIEW_MODE=attached "$repo_root/skills/openspec-buddy/scripts/configure-pr-metadata.sh" 123 45 > "$tmp_dir/configure-live.out"
if [[ -e "$cache_root/prs/45.json" ]]; then
  echo "configure-pr-metadata.sh should invalidate cached PR data after mutating labels/body/project metadata" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
set +e
OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-title-only" ISSUE_ITEM_MODE=title-only "$repo_root/skills/openspec-buddy/scripts/set-project-status.sh" 123 status:ready >"$tmp_dir/title-only.out" 2>"$tmp_dir/title-only.err"
title_only_status="$?"
set -e
if [[ "$title_only_status" -eq 0 ]]; then
  echo "set-project-status.sh should fail closed when projectItems lacks editable item id" >&2
  exit 1
fi
if ! grep -F 'does not expose an editable project item id' "$tmp_dir/title-only.err" >/dev/null; then
  echo "expected missing project item id diagnostic" >&2
  cat "$tmp_dir/title-only.err" >&2
  exit 1
fi
if grep -F 'project item-add' "$GH_LOG_FILE" >/dev/null; then
  echo "set-project-status.sh should not add a duplicate project item when subject metadata lacks item id" >&2
  exit 1
fi

echo "project cache tests passed"
