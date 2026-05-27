#!/usr/bin/env bash
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

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'if [[ "$1" == "pr" && "$2" == "view" ]]; then' \
  '  cat "${GH_PR_VIEW_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "pr" && "$2" == "comment" ]]; then' \
  '  printf "%s\n" "$*" >> "${GH_LOG_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then' \
  '  cat "${GH_PR_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/commits* ]]; then' \
  '  cat "${GH_COMMITS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */issues/123/comments* ]]; then' \
  '  cat "${GH_COMMENTS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'echo "unexpected gh invocation: $*" >&2' \
  'exit 99' \
  > "$tmp_dir/gh"
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
export GH_PR_FILE="$tmp_dir/pr.json"
export GH_PR_VIEW_FILE="$tmp_dir/pr-view-fallback.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-1.json"
printf '{}\n' > "$GH_PR_VIEW_FILE"

cat > "$tmp_dir/comments-present.txt" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-present.txt"
export GH_LOG_FILE="$tmp_dir/present.log"
"$helper" 123
if [[ -e "$GH_LOG_FILE" ]]; then
  echo "request-pr-review.sh posted a duplicate review request" >&2
  exit 1
fi

cat > "$tmp_dir/comments-missing.txt" <<JSON
[]
JSON
export GH_COMMENTS_FILE="$tmp_dir/comments-missing.txt"
export GH_LOG_FILE="$tmp_dir/missing.log"
"$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not post the configured review request" >&2
  exit 1
fi

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
cat > "$tmp_dir/comments-stale.txt" <<JSON
[
  {
    "body": "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST",
    "created_at": "2026-01-01T00:03:00Z"
  }
]
JSON
export GH_PR_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"
export GH_COMMENTS_FILE="$tmp_dir/comments-stale.txt"
export GH_LOG_FILE="$tmp_dir/stale.log"
"$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not refresh a stale review request after the current head" >&2
  exit 1
fi

echo "request-pr-review tests passed"
