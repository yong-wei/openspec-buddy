#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/request-pr-review.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=opt-de
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1
export OPENSPEC_BUDDY_CACHE_DIR="$tmp_dir/cache"

cat > "$tmp_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"

if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  cat "${GH_PR_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/commits* ]]; then
  printf '['
  cat "${GH_COMMITS_FILE:?}"
  printf ']'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/123/comments* ]]; then
  printf '['
  cat "${GH_COMMENTS_FILE:?}"
  printf ']'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/reviews* ]]; then
  printf '['
  cat "${GH_REVIEWS_FILE:?}"
  printf ']'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/comments* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/commits* ]]; then
  cat "${GH_COMMITS_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == */issues/123/comments* ]]; then
  cat "${GH_COMMENTS_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/reviews* ]]; then
  cat "${GH_REVIEWS_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/comments* ]]; then
  printf "[]\n"
  exit 0
fi
if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '{"remaining":1000,"resetAt":"2026-06-22T00:00:00Z"}\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  cat "${GH_THREADS_FILE:?}"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "comment" ]]; then
  printf '%s\n' "$*" >> "${GH_COMMENT_LOG_FILE:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"

cat > "$tmp_dir/pr.json" <<JSON
{
  "head": { "sha": "head-1" }
}
JSON
cat > "$tmp_dir/commits-head-1.json" <<JSON
[
  {
    "sha": "head-1",
    "commit": {
      "committer": { "date": "2026-01-01T00:02:00Z" }
    }
  }
]
JSON
printf '[]\n' > "$tmp_dir/reviews-empty.json"

export GH_PR_FILE="$tmp_dir/pr.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-1.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-empty.json"
export GH_LOG_FILE="$tmp_dir/gh.log"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment.log"
cat > "$tmp_dir/threads-empty.json" <<JSON
{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}
JSON
export GH_THREADS_FILE="$tmp_dir/threads-empty.json"

cat > "$tmp_dir/comments-present.json" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-present.json"
bash "$helper" 123
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "request-pr-review.sh posted a duplicate review request" >&2
  exit 1
fi
if grep -F 'verify-review-clear' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should not invoke verify-review-clear helper" >&2
  exit 1
fi
if ! grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should run the review thread gate before deciding on review requests" >&2
  exit 1
fi

cat > "$tmp_dir/comments-missing.json" <<JSON
[]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-missing.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-missing.log"
bash "$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not post the configured review request" >&2
  exit 1
fi
for cache_file in \
  "$OPENSPEC_BUDDY_CACHE_DIR/pr-rest-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/reviews-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/commits-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/issue-comments-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/review-comments-123.json"; do
  if [[ -e "$cache_file" ]]; then
    echo "request-pr-review.sh should invalidate PR REST bundle cache after posting a review request" >&2
    exit 1
  fi
done

cat > "$tmp_dir/pr-head-2.json" <<JSON
{
  "head": { "sha": "head-2" }
}
JSON
cat > "$tmp_dir/commits-head-2.json" <<JSON
[
  {
    "sha": "head-2",
    "commit": {
      "committer": { "date": "2026-01-01T00:05:00Z" }
    }
  }
]
JSON
cat > "$tmp_dir/comments-stale.json" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_PR_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-stale.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-stale.log"
bash "$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not refresh a stale review request after the current head" >&2
  exit 1
fi
for cache_file in \
  "$OPENSPEC_BUDDY_CACHE_DIR/pr-rest-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/reviews-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/commits-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/issue-comments-123.json" \
  "$OPENSPEC_BUDDY_CACHE_DIR/review-comments-123.json"; do
  if [[ -e "$cache_file" ]]; then
    echo "request-pr-review.sh should invalidate stale PR REST bundle cache after posting a refreshed review request" >&2
    exit 1
  fi
done

cat > "$tmp_dir/threads-unresolved.json" <<JSON
{
  "data": {
    "repository": {
      "pullRequest": {
        "reviewThreads": {
          "nodes": [
            {
              "id": "THREAD_1",
              "isResolved": false,
              "path": "src/demo.js",
              "line": 12,
              "comments": {
                "nodes": [
                  {
                    "author": { "login": "chatgpt-codex-connector" },
                    "body": "P1: still broken",
                    "url": "https://example.test/thread"
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}
JSON
export GH_THREADS_FILE="$tmp_dir/threads-unresolved.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-unresolved.log"
set +e
bash "$helper" 123 > "$tmp_dir/unresolved.out" 2> "$tmp_dir/unresolved.err"
unresolved_status="$?"
set -e
if [[ "$unresolved_status" -eq 0 ]]; then
  echo "request-pr-review.sh should fail before requesting review when actionable threads are unresolved" >&2
  exit 1
fi
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "request-pr-review.sh must not post a review request when review threads are unresolved" >&2
  exit 1
fi
if ! grep -F 'Unresolved actionable Codex review threads exist' "$tmp_dir/unresolved.err" >/dev/null; then
  echo "request-pr-review.sh did not surface the review-response-gate failure" >&2
  cat "$tmp_dir/unresolved.err" >&2
  exit 1
fi

echo "request-pr-review tests passed"
