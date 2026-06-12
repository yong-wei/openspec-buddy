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

printf '%s\n' "$*" >> "$GH_CALL_LOG"

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  printf 'owner/repo\n'
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "list" ]]; then
  if [[ "$*" == *"body"* ]]; then
    echo "unknown json field: body" >&2
    exit 1
  fi
  cat <<'JSON'
[
  {
    "number": 11,
    "title": "Ready change",
    "url": "https://example.test/issues/11",
    "state": "OPEN",
    "labels": [
      { "name": "status: ready" },
      { "name": "series:alpha" }
    ]
  },
  {
    "number": 12,
    "title": "Tracking parent",
    "url": "https://example.test/issues/12",
    "state": "OPEN",
    "labels": [
      { "name": "type:series-parent" },
      { "name": "status:tracking" }
    ]
  }
]
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "view" && "$3" == "11" ]]; then
  if [[ "$*" == *"--jq .body"* ]]; then
    cat <<'BODY'
---
change_id: ready-change
claim_branch: ready-change
series: alpha
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/ready-change
risk: medium
area: demo
---
BODY
  else
    cat <<'JSON'
{"body":"---\nchange_id: ready-change\nclaim_branch: ready-change\nseries: alpha\ncoupling_group: none\nexecution_mode: isolated\nbase_branch: integration\ndepends_on: []\nopenspec_path: openspec/changes/ready-change\nrisk: medium\narea: demo\n---\n"}
JSON
  fi
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  previous=''
  for arg in "$@"; do
    if [[ "$previous" == "-f" && "$arg" == query=* ]]; then
      printf '%s' "${arg#query=}" > "$GH_GRAPHQL_QUERY_FILE"
    fi
    previous="$arg"
  done
  cat <<'JSON'
{"data":{"repository":{"issue0":{"id":"I_11","number":11,"title":"Ready change","url":"https://example.test/issues/11","state":"OPEN","labels":{"nodes":[{"name":"status:ready"},{"name":"series:alpha"}]},"parent":null,"subIssues":{"nodes":[]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]}}}}}
JSON
  exit 0
fi

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
  exit 0
fi

echo "unexpected gh command: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_CALL_LOG="$tmp_dir/gh.log"
export GH_GRAPHQL_QUERY_FILE="$tmp_dir/query.graphql"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$tmp_dir/cache-first"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1

output="$("$repo_root/skills/openspec-buddy/scripts/list-ready-change-relationships.sh" 50)"

if [[ "$output" != *'"number": 11'* ]]; then
  echo "expected ready issue in output" >&2
  exit 1
fi

OUTPUT_JSON="$output" node -e '
const payload = JSON.parse(process.env.OUTPUT_JSON);
const ready = payload.issues.find((issue) => issue.number === 11);
if (!ready || !String(ready.body || "").includes("change_id: ready-change")) {
  process.stderr.write("expected candidate body fallback to populate parseable front matter\n");
  process.exit(1);
}
'

if grep -F 'issue view 12' "$GH_CALL_LOG" >/dev/null; then
  echo "should not fetch body for prefiltered tracking parent" >&2
  exit 1
fi

if ! grep -F 'issue view 11 --json body' "$GH_CALL_LOG" >/dev/null; then
  echo "expected body fallback for candidate issue" >&2
  exit 1
fi

if ! grep -F 'issue list --state open --limit 50 --json number,title,url,state,labels,body' "$GH_CALL_LOG" >/dev/null; then
  echo "expected initial issue list attempt with body field" >&2
  exit 1
fi

if ! grep -F 'issue list --state open --limit 50 --json number,title,url,state,labels' "$GH_CALL_LOG" >/dev/null; then
  echo "expected fallback issue list call without body field" >&2
  exit 1
fi

if ! grep -q 'issue0: issue(number: 11)' "$GH_GRAPHQL_QUERY_FILE"; then
  echo "expected GraphQL relationship query only for filtered candidate issue" >&2
  exit 1
fi

if grep -q 'issue(number: 12)' "$GH_GRAPHQL_QUERY_FILE"; then
  echo "should not query relationships for prefiltered tracking parent" >&2
  exit 1
fi

batch_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir" "$batch_dir"' EXIT

cat > "$batch_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_CALL_LOG"

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  printf 'owner/repo\n'
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "list" ]]; then
  python3 - <<'PY'
import json
issues = []
for number in range(1, 31):
    issues.append({
        "number": number,
        "title": f"Ready change {number}",
        "url": f"https://example.test/issues/{number}",
        "state": "OPEN",
        "labels": [{"name": "status:ready"}],
        "body": "\n".join([
            "---",
            f"change_id: ready-change-{number}",
            f"claim_branch: ready-change-{number}",
            "series: alpha",
            "coupling_group: none",
            "execution_mode: isolated",
            "base_branch: integration",
            "depends_on: []",
            f"openspec_path: openspec/changes/ready-change-{number}",
            "risk: low",
            "area: demo",
            "---",
        ]),
    })
print(json.dumps(issues))
PY
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  previous=''
  query=''
  for arg in "$@"; do
    if [[ "$previous" == "-f" && "$arg" == query=* ]]; then
      query="${arg#query=}"
    fi
    previous="$arg"
  done
  printf '%s\n---QUERY---\n' "$query" >> "$GH_GRAPHQL_QUERY_LOG"
  QUERY_TEXT="$query" python3 - <<'PY'
import json
import os
import re

query = os.environ["QUERY_TEXT"]
matches = re.findall(r'issue(\d+): issue\(number: (\d+)\)', query)
payload = {"data": {"repository": {}}}
for alias, number in matches:
    number = int(number)
    payload["data"]["repository"][f"issue{alias}"] = {
        "id": f"I_{number}",
        "number": number,
        "title": f"Ready change {number}",
        "url": f"https://example.test/issues/{number}",
        "state": "OPEN",
        "labels": {"nodes": [{"name": "status:ready"}]},
        "parent": None,
        "subIssues": {"nodes": []},
        "blockedBy": {"nodes": []},
        "blocking": {"nodes": []},
    }
print(json.dumps(payload))
PY
  exit 0
fi

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
  exit 0
fi

echo "unexpected gh command: $*" >&2
exit 1
EOF
chmod +x "$batch_dir/gh"

GH_CALL_LOG="$batch_dir/gh.log" \
GH_GRAPHQL_QUERY_LOG="$batch_dir/graphql.log" \
OPENSPEC_BUDDY_GH_CACHE_DIR="$batch_dir/cache-second" \
OPENSPEC_BUDDY_DISABLE_SIGNAL=1 \
PATH="$batch_dir:$PATH" \
  "$repo_root/skills/openspec-buddy/scripts/list-ready-change-relationships.sh" 100 > "$batch_dir/output.json"

if ! grep -F '"number": 30' "$batch_dir/output.json" >/dev/null; then
  echo "expected batched run to include high-number candidate issue" >&2
  exit 1
fi

batch_graphql_calls="$(grep -c '^api graphql' "$batch_dir/gh.log" | tr -d ' ')"
if [[ "$batch_graphql_calls" != "2" ]]; then
  echo "expected two GraphQL batches for 30 candidate issues" >&2
  exit 1
fi

echo "list-ready-change-relationships tests passed"
