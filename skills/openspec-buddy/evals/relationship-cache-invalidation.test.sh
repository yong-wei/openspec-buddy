#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '%s\n' '{"remaining":500,"resetAt":"2026-06-12T00:30:00Z"}'
  exit 0
fi

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  cat <<'JSON'
{"nameWithOwner":"owner/repo","defaultBranchRef":{"name":"main"}}
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  ref=""
  for arg in "$@"; do
    if [[ "$arg" =~ ^[0-9]+$ ]]; then
      ref="$arg"
    fi
  done
  case "$ref" in
    1) printf '%s\n' '{"id":"ISSUE_1","number":1,"url":"https://github.com/owner/repo/issues/1"}' ;;
    2) printf '%s\n' '{"id":"ISSUE_2","number":2,"url":"https://github.com/owner/repo/issues/2"}' ;;
    9) printf '%s\n' '{"id":"ISSUE_9","number":9,"url":"https://github.com/owner/repo/issues/9"}' ;;
    10) printf '%s\n' '{"id":"ISSUE_10","number":10,"url":"https://github.com/owner/repo/issues/10"}' ;;
    11) printf '%s\n' '{"id":"ISSUE_11","number":11,"url":"https://github.com/owner/repo/issues/11"}' ;;
    *) echo "unexpected issue ref: $ref" >&2; exit 1 ;;
  esac
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  if printf '%s\n' "$*" | grep -F 'addBlockedBy' >/dev/null; then
    printf '%s\n' '{"data":{"addBlockedBy":{"issue":{"number":1,"url":"https://github.com/owner/repo/issues/1"},"blockingIssue":{"number":2,"url":"https://github.com/owner/repo/issues/2"}}}}'
    exit 0
  fi
  if printf '%s\n' "$*" | grep -F 'addSubIssue' >/dev/null; then
    printf '%s\n' '{"data":{"addSubIssue":{"issue":{"number":10,"url":"https://github.com/owner/repo/issues/10"},"subIssue":{"number":11,"url":"https://github.com/owner/repo/issues/11"}}}}'
    exit 0
  fi
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

cache_dir="$tmp_dir/cache"
mkdir -p "$cache_dir/relationships"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-1","data":{"number":1}}' > "$cache_dir/relationships/issue-1.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-2","data":{"number":2}}' > "$cache_dir/relationships/issue-2.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-10","data":{"number":10}}' > "$cache_dir/relationships/issue-10.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-11","data":{"number":11}}' > "$cache_dir/relationships/issue-11.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-99","data":{"number":99}}' > "$cache_dir/relationships/issue-99.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"relationship","key":"ready-scan-limit-25","data":[]}' > "$cache_dir/relationships/ready-scan-limit-25.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"relationship","key":"ready-scan-limit-50","data":[]}' > "$cache_dir/relationships/ready-scan-limit-50.json"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"

"$repo_root/skills/openspec-buddy/scripts/link-issue-dependencies.sh" 1 2 >"$tmp_dir/dependencies.out"

if [[ -e "$cache_dir/relationships/issue-1.json" || -e "$cache_dir/relationships/issue-2.json" ]]; then
  echo "dependency mutation should invalidate affected relationship cache entries" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/ready-scan-limit-25.json" || -e "$cache_dir/relationships/ready-scan-limit-50.json" ]]; then
  echo "dependency mutation should invalidate ready scan caches" >&2
  exit 1
fi

if [[ ! -e "$cache_dir/relationships/issue-99.json" ]]; then
  echo "dependency mutation should not invalidate unrelated relationship cache entries" >&2
  exit 1
fi

printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-10","data":{"number":10}}' > "$cache_dir/relationships/issue-10.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-11","data":{"number":11}}' > "$cache_dir/relationships/issue-11.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-9","data":{"number":9}}' > "$cache_dir/relationships/issue-9.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"rest","repo":"owner/repo","objectType":"relationship","key":"ready-scan-limit-10","data":[]}' > "$cache_dir/relationships/ready-scan-limit-10.json"

"$repo_root/skills/openspec-buddy/scripts/link-issue-parent.sh" 10 11 true >"$tmp_dir/parent.out"

if [[ -e "$cache_dir/relationships/issue-9.json" || -e "$cache_dir/relationships/issue-10.json" || -e "$cache_dir/relationships/issue-11.json" ]]; then
  echo "replace-parent mutation should invalidate old parent, new parent, and child relationship cache entries" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/ready-scan-limit-10.json" ]]; then
  echo "replace-parent mutation should invalidate ready scan caches" >&2
  exit 1
fi

if [[ -e "$cache_dir/relationships/issue-99.json" ]]; then
  echo "replace-parent mutation should invalidate all relationship cache entries to avoid stale old-parent state" >&2
  exit 1
fi

echo "relationship cache invalidation tests passed"
