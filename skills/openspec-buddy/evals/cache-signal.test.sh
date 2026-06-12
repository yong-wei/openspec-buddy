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

if [[ "$1" == "api" && "$2" == "user" ]]; then
  printf '%s\n' 'reviewer'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/ref/openspec-buddy/cache-signal" ]]; then
  count_file="${GH_REF_COUNT_FILE:?}"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(cat "$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if [[ "$count" -ge 4 ]]; then
    printf '%s\n' 'tip-after-retry'
  else
    printf '%s\n' 'tip-current'
  fi
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/commits/tip-current" ]]; then
  printf '%s\n' '{"tree":{"sha":"tree-current"}}'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/commits/tip-after-retry" ]]; then
  printf '%s\n' '{"tree":{"sha":"tree-after-retry"}}'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/trees/tree-current" ]]; then
  printf '%s\n' '{"tree":[{"path":"signal.json","sha":"blob-current"}]}'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/trees/tree-after-retry" ]]; then
  printf '%s\n' '{"tree":[{"path":"signal.json","sha":"blob-after-retry"}]}'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/blobs/blob-current" ]]; then
  content="$(base64 < "${GH_PAYLOAD_CURRENT_FILE:?}" | tr -d '\n')"
  printf '{"content":"%s"}\n' "$content"
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/blobs/blob-after-retry" ]]; then
  content="$(base64 < "${GH_PAYLOAD_AFTER_RETRY_FILE:?}" | tr -d '\n')"
  printf '{"content":"%s"}\n' "$content"
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/owner/repo/git/ref/heads/main" ]]; then
  printf '%s\n' 'main-head'
  exit 0
fi

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  printf '%s\n' '{"nameWithOwner":"owner/repo","defaultBranchRef":{"name":"main"}}'
  exit 0
fi

if [[ "$*" == api\ --method\ POST\ repos/owner/repo/git/blobs\ --input* ]]; then
  printf '%s\n' 'blob-new'
  exit 0
fi

if [[ "$*" == api\ --method\ POST\ repos/owner/repo/git/trees\ --input* ]]; then
  printf '%s\n' 'tree-new'
  exit 0
fi

if [[ "$*" == api\ --method\ POST\ repos/owner/repo/git/commits\ --input* ]]; then
  printf '%s\n' 'commit-new'
  exit 0
fi

if [[ "$*" == api\ --method\ PATCH\ repos/owner/repo/git/refs/openspec-buddy/cache-signal* ]]; then
  count_file="${GH_PATCH_COUNT_FILE:?}"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(cat "$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if [[ "$count" == "1" ]]; then
    echo "Reference update failed" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$*" == api\ --method\ POST\ repos/owner/repo/git/refs* ]]; then
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

cat > "$tmp_dir/payload-current.json" <<'JSON'
{
  "version": 2,
  "sequence": 42,
  "generation": 42,
  "event": { "sequence": 42, "kind": "set-status", "scopes": ["ready-scan"] },
  "recentEvents": [
    { "sequence": 41, "kind": "claim", "scopes": ["issue:12"] },
    { "sequence": 42, "kind": "set-status", "scopes": ["ready-scan"] }
  ]
}
JSON

cat > "$tmp_dir/payload-after-retry.json" <<'JSON'
{
  "version": 2,
  "sequence": 44,
  "generation": 44,
  "event": { "sequence": 44, "kind": "mark-review", "scopes": ["issue:99", "project"] },
  "recentEvents": [
    { "sequence": 43, "kind": "claim", "scopes": ["issue:88"] },
    { "sequence": 44, "kind": "mark-review", "scopes": ["issue:99", "project"] }
  ]
}
JSON

cache_dir="$project_root/openspec/.buddy-cache"
mkdir -p "$cache_dir/issues" "$cache_dir/relationships" "$cache_dir/locks"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"signal","repo":"owner/repo","objectType":"signal-state","key":"state","data":{"tipSha":"old-tip","sequence":41,"generation":41}}' > "$cache_dir/signal-state.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"issue","key":"12","data":{"number":12,"state":"OPEN","labels":[{"name":"status:ready"}]}}' > "$cache_dir/issues/12.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"relationship","key":"ready-scan-limit-25","data":[]}' > "$cache_dir/relationships/ready-scan-limit-25.json"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export GH_REF_COUNT_FILE="$tmp_dir/ref-count.txt"
export GH_PATCH_COUNT_FILE="$tmp_dir/patch-count.txt"
export GH_PAYLOAD_CURRENT_FILE="$tmp_dir/payload-current.json"
export GH_PAYLOAD_AFTER_RETRY_FILE="$tmp_dir/payload-after-retry.json"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_CACHE_SIGNAL_REF="refs/openspec-buddy/cache-signal"
export OPENSPEC_BUDDY_SIGNAL_LOCK_TTL_SECONDS=1

bash -c '
  source "'"$repo_root"'/skills/openspec-buddy/scripts/cache-signal.sh"
  buddy_signal_apply "'"$cache_dir"'" owner/repo
'

if [[ ! -e "$cache_dir/issues/12.json" ]]; then
  echo "buddy_signal_apply should not invalidate unrelated issue scope when wrapped state sequence already covers it" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/ready-scan-limit-25.json" ]]; then
  echo "buddy_signal_apply should invalidate ready-scan for new wrapped-state payload scope" >&2
  exit 1
fi

mkdir -p "$cache_dir/locks/signal-publish.lock.d"
touch -t 202001010000 "$cache_dir/locks/signal-publish.lock.d"

bash -c '
  source "'"$repo_root"'/skills/openspec-buddy/scripts/cache-signal.sh"
  buddy_signal_publish mark-review "issue:99" "project"
'

if [[ -d "$cache_dir/locks/signal-publish.lock.d" ]]; then
  echo "buddy_signal_publish should clean up stale publish lock" >&2
  exit 1
fi

if [[ "$(cat "$GH_PATCH_COUNT_FILE")" != "2" ]]; then
  echo "buddy_signal_publish should retry ref update after a retryable failure" >&2
  exit 1
fi

if ! node -e '
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if ((state.data?.sequence || 0) !== 45) process.exit(1);
if ((state.data?.tipSha || "") !== "commit-new") process.exit(2);
' "$cache_dir/signal-state.json"; then
  echo "buddy_signal_publish should persist wrapped signal state after retry" >&2
  exit 1
fi

echo "cache-signal tests passed"
