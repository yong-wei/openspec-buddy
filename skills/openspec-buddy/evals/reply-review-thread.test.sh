#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/reply-review-thread.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy"
export OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING=0
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'EOF'
#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then shift 2; fi
case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/yong-wei/openspec-buddy.git\n'; exit 0; fi
    ;;
esac
exit 99
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"
if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  printf '{"number":123,"head":{"sha":"headabc123","ref":"buddy-test-branch"}}\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '{"remaining":1000,"resetAt":"2026-06-22T00:00:00Z"}\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  if grep -F 'addPullRequestReviewThreadReply' <<<"$*" >/dev/null; then
    if grep -F 'pullRequestReviewThread {' <<<"$*" >/dev/null; then
      echo "unsupported field pullRequestReviewThread" >&2
      exit 1
    fi
    printf '{"data":{"addPullRequestReviewThreadReply":{"comment":{"id":"COMMENT_1","url":"https://example.test/comment"}}}}\n'
  else
    cat "${THREADS_FILE:?}"
  fi
  exit 0
fi
exit 99
EOF
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"

cat > "$tmp_dir/threads.json" <<'JSON'
{
  "data": {
    "repository": {
      "pullRequest": {
        "reviewThreads": {
          "nodes": [
            {
              "id": "THREAD_1",
              "isResolved": false,
              "comments": { "nodes": [] }
            }
          ]
        }
      }
    }
  }
}
JSON
export THREADS_FILE="$tmp_dir/threads.json"

cat > "$tmp_dir/reply.md" <<'EOF'
Fixed in headabc123.

Verification: npm test passed.
EOF

"$helper" 123 THREAD_1 --head headabc123 --body-file "$tmp_dir/reply.md" > "$tmp_dir/success.out"
grep -F 'https://example.test/comment' "$tmp_dir/success.out" >/dev/null

set +e
"$helper" 123 THREAD_1 --head stalehead --body-file "$tmp_dir/reply.md" > "$tmp_dir/stale.out" 2> "$tmp_dir/stale.err"
stale_status="$?"
set -e
if [[ "$stale_status" -eq 0 ]]; then
  echo "reply-review-thread.sh should reject a stale head" >&2
  exit 1
fi
grep -F 'does not match current PR head' "$tmp_dir/stale.err" >/dev/null

set +e
"$helper" 123 THREAD_FOREIGN --head headabc123 --body-file "$tmp_dir/reply.md" > "$tmp_dir/foreign.out" 2> "$tmp_dir/foreign.err"
foreign_status="$?"
set -e
if [[ "$foreign_status" -eq 0 ]]; then
  echo "reply-review-thread.sh should reject a thread outside the current PR" >&2
  exit 1
fi
grep -F 'was not found on the current PR' "$tmp_dir/foreign.err" >/dev/null

echo "reply-review-thread tests passed"
