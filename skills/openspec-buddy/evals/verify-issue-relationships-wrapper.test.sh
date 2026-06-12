#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
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

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
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
        printf '%s\n---\n' "${arg#query=}" >> "$GH_QUERY_FILE"
      fi
      previous="$arg"
    done
    python3 - "$@" <<'PY'
import json
import re
import sys

query = ""
args = sys.argv[1:]
for i, arg in enumerate(args):
    if arg == "-f" and i + 1 < len(args) and args[i + 1].startswith("query="):
        query = args[i + 1][6:]
        break

numbers = [int(match) for match in re.findall(r'issue\d+: issue\(number: (\d+)\)', query)]
repository = {}
for index, number in enumerate(numbers):
    repository[f"issue{index}"] = {
        "number": number,
        "labels": {"nodes": [{"name": "type:change"}]},
        "subIssues": {"nodes": []},
        "blockedBy": {"nodes": []},
        "blocking": {"nodes": []},
    }
print(json.dumps({"data": {"repository": repository}}))
PY
    ;;
  *)
    echo "unexpected gh command: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp_dir/gh"
: > "$GH_CALL_LOG"
: > "$GH_QUERY_FILE"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-batch"

refs=()
for number in $(seq 1 30); do
  refs+=("$number")
done

output="$("$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" "${refs[@]}")"
[[ "$output" == "Issue relationships verified." ]]

api_calls="$(grep -c '^api graphql$' "$GH_CALL_LOG")"
if [[ "$api_calls" != "2" ]]; then
  echo "expected batched GraphQL calls for 30 issues" >&2
  exit 1
fi

if ! grep -q 'issue24: issue(number: 25)' "$GH_QUERY_FILE"; then
  echo "expected first batch to include issue 25" >&2
  exit 1
fi

if grep -q 'issue25: issue(number: 26)' "$GH_QUERY_FILE"; then
  echo "expected first batch to stop at 25 issues" >&2
  exit 1
fi

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1 $2" in
  "repo view")
    printf 'owner/repo\n'
    ;;
  "api rate_limit")
    printf '%s\n' '{"remaining":0,"resetAt":"2026-06-12T00:30:00Z"}'
    ;;
  "api graphql")
    echo "graphql should not run when remaining quota is below threshold" >&2
    exit 99
    ;;
  *)
    echo "unexpected gh command: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp_dir/gh"
: > "$GH_CALL_LOG"
: > "$GH_QUERY_FILE"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-low-budget"

set +e
"$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" 1 >"$tmp_dir/low-budget.out" 2>"$tmp_dir/low-budget.err"
low_budget_status="$?"
set -e

if [[ "$low_budget_status" -eq 0 ]]; then
  echo "expected low GraphQL budget to fail before executing graphql" >&2
  exit 1
fi

if ! grep -E 'below (threshold|required minimum)' "$tmp_dir/low-budget.err" >/dev/null; then
  echo "expected low GraphQL budget diagnostic" >&2
  cat "$tmp_dir/low-budget.err" >&2
  exit 1
fi

if grep -F 'api graphql' "$GH_CALL_LOG" >/dev/null; then
  echo "GraphQL should not execute when budget guard fails" >&2
  exit 1
fi

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1 $2" in
  "repo view")
    printf 'owner/repo\n'
    ;;
  "api rate_limit")
    printf '%s\n' '{"remaining":300,"resetAt":"2026-06-12T00:30:00Z"}'
    ;;
  "api graphql")
    echo "graphql should not run when remaining quota cannot cover all GraphQL batches" >&2
    exit 99
    ;;
  *)
    echo "unexpected gh command: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp_dir/gh"
: > "$GH_CALL_LOG"
: > "$GH_QUERY_FILE"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-batch-low-budget"

set +e
"$repo_root/skills/openspec-buddy/scripts/verify-issue-relationships.sh" "${refs[@]}" >"$tmp_dir/batch-low-budget.out" 2>"$tmp_dir/batch-low-budget.err"
batch_low_budget_status="$?"
set -e

if [[ "$batch_low_budget_status" -eq 0 ]]; then
  echo "expected multi-batch GraphQL reads to fail before execution when remaining quota cannot cover all batches" >&2
  exit 1
fi

if ! grep -F 'below required minimum 301' "$tmp_dir/batch-low-budget.err" >/dev/null; then
  echo "expected multi-batch low GraphQL budget diagnostic" >&2
  cat "$tmp_dir/batch-low-budget.err" >&2
  exit 1
fi

if grep -F 'api graphql' "$GH_CALL_LOG" >/dev/null; then
  echo "GraphQL batch reads should not execute when budget cannot cover all batches" >&2
  exit 1
fi

echo "verify issue relationships wrapper eval passed"
