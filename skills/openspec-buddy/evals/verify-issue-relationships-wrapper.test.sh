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

echo "verify issue relationships wrapper eval passed"
