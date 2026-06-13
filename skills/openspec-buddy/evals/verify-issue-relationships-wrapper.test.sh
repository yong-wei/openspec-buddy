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

case "$1 $2" in
  "repo view")
    printf 'owner/repo\n'
    ;;
  "issue view")
    number="${3##*/}"
    cat <<JSON
{"number":$number,"labels":[],"projectItems":[]}
JSON
    ;;
  "api rate_limit")
    cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
    ;;
  "api graphql")
    count=0
    if [[ -f "$GH_CALL_COUNT_FILE" ]]; then
      count="$(cat "$GH_CALL_COUNT_FILE")"
    fi
    count="$((count + 1))"
    printf '%s' "$count" > "$GH_CALL_COUNT_FILE"
    printf 'api graphql %s\n' "$count" >> "$GH_CALL_LOG"
    previous=''
    for arg in "$@"; do
      if [[ "$previous" == "-f" && "$arg" == query=* ]]; then
        printf '%s' "${arg#query=}" > "$GH_QUERY_DIR/query-$count.graphql"
      fi
      previous="$arg"
    done
    if [[ "${GH_SCENARIO:-base}" == "expand" && "$count" == "1" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":{"number":100,"labels":{"nodes":[{"name":"type:series-parent"},{"name":"series:demo"}]},"subIssues":{"nodes":[{"number":101}]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}},"issue1":{"number":101,"labels":{"nodes":[{"name":"type:change"},{"name":"series:demo"}]},"parent":{"number":100},"subIssues":{"nodes":[]},"blockedBy":{"nodes":[{"number":201,"labels":{"nodes":[{"name":"type:change"},{"name":"series:other"}]}}]},"blocking":{"nodes":[]}}}}}
JSON
      exit 0
    fi
    if [[ "${GH_SCENARIO:-base}" == "missing-expand" && "$count" == "1" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":{"number":100,"labels":{"nodes":[{"name":"type:series-parent"},{"name":"series:demo"}]},"subIssues":{"nodes":[{"number":101}]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}},"issue1":{"number":101,"labels":{"nodes":[{"name":"type:change"},{"name":"series:demo"}]},"parent":{"number":100},"subIssues":{"nodes":[]},"blockedBy":{"nodes":[{"number":201,"labels":{"nodes":[{"name":"type:change"}]}}]},"blocking":{"nodes":[]}}}}}
JSON
      exit 0
    fi
    if [[ "${GH_SCENARIO:-base}" == "expand" && "$count" == "2" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":{"number":201,"labels":{"nodes":[{"name":"type:change"},{"name":"series:other"}]},"parent":{"number":200,"labels":{"nodes":[{"name":"type:series-parent"},{"name":"series:other"}]}},"subIssues":{"nodes":[]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[{"number":101,"labels":{"nodes":[{"name":"type:change"},{"name":"series:demo"}]}}]}}}}}
JSON
      exit 0
    fi
    if [[ "${GH_SCENARIO:-base}" == "missing-expand" && "$count" == "2" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":null}}}
JSON
      exit 0
    fi
    if [[ "${GH_SCENARIO:-base}" == "missing-root" && "$count" == "1" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":null}}}
JSON
      exit 0
    fi
    if [[ "${GH_SCENARIO:-base}" == "expand" && "$count" == "3" ]]; then
      cat <<'JSON'
{"data":{"repository":{"issue0":{"number":200,"labels":{"nodes":[{"name":"type:series-parent"},{"name":"series:other"}]},"subIssues":{"nodes":[{"number":201,"labels":{"nodes":[{"name":"type:change"},{"name":"series:other"}]}}]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}}}}}
JSON
      exit 0
    fi
    cat <<'JSON'
{"data":{"repository":{"issue0":{"number":100,"labels":{"nodes":[{"name":"type:series-parent"},{"name":"series:demo"}]},"subIssues":{"nodes":[{"number":101}]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}},"issue1":{"number":101,"labels":{"nodes":[{"name":"type:change"},{"name":"series:demo"}]},"parent":{"number":100},"subIssues":{"nodes":[]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}}}}}
JSON
    ;;
  *)
    echo "unexpected gh command: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_CALL_LOG="$tmp_dir/gh-calls.log"
export GH_CALL_COUNT_FILE="$tmp_dir/gh-call-count.txt"
export GH_QUERY_DIR="$tmp_dir/queries"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1
mkdir -p "$GH_QUERY_DIR"

output="$("$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 100 101 101)"
[[ "$output" == "Issue relationships verified." ]]

api_calls="$(grep -c '^api graphql ' "$GH_CALL_LOG")"
[[ "$api_calls" == "1" ]]

grep -q 'issue0: issue(number: 100)' "$GH_QUERY_DIR/query-1.graphql"
grep -q 'issue1: issue(number: 101)' "$GH_QUERY_DIR/query-1.graphql"
if grep -q 'issue2:' "$GH_QUERY_DIR/query-1.graphql"; then
  echo "duplicate issue was not deduplicated" >&2
  exit 1
fi

: > "$GH_CALL_LOG"
rm -f "$GH_CALL_COUNT_FILE"
rm -f "$GH_QUERY_DIR"/query-*.graphql
rm -rf "$OPENSPEC_BUDDY_GH_CACHE_DIR"
output="$(GH_SCENARIO=expand "$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 100 101)"
[[ "$output" == "Issue relationships verified." ]]

api_calls="$(grep -c '^api graphql ' "$GH_CALL_LOG")"
[[ "$api_calls" == "3" ]]
grep -q 'issue0: issue(number: 100)' "$GH_QUERY_DIR/query-1.graphql"
grep -q 'issue1: issue(number: 101)' "$GH_QUERY_DIR/query-1.graphql"
grep -q 'issue0: issue(number: 201)' "$GH_QUERY_DIR/query-2.graphql"
grep -q 'issue0: issue(number: 200)' "$GH_QUERY_DIR/query-3.graphql"

: > "$GH_CALL_LOG"
rm -f "$GH_CALL_COUNT_FILE"
rm -f "$GH_QUERY_DIR"/query-*.graphql
rm -rf "$OPENSPEC_BUDDY_GH_CACHE_DIR"
set +e
GH_SCENARIO=missing-expand "$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 100 101 >"$tmp_dir/missing.out" 2>"$tmp_dir/missing.err"
missing_status="$?"
set -e
if [[ "$missing_status" -eq 0 ]]; then
  echo "verify-issue-relationships.sh should fail when an expanded relationship endpoint cannot be fetched" >&2
  exit 1
fi
if ! grep -F '#101 is blocked by #201, but #201 is missing from verification input.' "$tmp_dir/missing.err" >/dev/null; then
  echo "verify-issue-relationships.sh should report a missing verification endpoint when an expanded issue cannot be fetched" >&2
  cat "$tmp_dir/missing.err" >&2
  exit 1
fi
if grep -F 'ENOENT' "$tmp_dir/missing.err" >/dev/null; then
  echo "verify-issue-relationships.sh should not crash when an expanded issue cannot be fetched" >&2
  cat "$tmp_dir/missing.err" >&2
  exit 1
fi

: > "$GH_CALL_LOG"
rm -f "$GH_CALL_COUNT_FILE"
rm -f "$GH_QUERY_DIR"/query-*.graphql
rm -rf "$OPENSPEC_BUDDY_GH_CACHE_DIR"
mkdir -p "$OPENSPEC_BUDDY_GH_CACHE_DIR/relationships" "$OPENSPEC_BUDDY_GH_CACHE_DIR/issues"
printf '%s\n' '{"fetchedAt":"2020-01-01T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-201","data":{"number":201}}' > "$OPENSPEC_BUDDY_GH_CACHE_DIR/relationships/issue-201.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"issue","key":"201","data":{"number":201,"labels":{"nodes":[{"name":"type:change"}]}}}' > "$OPENSPEC_BUDDY_GH_CACHE_DIR/issues/201.json"
set +e
GH_SCENARIO=missing-expand "$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 100 101 >"$tmp_dir/missing-stale.out" 2>"$tmp_dir/missing-stale.err"
missing_stale_status="$?"
set -e
if [[ "$missing_stale_status" -eq 0 ]]; then
  echo "verify-issue-relationships.sh should fail when a stale expanded endpoint cache cannot be refreshed" >&2
  exit 1
fi
if ! grep -F '#101 is blocked by #201, but #201 is missing from verification input.' "$tmp_dir/missing-stale.err" >/dev/null; then
  echo "verify-issue-relationships.sh should not trust stale relationship cache for missing expanded endpoints" >&2
  cat "$tmp_dir/missing-stale.err" >&2
  exit 1
fi

: > "$GH_CALL_LOG"
rm -f "$GH_CALL_COUNT_FILE"
rm -f "$GH_QUERY_DIR"/query-*.graphql
rm -rf "$OPENSPEC_BUDDY_GH_CACHE_DIR"
set +e
GH_SCENARIO=missing-root "$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 999 >"$tmp_dir/missing-root.out" 2>"$tmp_dir/missing-root.err"
missing_root_status="$?"
set -e
if [[ "$missing_root_status" -eq 0 ]]; then
  echo "verify-issue-relationships.sh should fail when an explicit input issue cannot be fetched" >&2
  exit 1
fi
if ! grep -F 'Could not fetch relationship metadata for explicit issue(s): #999.' "$tmp_dir/missing-root.err" >/dev/null; then
  echo "verify-issue-relationships.sh should explain which explicit issue could not be fetched" >&2
  cat "$tmp_dir/missing-root.err" >&2
  exit 1
fi

: > "$GH_CALL_LOG"
rm -f "$GH_CALL_COUNT_FILE"
rm -f "$GH_QUERY_DIR"/query-*.graphql
rm -rf "$OPENSPEC_BUDDY_GH_CACHE_DIR"
mkdir -p "$OPENSPEC_BUDDY_GH_CACHE_DIR/relationships" "$OPENSPEC_BUDDY_GH_CACHE_DIR/issues"
printf '%s\n' '{"fetchedAt":"2020-01-01T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"relationship","key":"issue-999","data":{"number":999}}' > "$OPENSPEC_BUDDY_GH_CACHE_DIR/relationships/issue-999.json"
printf '%s\n' '{"fetchedAt":"2026-06-12T00:00:00Z","source":"graphql","repo":"owner/repo","objectType":"issue","key":"999","data":{"number":999,"labels":{"nodes":[{"name":"type:change"}]}}}' > "$OPENSPEC_BUDDY_GH_CACHE_DIR/issues/999.json"
set +e
GH_SCENARIO=missing-root "$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 999 >"$tmp_dir/missing-root-stale.out" 2>"$tmp_dir/missing-root-stale.err"
missing_root_stale_status="$?"
set -e
if [[ "$missing_root_stale_status" -eq 0 ]]; then
  echo "verify-issue-relationships.sh should fail when a stale explicit issue cache cannot be refreshed" >&2
  exit 1
fi
if ! grep -F 'Could not fetch relationship metadata for explicit issue(s): #999.' "$tmp_dir/missing-root-stale.err" >/dev/null; then
  echo "verify-issue-relationships.sh should not trust stale relationship cache for missing explicit issues" >&2
  cat "$tmp_dir/missing-root-stale.err" >&2
  exit 1
fi

echo "verify issue relationships wrapper eval passed"
