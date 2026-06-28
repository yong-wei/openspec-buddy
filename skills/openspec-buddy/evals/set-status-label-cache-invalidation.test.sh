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
  git remote add origin https://github.com/owner/repo.git
)

cat > "$tmp_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  if [[ "$*" == *"--json labels"* && "$*" != *"body"* ]]; then
    if [[ -f "$STATE_DIR/status-archived" ]]; then
      printf '%s\n' '{"labels":[{"name":"status:archived"},{"name":"type:change"}]}'
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
  touch "$STATE_DIR/status-archived"
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
  if [[ "$*" == *"id=ITEM_ISSUE_123"* ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ITEM_ISSUE_123","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"}}}}
JSON
    exit 0
  fi
  cat <<'JSON'
{"data":{"repository":{"issue0":{"number":555,"labels":{"nodes":[{"name":"status:ready"},{"name":"type:change"}]},"subIssues":{"nodes":[]},"blockedBy":{"nodes":[{"number":123,"labels":{"nodes":[{"name":"status:archived"},{"name":"type:change"}]}}]},"blocking":{"nodes":[]}}}}}
JSON
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

cache_dir="$project_root/openspec/.buddy-cache"
mkdir -p "$cache_dir/relationships" "$cache_dir/issues"
fetched_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"graphql\",\"repo\":\"owner/repo\",\"objectType\":\"relationship\",\"key\":\"issue-123\",\"data\":{\"number\":123}}" > "$cache_dir/relationships/issue-123.json"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"graphql\",\"repo\":\"owner/repo\",\"objectType\":\"relationship\",\"key\":\"issue-999\",\"data\":{\"number\":999}}" > "$cache_dir/relationships/issue-999.json"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"graphql\",\"repo\":\"owner/repo\",\"objectType\":\"relationship\",\"key\":\"issue-555\",\"data\":{\"number\":555,\"blockedByNumbers\":[123]}}" > "$cache_dir/relationships/issue-555.json"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"rest\",\"repo\":\"owner/repo\",\"objectType\":\"relationship\",\"key\":\"ready-scan-limit-25\",\"data\":[]}" > "$cache_dir/relationships/ready-scan-limit-25.json"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"rest\",\"repo\":\"owner/repo\",\"objectType\":\"issue\",\"key\":\"123\",\"data\":{\"number\":123,\"state\":\"OPEN\",\"labels\":[{\"name\":\"status:ready\"},{\"name\":\"type:change\"}]}}" > "$cache_dir/issues/123.json"
printf '%s\n' "{\"fetchedAt\":\"$fetched_at\",\"source\":\"rest\",\"repo\":\"owner/repo\",\"objectType\":\"issue\",\"key\":\"555\",\"data\":{\"number\":555,\"state\":\"OPEN\",\"labels\":[{\"name\":\"status:ready\"},{\"name\":\"type:change\"}]}}" > "$cache_dir/issues/555.json"

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

"$repo_root/skills/openspec-buddy/scripts/set-status-label.sh" 123 status:archived >"$tmp_dir/out.txt"

if [[ ! -e "$cache_dir/relationships/issue-123.json" ]]; then
  echo "set-status-label.sh should preserve targeted relationship cache entries after node-only status changes" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/ready-scan-limit-25.json" ]]; then
  echo "set-status-label.sh should invalidate ready scan caches after status changes" >&2
  exit 1
fi

if [[ ! -e "$cache_dir/relationships/issue-999.json" ]]; then
  echo "set-status-label.sh should not invalidate unrelated relationship cache entries" >&2
  exit 1
fi

hydrated="$(
  PATH="$tmp_dir:$PATH" \
  GH_LOG_FILE="$tmp_dir/gh.log" \
  OPENSPEC_BUDDY_REPO_ROOT="$project_root" \
  OPENSPEC_BUDDY_BASE_BRANCH=integration \
  OPENSPEC_BUDDY_RELEASE_BRANCH=main \
  OPENSPEC_BUDDY_PROJECT_OWNER=owner \
  OPENSPEC_BUDDY_PROJECT_NUMBER=1 \
  OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE" \
  OPENSPEC_BUDDY_DISABLE_SIGNAL=1 \
  bash -c '
    source "'"$repo_root"'/skills/openspec-buddy/scripts/github-fetch.sh"
    buddy_issue_relationships_graphql owner repo 555
  '
)"

HYDRATED_RELATIONSHIPS="$hydrated" node -e '
const payload = JSON.parse(process.env.HYDRATED_RELATIONSHIPS);
const blocker = payload[0]?.blockedBy?.nodes?.[0];
if (!blocker) {
  process.stderr.write("expected hydrated blocker node\n");
  process.exit(1);
}
const labels = Array.isArray(blocker.labels)
  ? blocker.labels.map((entry) => entry.name)
  : (blocker.labels?.nodes || []).map((entry) => entry.name);
if (!labels.includes("status:archived")) {
  process.stderr.write("expected missing blocker cache to be refetched with archived status\n");
  process.exit(1);
}
'

echo "set-status-label cache invalidation tests passed"
