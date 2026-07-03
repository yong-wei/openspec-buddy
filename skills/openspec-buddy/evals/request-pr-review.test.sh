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
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'EOF'
#!/bin/bash
set -euo pipefail

if [[ "${1:-}" == "-C" ]]; then
  shift 2
fi

case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then
      printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"
      exit 0
    fi
    ;;
  branch)
    if [[ "${2:-}" == "--show-current" ]]; then
      printf 'buddy-test-branch\n'
      exit 0
    fi
    ;;
  worktree)
    if [[ "${2:-}" == "list" && "${3:-}" == "--porcelain" ]]; then
      printf 'worktree %s\nHEAD abc123\nbranch refs/heads/buddy-test-branch\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"
      exit 0
    fi
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then
      printf 'https://github.com/opt-de/major.git\n'
      exit 0
    fi
    ;;
esac

echo "unexpected git invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"

if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  cat "${GH_PR_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == */issues/42 ]]; then
  printf '{"number":42,"state":"open","labels":[{"name":"status:claimed"}]}\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/42/comments* ]]; then
  printf '%s\n' '[[{"created_at":"2026-01-01T00:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: @YW\nchange_id: buddy-test-branch\nbranch: buddy-test-branch\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-01-02T00:00:00.000Z"}]]'
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
  "head": { "sha": "head-1", "ref": "buddy-test-branch" },
  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"
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
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should not run reviewThreads GraphQL for a default first request check" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
bash "$helper" 123 --require-threads-resolved
if ! grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh --require-threads-resolved should run the review thread gate" >&2
  exit 1
fi

cat > "$tmp_dir/force-review-context.md" <<'EOF'
本轮是 review wait retry，请基于当前 head 重新审查。
- 当前 head: head-1
- 触发原因: 等待窗口内未观察到当前 head 的 clean Codex review。
EOF
export GH_COMMENTS_FILE="$tmp_dir/comments-present.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-force.log"
bash "$helper" 123 --force --context-file "$tmp_dir/force-review-context.md"
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh --force did not post the configured review request" >&2
  exit 1
fi
if ! grep -F -- "本轮是 review wait retry" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh --force did not append the retry context file" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2
  exit 1
fi

