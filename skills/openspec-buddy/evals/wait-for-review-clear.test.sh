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
wait_started_at="$(date +%s)"
set +e
timeout 2s "$helper" 123 > "$tmp_dir/waitable-output.txt" 2> "$tmp_dir/waitable-err.txt"
waitable_status="$?"
set -e
wait_elapsed="$(( $(date +%s) - wait_started_at ))"
if [[ "$waitable_status" -eq 0 ]]; then
  echo "wait-for-review-clear.sh should keep waiting after a fresh request with no review yet" >&2
  exit 1
fi
if [[ "$wait_elapsed" -lt 2 ]]; then
  echo "wait-for-review-clear.sh returned before the initial wait elapsed" >&2
  cat "$tmp_dir/waitable-err.txt" >&2
  exit 1
fi

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'sleep 2' \
  > "$tmp_dir/verify-timeout.sh"
chmod +x "$tmp_dir/verify-timeout.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-timeout.sh"
export OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS=1
set +e
timeout 4s "$helper" 123 > "$tmp_dir/timeout-output.txt" 2> "$tmp_dir/timeout-err.txt"
timeout_status="$?"
set -e
if [[ "$timeout_status" -eq 0 ]]; then
  echo "wait-for-review-clear.sh should fail when the verifier times out" >&2
  exit 1
fi
if ! grep -F 'Review clearance verifier timed out after 1s.' "$tmp_dir/timeout-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not surface verifier timeout diagnostics" >&2
  cat "$tmp_dir/timeout-err.txt" >&2
  exit 1
fi

export OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS=60
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=2

printf '%s\n' \
  '{' \
  '  "number": 123,' \
  '  "html_url": "https://github.com/opt-de/major/pull/123",' \
  '  "head": { "sha": "head-2" }' \
  '}' \
  > "$tmp_dir/pr-head-2.json"
printf '%s\n' \
  '[' \
  '  {' \
  '    "sha": "head-2",' \
  '    "commit": {' \
  '      "author": { "date": "2026-01-01T00:03:00Z" },' \
  '      "committer": { "date": "2026-01-01T00:03:00Z" }' \
  '    }' \
  '  }' \
  ']' \
  > "$tmp_dir/commits-head-2.json"
export GH_PR_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'count_file="${VERIFY_COUNT_FILE:?}"' \
  'count=0' \
  'if [[ -f "$count_file" ]]; then' \
  '  count="$(cat "$count_file")"' \
  'fi' \
  'count="$((count + 1))"' \
  'printf "%s" "$count" > "$count_file"' \
  'if [[ "$count" -eq 1 ]]; then' \
  '  echo "Review clearance verification failed:" >&2' \
  '  echo "- No review found from chatgpt-codex-connector." >&2' \
  '  exit 1' \
  'fi' \
  'cache_dir="${OPENSPEC_BUDDY_GH_CACHE_DIR:?}"' \
  'head_sha="$(node -e '\''const fs=require("node:fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(pr.head.sha);'\'' "$cache_dir/pr-rest-$1.json")"' \
  'commit_sha="$(node -e '\''const fs=require("node:fs"); const commits=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write((commits[0] && commits[0].sha) || "");'\'' "$cache_dir/commits-$1.json")"' \
  'if [[ "$head_sha" != "$commit_sha" ]]; then' \
  '  echo "cache mismatch: head=$head_sha commit=$commit_sha" >&2' \
  '  exit 2' \
  'fi' \
  'echo "Review clearance verified for PR #$1 using reviewer chatgpt-codex-connector."' \
  'echo "Clearance source: cached head and commit state agree."' \
  > "$tmp_dir/verify-cache-refresh.sh"
chmod +x "$tmp_dir/verify-cache-refresh.sh"
export VERIFY_COUNT_FILE="$tmp_dir/verify-cache-refresh.count"
rm -f "$VERIFY_COUNT_FILE"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-cache-refresh.sh"

if ! timeout 5s "$helper" 123 > "$tmp_dir/cache-refresh-output.txt" 2> "$tmp_dir/cache-refresh-err.txt"; then
  echo "wait-for-review-clear.sh did not refresh commit cache before the second verifier run" >&2
  cat "$tmp_dir/cache-refresh-err.txt" >&2
  exit 1
fi
if ! grep -F 'cached head and commit state agree' "$tmp_dir/cache-refresh-output.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not return the cache refresh verifier success output" >&2
  cat "$tmp_dir/cache-refresh-output.txt" >&2
  exit 1
fi

echo "wait-for-review-clear tests passed"
