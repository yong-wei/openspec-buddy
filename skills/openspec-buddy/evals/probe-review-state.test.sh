#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/probe-review-state.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=opt-de
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
export OPENSPEC_BUDDY_CACHE_DIR="$tmp_dir/cache"
export OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD=1
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'GIT'
#!/bin/bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then shift 2; fi
case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/opt-de/major.git\n'; exit 0; fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
GIT
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'GH'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"
if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  cat "${GH_PR_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/commits* ]]; then
  printf '['
  cat "${GH_COMMITS_FILE:?}"
  printf ']\n'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/123/comments* ]]; then
  printf '['
  cat "${GH_COMMENTS_FILE:?}"
  printf ']\n'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/reviews* ]]; then
  printf '['
  cat "${GH_REVIEWS_FILE:?}"
  printf ']\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  echo "probe-review-state.sh must not call GraphQL" >&2
  exit 99
fi
echo "unexpected gh invocation: $*" >&2
exit 99
GH
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"

cat > "$tmp_dir/pr.json" <<'JSON'
{
  "number": 123,
  "state": "open",
  "updated_at": "2026-01-01T00:00:00Z",
  "comments": 1,
  "review_comments": 0,
  "commits": 1,
  "head": { "sha": "head-1", "ref": "buddy-test-branch" }
}
JSON
cat > "$tmp_dir/commits.json" <<'JSON'
[
  { "sha": "head-1", "commit": { "committer": { "date": "2026-01-01T00:00:00Z" } } }
]
JSON
node -e '
const fs = require("node:fs");
fs.writeFileSync(process.argv[1], JSON.stringify([{ body: process.env.OPENSPEC_BUDDY_PR_REVIEW_REQUEST, created_at: "2026-01-01T00:01:00Z" }]));
' "$tmp_dir/comments.json"
export GH_PR_FILE="$tmp_dir/pr.json"
export GH_COMMITS_FILE="$tmp_dir/commits.json"
export GH_COMMENTS_FILE="$tmp_dir/comments.json"
printf '[]\n' > "$tmp_dir/reviews.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews.json"

first_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.pr !== "123") throw new Error("wrong pr");
if (result.head !== "head-1") throw new Error("wrong head");
if (result.requestState !== "present-current-head") throw new Error(`wrong requestState ${result.requestState}`);
' "$first_output"
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "probe-review-state.sh called GraphQL" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
export OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE="$(node -e 'const fs=require("node:fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(JSON.stringify({number:pr.number,state:pr.state,merged:false,head:pr.head.sha,headRefName:pr.head.ref,updatedAt:pr.updated_at,comments:pr.comments,reviewComments:pr.review_comments,commits:pr.commits,reviews:0,latestReviewSubmittedAt:""}));' "$tmp_dir/pr.json")"
export OPENSPEC_BUDDY_REVIEW_PREVIOUS_REQUEST_STATE=present-current-head
export OPENSPEC_BUDDY_REVIEW_REQUESTED_AT=2026-01-01T00:01:00Z
second_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.state !== "waiting") throw new Error(`expected waiting, got ${result.state}`);
if (result.requestState !== "present-current-head") throw new Error("request state was not reused");
' "$second_output"
if grep -E 'commits|issues/123/comments|graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "probe-review-state.sh should reuse request state when signature is unchanged" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
unset OPENSPEC_BUDDY_REVIEW_REQUESTED_AT
export OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_RETRY_COUNT=0
missing_time_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.state !== "waiting") throw new Error(`expected waiting, got ${result.state}`);
if (result.requestState !== "present-current-head") throw new Error("request state was not preserved");
if (result.requestAgeSeconds <= 0) throw new Error("expected requestAgeSeconds to be backfilled");
if (result.retryDue !== true) throw new Error("expected retryDue after backfilled requestedAt");
' "$missing_time_output"
if ! grep -E 'commits|issues/123/comments' "$GH_LOG_FILE" >/dev/null; then
  echo "probe-review-state.sh should fetch comments/commits to backfill missing requestedAt" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi
review_fetch_count="$(grep -c 'pulls/123/reviews' "$GH_LOG_FILE" || true)"
if [[ "$review_fetch_count" -gt 1 || "$(grep -c 'api graphql' "$GH_LOG_FILE" || true)" -gt 0 ]]; then
  echo "probe-review-state.sh should not fetch extra reviews or GraphQL just to backfill requestedAt" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi
unset OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS
unset OPENSPEC_BUDDY_REVIEW_RETRY_COUNT

