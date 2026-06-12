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
  "api rate_limit")
    cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
    ;;
  "api graphql")
    printf 'api graphql\n' >> "$GH_CALL_LOG"
    previous=''
    for arg in "$@"; do
      if [[ "$previous" == "-f" && "$arg" == query=* ]]; then
        printf '%s' "${arg#query=}" > "$GH_QUERY_FILE"
      fi
      previous="$arg"
    done
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
export GH_QUERY_FILE="$tmp_dir/query.graphql"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1

output="$("$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" --require-parent 100 101 101)"
[[ "$output" == "Issue relationships verified." ]]

api_calls="$(grep -c '^api graphql$' "$GH_CALL_LOG")"
[[ "$api_calls" == "1" ]]

grep -q 'issue0: issue(number: 100)' "$GH_QUERY_FILE"
grep -q 'issue1: issue(number: 101)' "$GH_QUERY_FILE"
if grep -q 'issue2:' "$GH_QUERY_FILE"; then
  echo "duplicate issue was not deduplicated" >&2
  exit 1
fi

echo "verify issue relationships wrapper eval passed"