cat > "$tmp_dir/comments-clear.json" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:03:00Z",
    "html_url": "https://example.test/pr/123#issuecomment-request"
  },
  {
    "user": { "login": "chatgpt-codex-connector[bot]" },
    "body": "Codex Review: Didn't find any major issues.",
    "created_at": "2026-01-01T00:04:00Z",
    "html_url": "https://example.test/pr/123#issuecomment-clear"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-clear.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-already-clear.log"
: > "$GH_LOG_FILE"
rm -f "$GH_COMMENT_LOG_FILE"
bash "$helper" 123 --force --context-file "$tmp_dir/force-review-context.md" > "$tmp_dir/already-clear.out"
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "request-pr-review.sh --force must not post when current head is already clear" >&2
  exit 1
fi
if ! grep -F 'PR review already clear' "$tmp_dir/already-clear.out" >/dev/null; then
  echo "request-pr-review.sh did not report already-clear gate" >&2
  cat "$tmp_dir/already-clear.out" >&2
  exit 1
fi
if ! grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should verify reviewThreads before accepting a clear comment" >&2
  exit 1
fi

cat > "$tmp_dir/reviews-clear.json" <<JSON
[
  {
    "user": { "login": "chatgpt-codex-connector[bot]" },
    "state": "COMMENTED",
    "body": "Codex Review: Didn't find any major issues.",
    "commit_id": "head-1",
    "submitted_at": "2026-01-01T00:04:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-present.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-clear.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-already-clear-review.log"
: > "$GH_LOG_FILE"
rm -f "$GH_COMMENT_LOG_FILE"
bash "$helper" 123 --force --context-file "$tmp_dir/force-review-context.md" > "$tmp_dir/already-clear-review.out"
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "request-pr-review.sh --force must not post when current head already has a clear review" >&2
  exit 1
fi
if ! grep -F 'PR review already clear' "$tmp_dir/already-clear-review.out" >/dev/null; then
  echo "request-pr-review.sh did not report already-clear review gate" >&2
  cat "$tmp_dir/already-clear-review.out" >&2
  exit 1
fi
if ! grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should verify reviewThreads before accepting a clear review" >&2
  exit 1
fi

cat > "$tmp_dir/reviews-approved.json" <<JSON
[
  {
    "user": { "login": "chatgpt-codex-connector[bot]" },
    "state": "APPROVED",
    "body": "",
    "commit_id": "head-1",
    "submitted_at": "2026-01-01T00:04:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-present.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-approved.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-approved-clear-review.log"
: > "$GH_LOG_FILE"
rm -f "$GH_COMMENT_LOG_FILE"
bash "$helper" 123 --force --context-file "$tmp_dir/force-review-context.md" > "$tmp_dir/approved-clear-review.out"
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "request-pr-review.sh --force must not post when current head already has an approved review" >&2
  exit 1
fi
if ! grep -F 'PR review already clear' "$tmp_dir/approved-clear-review.out" >/dev/null; then
  echo "request-pr-review.sh did not report already-clear approved review gate" >&2
  cat "$tmp_dir/approved-clear-review.out" >&2
  exit 1
fi
if ! grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh should verify reviewThreads before accepting an approved review" >&2
  exit 1
fi

cat > "$tmp_dir/comments-newer-request.json" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:05:00Z",
    "html_url": "https://example.test/pr/123#issuecomment-newer-request"
  }
]
JSON
cat > "$tmp_dir/reviews-stale-clear.json" <<JSON
[
  {
    "user": { "login": "chatgpt-codex-connector[bot]" },
    "state": "COMMENTED",
    "body": "Codex Review: Didn't find any major issues.",
    "commit_id": "head-1",
    "submitted_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-newer-request.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-stale-clear.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-stale-clear-review.log"
: > "$GH_LOG_FILE"
rm -f "$GH_COMMENT_LOG_FILE"
bash "$helper" 123 --force --context-file "$tmp_dir/force-review-context.md" > "$tmp_dir/stale-clear-review.out"
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh must request review when the clear review is older than the latest request" >&2
  cat "$tmp_dir/stale-clear-review.out" >&2
  exit 1
fi
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh must not run reviewThreads GraphQL for a stale clear review candidate" >&2
  exit 1
fi
export GH_REVIEWS_FILE="$tmp_dir/reviews-empty.json"

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

cat > "$tmp_dir/review-fix-context.md" <<'EOF'
本轮是 review-fix follow-up，请重点检查：
- 当前 head: head-1
- 已处理的 review thread: THREAD_1
- 修复提交: head-1
- same-thread evidence reply 已写入
- review-response-gate 已确认线程 resolved
EOF
export GH_COMMENTS_FILE="$tmp_dir/comments-missing.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-context.log"
bash "$helper" 123 --context-file "$tmp_dir/review-fix-context.md"
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh context request omitted the configured review request" >&2
  exit 1
fi
if ! grep -F -- "本轮是 review-fix follow-up" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not append the review-fix context file" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2
  exit 1
fi

cat > "$tmp_dir/pr-head-2.json" <<JSON
{
  "head": { "sha": "head-2", "ref": "buddy-test-branch" },
  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"
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

cat > "$tmp_dir/commits-unknown-head-time.json" <<JSON
[
  {
    "sha": "head-2",
    "commit": {}
  }
]
JSON
export GH_COMMITS_FILE="$tmp_dir/commits-unknown-head-time.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-stale.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-unknown-head.log"
bash "$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh must refresh the request when the current head time is unknown" >&2
  exit 1
fi

cat > "$tmp_dir/commits-missing-current-head.json" <<JSON
[
  {
    "sha": "head-1",
    "commit": {
      "committer": { "date": "2026-01-01T00:02:00Z" }
    }
  }
]
JSON
export GH_COMMITS_FILE="$tmp_dir/commits-missing-current-head.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-stale.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-missing-current-head.log"
bash "$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh must refresh the request when the current head commit is missing from REST commits" >&2
  exit 1
fi

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
bash "$helper" 123 --require-threads-resolved > "$tmp_dir/unresolved.out" 2> "$tmp_dir/unresolved.err"
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
