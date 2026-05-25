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

cat > "$tmp_dir/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  cat "${GH_COMMENTS_FILE:?}"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "comment" ]]; then
  printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
SH
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"

printf '%s\n' "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" > "$tmp_dir/comments-present.txt"
export GH_COMMENTS_FILE="$tmp_dir/comments-present.txt"
export GH_LOG_FILE="$tmp_dir/present.log"
"$helper" 123
if [[ -e "$GH_LOG_FILE" ]]; then
  echo "request-pr-review.sh posted a duplicate review request" >&2
  exit 1
fi

: > "$tmp_dir/comments-missing.txt"
export GH_COMMENTS_FILE="$tmp_dir/comments-missing.txt"
export GH_LOG_FILE="$tmp_dir/missing.log"
"$helper" 123
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_LOG_FILE" >/dev/null; then
  echo "request-pr-review.sh did not post the configured review request" >&2
  exit 1
fi

echo "request-pr-review tests passed"