: > "$GH_LOG_FILE"
cat > "$tmp_dir/reviews-new-only.json" <<'JSON'
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
export GH_REVIEWS_FILE="$tmp_dir/reviews-new-only.json"
review_only_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.state !== "changed") throw new Error(`expected review-only change to be detected, got ${result.state}`);
if (result.clearCandidate !== true) throw new Error("expected review-only clear candidate");
if (result.clearCandidateSource !== "review") throw new Error(`wrong source ${result.clearCandidateSource}`);
' "$review_only_output"
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "probe-review-state.sh must not call GraphQL for review-only detection" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
cat > "$tmp_dir/pr-comment-clear.json" <<'JSON'
{
  "number": 123,
  "state": "open",
  "updated_at": "2026-01-01T00:02:00Z",
  "comments": 2,
  "review_comments": 0,
  "commits": 1,
  "head": { "sha": "head-1", "ref": "buddy-test-branch" }
}
JSON
node -e '
const fs = require("node:fs");
fs.writeFileSync(process.argv[1], JSON.stringify([
  { body: process.env.OPENSPEC_BUDDY_PR_REVIEW_REQUEST, created_at: "2026-01-01T00:01:00Z" },
  { user: { login: "chatgpt-codex-connector[bot]" }, body: "Codex Review: Didn'\''t find any major issues.", created_at: "2026-01-01T00:03:00Z" }
]));
' "$tmp_dir/comments-clear.json"
export GH_PR_FILE="$tmp_dir/pr-comment-clear.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-clear.json"
clear_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.state !== "changed") throw new Error(`expected changed, got ${result.state}`);
if (result.clearCandidate !== true) throw new Error("expected clearCandidate");
if (result.clearCandidateSource !== "top-level-comment") throw new Error(`wrong source ${result.clearCandidateSource}`);
' "$clear_output"
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "probe-review-state.sh must not call GraphQL for clear candidate detection" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
cat > "$tmp_dir/comments-request-only.json" <<JSON
[
  { "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST", "created_at": "2026-01-01T00:01:00Z" }
]
JSON
cat > "$tmp_dir/reviews-approved.json" <<'JSON'
[
  {
    "user": { "login": "chatgpt-codex-connector[bot]" },
    "state": "APPROVED",
    "body": "",
    "commit_id": "head-1",
    "submitted_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-request-only.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-approved.json"
approved_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.clearCandidate !== true) throw new Error("expected approved review candidate");
if (result.clearCandidateSource !== "review") throw new Error(`wrong source ${result.clearCandidateSource}`);
' "$approved_output"

: > "$GH_LOG_FILE"
cat > "$tmp_dir/comments-chinese-clear.json" <<JSON
[
  { "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST", "created_at": "2026-01-01T00:01:00Z" },
  { "user": { "login": "chatgpt-codex-connector[bot]" }, "body": "Codex Review: 没有重大问题。", "created_at": "2026-01-01T00:03:00Z" }
]
JSON
printf '[]\n' > "$tmp_dir/reviews-empty-chinese.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-chinese-clear.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-empty-chinese.json"
chinese_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.clearCandidate !== true) throw new Error("expected Chinese clear comment candidate");
if (result.clearCandidateSource !== "top-level-comment") throw new Error(`wrong source ${result.clearCandidateSource}`);
' "$chinese_output"

: > "$GH_LOG_FILE"
cat > "$tmp_dir/comments-stale-clear.json" <<JSON
[
  { "user": { "login": "chatgpt-codex-connector[bot]" }, "body": "Codex Review: Didn't find any major issues.", "created_at": "2026-01-01T00:03:00Z" },
  { "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST", "created_at": "2026-01-01T00:05:00Z" }
]
JSON
printf '[]\n' > "$tmp_dir/reviews-empty-again.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-stale-clear.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-empty-again.json"
stale_comment_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.clearCandidate !== false) throw new Error("stale top-level clear comment must not be a candidate");
' "$stale_comment_output"

: > "$GH_LOG_FILE"
cat > "$tmp_dir/comments-request-newer.json" <<JSON
[
  { "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST", "created_at": "2026-01-01T00:05:00Z" }
]
JSON
cat > "$tmp_dir/reviews-stale-clear.json" <<'JSON'
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
export GH_COMMENTS_FILE="$tmp_dir/comments-request-newer.json"
export GH_REVIEWS_FILE="$tmp_dir/reviews-stale-clear.json"
stale_review_output="$(bash "$helper" 123)"
node -e '
const result = JSON.parse(process.argv[1]);
if (result.clearCandidate !== false) throw new Error("stale clear review must not be a candidate");
' "$stale_review_output"

echo "probe-review-state tests passed"
