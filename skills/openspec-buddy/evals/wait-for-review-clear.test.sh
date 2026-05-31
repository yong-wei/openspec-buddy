#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/wait-for-review-clear.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=opt-de
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=1

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${GH_LOG_FILE:?}"' \
  'if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then' \
  '  cat "${GH_PR_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */issues/123/comments* ]]; then' \
  '  cat "${GH_ISSUE_COMMENTS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/comments* ]]; then' \
  '  printf "[]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/reviews* ]]; then' \
  '  printf "[]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/commits* ]]; then' \
  '  cat "${GH_COMMITS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == "graphql" ]]; then' \
  '  cat "${GH_THREADS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'echo "unexpected gh invocation: $*" >&2' \
  'exit 99' \
  > "$tmp_dir/gh"
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"

printf '%s\n' \
  '{' \
  '  "number": 123,' \
  '  "html_url": "https://github.com/opt-de/major/pull/123",' \
  '  "head": { "sha": "head-1" }' \
  '}' \
  > "$tmp_dir/pr.json"
printf '%s\n' \
  '[' \
  '  {' \
  '    "sha": "head-1",' \
  '    "commit": {' \
  '      "author": { "date": "2026-01-01T00:00:00Z" },' \
  '      "committer": { "date": "2026-01-01T00:00:00Z" }' \
  '    }' \
  '  }' \
  ']' \
  > "$tmp_dir/commits.json"
node -e '
const fs = require("node:fs");
const [file, reviewRequest] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify([
  {
    id: 1,
    body: reviewRequest,
    created_at: "2026-01-01T00:01:00Z",
    user: { login: "yong-wei" },
    html_url: "https://github.com/opt-de/major/pull/123#issuecomment-1",
  },
  {
    id: 2,
    body: "Codex Review: Did not find any major issues.",
    created_at: "2026-01-01T00:02:00Z",
    user: { login: "chatgpt-codex-connector" },
    html_url: "https://github.com/opt-de/major/pull/123#issuecomment-2",
  },
])}\n`);
' "$tmp_dir/issue-comments.json" "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST"
printf '%s\n' \
  '{' \
  '  "data": {' \
  '    "repository": {' \
  '      "pullRequest": {' \
  '        "reviewThreads": {' \
  '          "nodes": []' \
  '        }' \
  '      }' \
  '    }' \
  '  }' \
  '}' \
  > "$tmp_dir/threads.json"

export GH_PR_FILE="$tmp_dir/pr.json"
export GH_COMMITS_FILE="$tmp_dir/commits.json"
export GH_ISSUE_COMMENTS_FILE="$tmp_dir/issue-comments.json"
export GH_THREADS_FILE="$tmp_dir/threads.json"
export GH_LOG_FILE="$tmp_dir/gh.log"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${VERIFY_LOG_FILE:?}"' \
  'if [[ "${VERIFY_MODE:-clean}" == "waitable" ]]; then' \
  '  echo "Review clearance verification failed:" >&2' \
  '  echo "- No review found from chatgpt-codex-connector." >&2' \
  '  exit 1' \
  'fi' \
  'echo "Review clearance verified for PR #$1 using reviewer chatgpt-codex-connector."' \
  'echo "Clearance source: top-level PR comment after a current-head review request."' \
  > "$tmp_dir/verify-review-clear.sh"
chmod +x "$tmp_dir/verify-review-clear.sh"
export VERIFY_LOG_FILE="$tmp_dir/verify.log"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-review-clear.sh"

"$helper" 123 > "$tmp_dir/output.txt"

if ! grep -F 'Review clearance verified for PR #123' "$tmp_dir/output.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not return the verifier clearance output" >&2
  exit 1
fi

verify_count="$(wc -l < "$VERIFY_LOG_FILE" | tr -d ' ')"
if [[ "$verify_count" -ne 1 ]]; then
  echo "wait-for-review-clear.sh should call the heavy verifier only once in this clean case" >&2
  exit 1
fi

export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=5
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=5
export VERIFY_LOG_FILE="$tmp_dir/verify-immediate.log"
if ! timeout 2s "$helper" 123 > "$tmp_dir/immediate-output.txt"; then
  echo "wait-for-review-clear.sh slept before the first verifier check despite an already-clear review" >&2
  exit 1
fi
if ! grep -F 'Review clearance verified for PR #123' "$tmp_dir/immediate-output.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not return the immediate verifier clearance output" >&2
  exit 1
fi

export VERIFY_MODE=waitable
export VERIFY_LOG_FILE="$tmp_dir/verify-waitable.log"
set +e
timeout 2s "$helper" 123 > "$tmp_dir/waitable-output.txt" 2> "$tmp_dir/waitable-err.txt"
waitable_status="$?"
set -e
if [[ "$waitable_status" -eq 0 ]]; then
  echo "wait-for-review-clear.sh should keep waiting after a fresh request with no review yet" >&2
  exit 1
fi
if [[ "$waitable_status" -ne 124 ]]; then
  echo "wait-for-review-clear.sh returned a non-timeout status before the initial wait elapsed" >&2
  cat "$tmp_dir/waitable-err.txt" >&2
  exit 1
fi

echo "wait-for-review-clear tests passed"
