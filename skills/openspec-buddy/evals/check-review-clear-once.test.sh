#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/check-review-clear-once.sh"
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
  cat "${GH_ISSUE_COMMENTS_FILE:?}"
  printf ']\n'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/reviews* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/comments* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  echo "check-review-clear-once.sh normal path must not run a separate GraphQL thread gate" >&2
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
  "head": { "sha": "head-1", "ref": "buddy-test-branch" },
  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"
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
' "$tmp_dir/issue-comments.json"
export GH_PR_FILE="$tmp_dir/pr.json"
export GH_COMMITS_FILE="$tmp_dir/commits.json"
export GH_ISSUE_COMMENTS_FILE="$tmp_dir/issue-comments.json"

cat > "$tmp_dir/verify-clean.sh" <<'VERIFY'
#!/bin/bash
set -euo pipefail
echo "verify-review $*" >> "${VERIFY_LOG_FILE:?}"
echo "Review clear"
VERIFY
chmod +x "$tmp_dir/verify-clean.sh"
export VERIFY_LOG_FILE="$tmp_dir/verify.log"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-clean.sh"

output="$(bash "$helper" 123)"
if [[ "$output" != *"Review clear"* ]]; then
  echo "check-review-clear-once.sh did not return verifier output" >&2
  exit 1
fi
if [[ "$(wc -l < "$VERIFY_LOG_FILE" | tr -d ' ')" != "1" ]]; then
  echo "check-review-clear-once.sh should call the full verifier exactly once" >&2
  exit 1
fi
if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "check-review-clear-once.sh normal path ran an extra GraphQL gate" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

cat > "$tmp_dir/verify-waitable.sh" <<'VERIFY'
#!/bin/bash
set -euo pipefail
echo "No review found for current head"
exit 1
VERIFY
chmod +x "$tmp_dir/verify-waitable.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-waitable.sh"
set +e
bash "$helper" 123 >/tmp/check-review-clear-once-waitable.out 2>/tmp/check-review-clear-once-waitable.err
status="$?"
set -e
if [[ "$status" != "1" ]]; then
  echo "check-review-clear-once.sh should map waitable verifier failures to exit 1 (got $status)" >&2
  exit 1
fi

cat > "$tmp_dir/verify-actionable.sh" <<'VERIFY'
#!/bin/bash
set -euo pipefail
echo "unresolved review thread: PRRT_123 contains P1"
exit 1
VERIFY
chmod +x "$tmp_dir/verify-actionable.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-actionable.sh"
set +e
bash "$helper" 123 >/tmp/check-review-clear-once-actionable.out 2>/tmp/check-review-clear-once-actionable.err
status="$?"
set -e
if [[ "$status" != "3" ]]; then
  echo "check-review-clear-once.sh should map actionable verifier failures to exit 3 (got $status)" >&2
  exit 1
fi

cat > "$tmp_dir/verify-mixed-actionable.sh" <<'VERIFY'
#!/bin/bash
set -euo pipefail
echo "Latest review targets old-head, not current head head-1."
echo "unresolved review thread: PRRT_123 contains P1"
exit 1
VERIFY
chmod +x "$tmp_dir/verify-mixed-actionable.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-mixed-actionable.sh"
set +e
bash "$helper" 123 >/tmp/check-review-clear-once-mixed.out 2>/tmp/check-review-clear-once-mixed.err
status="$?"
set -e
if [[ "$status" != "3" ]]; then
  echo "check-review-clear-once.sh should prefer actionable over stale-head waitable text (got $status)" >&2
  exit 1
fi

echo "check-review-clear-once tests passed"
