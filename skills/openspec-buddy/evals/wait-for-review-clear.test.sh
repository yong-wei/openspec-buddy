#!/bin/bash
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
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'if [[ "${1:-}" == "-C" ]]; then shift 2; fi' \
  'case "${1:-}" in' \
  '  rev-parse)' \
  '    if [[ "${2:-}" == "--show-toplevel" ]]; then printf "%s\n" "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi' \
  '    ;;' \
  '  branch)' \
  '    if [[ "${2:-}" == "--show-current" ]]; then printf "buddy-test-branch\n"; exit 0; fi' \
  '    ;;' \
  '  worktree)' \
  '    if [[ "${2:-}" == "list" && "${3:-}" == "--porcelain" ]]; then printf "worktree %s\nHEAD abc123\nbranch refs/heads/buddy-test-branch\n" "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi' \
  '    ;;' \
  '  remote)' \
  '    if [[ "${2:-}" == "get-url" ]]; then printf "https://github.com/opt-de/major.git\n"; exit 0; fi' \
  '    ;;' \
  'esac' \
  'echo "unexpected git invocation: $*" >&2' \
  'exit 99' \
  > "$tmp_dir/git"
chmod +x "$tmp_dir/git"

printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${GH_LOG_FILE:?}"' \
  'if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then' \
  '  if [[ -n "${GH_PR_SEQUENCE_DIR:-}" ]]; then' \
  '    sequence_count_file="${GH_PR_SEQUENCE_COUNT_FILE:?}"' \
  '    sequence_count=0' \
  '    if [[ -f "$sequence_count_file" ]]; then sequence_count="$(cat "$sequence_count_file")"; fi' \
  '    sequence_count="$((sequence_count + 1))"' \
  '    printf "%s" "$sequence_count" > "$sequence_count_file"' \
  '    if [[ "$sequence_count" -le "${GH_PR_SEQUENCE_STATIC_COUNT:-2}" ]]; then' \
  '      cat "$GH_PR_SEQUENCE_DIR/before.json"' \
  '    else' \
  '      cat "$GH_PR_SEQUENCE_DIR/after.json"' \
  '    fi' \
  '  else' \
  '    cat "${GH_PR_FILE:?}"' \
  '  fi' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */issues/42 ]]; then' \
  '  printf "%s\n" "{\"number\":42,\"state\":\"open\",\"labels\":[{\"name\":\"status:claimed\"}]}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/42/comments* ]]; then' \
  '  printf "%s\n" "[[{\"created_at\":\"2026-01-01T00:00:00Z\",\"body\":\"OpenSpec Buddy Claim\\n\\nclaim_id: claim-42\\nstate: active\\nagent: @YW\\nchange_id: buddy-test-branch\\nbranch: buddy-test-branch\\nbase_branch: integration\\nbase_sha: abc123\\nlease_until: 2026-01-02T00:00:00.000Z\"}]]"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/123/comments* ]]; then' \
  '  printf "["' \
  '  cat "${GH_ISSUE_COMMENTS_FILE:?}"' \
  '  printf "]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */issues/123/comments* ]]; then' \
  '  cat "${GH_ISSUE_COMMENTS_FILE:?}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/comments* ]]; then' \
  '  printf "[[]]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/comments* ]]; then' \
  '  printf "[]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/reviews* ]]; then' \
  '  printf "[[]]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "$2" == */pulls/123/reviews* ]]; then' \
  '  printf "[]\n"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/commits* ]]; then' \
  '  printf "["' \
  '  cat "${GH_COMMITS_FILE:?}"' \
  '  printf "]\n"' \
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
  'if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then' \
  '  printf "%s\n" "{\"remaining\":1000,\"resetAt\":\"2026-06-12T00:30:00Z\"}"' \
  '  exit 0' \
  'fi' \
  'if [[ "$1" == "pr" && "$2" == "comment" ]]; then' \
  '  printf "%s\n" "$*" >> "${GH_COMMENT_LOG_FILE:-/dev/null}"' \
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
  '  "head": { "sha": "head-1", "ref": "buddy-test-branch" },' \
  '  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"' \
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
export GH_COMMENT_LOG_FILE="$tmp_dir/comment.log"

printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${VERIFY_LOG_FILE:?}"' \
  'if [[ "${VERIFY_MODE:-clean}" == "waitable" ]]; then' \
  '  echo "Review clearance verification failed:" >&2' \
  '  echo "- No review found from chatgpt-codex-connector." >&2' \
  '  exit 1' \
  'fi' \
  'if [[ "${VERIFY_MODE:-clean}" == "unavailable" ]]; then' \
  '  echo "review_outcome: unavailable" >&2' \
  '  echo "Review response is unavailable because Codex review quota is exhausted." >&2' \
  '  exit 1' \
  'fi' \
  'if [[ "${VERIFY_MODE:-clean}" == "mixed-stale-unresolved" ]]; then' \
  '  echo "Review clearance verification failed:" >&2' \
  '  echo "- Latest review targets old-head, not current head head-1." >&2' \
  '  echo "- unresolved review thread THREAD_1 contains P1." >&2' \
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
set +e
timeout 2s "$helper" 123 > "$tmp_dir/immediate-output.txt" 2> "$tmp_dir/immediate-err.txt"
immediate_status="$?"
set -e
if [[ "$immediate_status" -ne 124 ]]; then
  echo "wait-for-review-clear.sh should stay silent during the initial lightweight wait window" >&2
  cat "$tmp_dir/immediate-output.txt" >&2
  cat "$tmp_dir/immediate-err.txt" >&2
  exit 1
fi
if [[ -e "$VERIFY_LOG_FILE" ]]; then
  echo "wait-for-review-clear.sh should not call the heavy verifier during the initial lightweight wait window" >&2
  cat "$VERIFY_LOG_FILE" >&2
  exit 1
fi

cat > "$tmp_dir/threads-truncated.json" <<JSON
{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":true},"nodes":[]}}}}}
JSON
export GH_THREADS_FILE="$tmp_dir/threads-truncated.json"
set +e
timeout 8s "$helper" 123 > "$tmp_dir/truncated-output.txt" 2> "$tmp_dir/truncated-err.txt"
truncated_status="$?"
set -e
if [[ "$truncated_status" -eq 0 || "$truncated_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail closed when startup reviewThreads status is truncated" >&2
  cat "$tmp_dir/truncated-output.txt" >&2
  cat "$tmp_dir/truncated-err.txt" >&2
  exit 1
fi
if ! grep -F 'GraphQL pagination was truncated' "$tmp_dir/truncated-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not escalate truncated startup threads to the full gate" >&2
  cat "$tmp_dir/truncated-err.txt" >&2
  exit 1
fi
export GH_THREADS_FILE="$tmp_dir/threads.json"

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

export VERIFY_MODE=mixed-stale-unresolved
export VERIFY_LOG_FILE="$tmp_dir/verify-mixed.log"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=1
set +e
"$helper" 123 > "$tmp_dir/mixed-output.txt" 2> "$tmp_dir/mixed-err.txt"
mixed_status="$?"
set -e
unset VERIFY_MODE
if [[ "$mixed_status" -eq 0 || "$mixed_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail closed when stale-head diagnostics also contain unresolved actionable threads" >&2
  cat "$tmp_dir/mixed-output.txt" >&2
  cat "$tmp_dir/mixed-err.txt" >&2
  exit 1
fi
grep -F 'unresolved review thread THREAD_1' "$tmp_dir/mixed-err.txt" >/dev/null

export VERIFY_MODE=unavailable
export VERIFY_LOG_FILE="$tmp_dir/verify-unavailable.log"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=2
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-unavailable.log"
rm -f "$GH_COMMENT_LOG_FILE"
set +e
timeout 8s "$helper" 123 > "$tmp_dir/unavailable-output.txt" 2> "$tmp_dir/unavailable-err.txt"
unavailable_status="$?"
set -e
unset VERIFY_MODE
if [[ "$unavailable_status" -ne 4 ]]; then
  echo "wait-for-review-clear.sh should stop with unavailable status 4 (status=$unavailable_status)" >&2
  cat "$tmp_dir/unavailable-output.txt" >&2
  cat "$tmp_dir/unavailable-err.txt" >&2
  exit 1
fi
if ! grep -F 'Review response is unavailable because Codex review quota is exhausted.' "$tmp_dir/unavailable-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh should preserve unavailable review evidence" >&2
  cat "$tmp_dir/unavailable-err.txt" >&2
  exit 1
fi
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "wait-for-review-clear.sh must not request a retry after unavailable review capacity" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2
  exit 1
fi

printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'sleep 2' \
  > "$tmp_dir/verify-timeout.sh"
chmod +x "$tmp_dir/verify-timeout.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-timeout.sh"
export OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=1
set +e
timeout 8s "$helper" 123 > "$tmp_dir/timeout-output.txt" 2> "$tmp_dir/timeout-err.txt"
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
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=6

printf '%s\n' \
  '{' \
  '  "number": 123,' \
  '  "html_url": "https://github.com/opt-de/major/pull/123",' \
  '  "head": { "sha": "head-2", "ref": "buddy-test-branch" },' \
  '  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"' \
  '}' \
  > "$tmp_dir/pr-head-2.json"
mkdir -p "$tmp_dir/pr-sequence"
printf '%s\n' \
  '{' \
  '  "number": 123,' \
  '  "html_url": "https://github.com/opt-de/major/pull/123",' \
  '  "head": { "sha": "head-2", "ref": "buddy-test-branch" },' \
  '  "updated_at": "2026-01-01T00:04:00Z",' \
  '  "comments": 1,' \
  '  "review_comments": 0,' \
  '  "commits": 1,' \
  '  "state": "open",' \
  '  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"' \
  '}' \
  > "$tmp_dir/pr-sequence/before.json"
printf '%s\n' \
  '{' \
  '  "number": 123,' \
  '  "html_url": "https://github.com/opt-de/major/pull/123",' \
  '  "head": { "sha": "head-2", "ref": "buddy-test-branch" },' \
  '  "updated_at": "2026-01-01T00:05:00Z",' \
  '  "comments": 2,' \
  '  "review_comments": 0,' \
  '  "commits": 1,' \
  '  "state": "open",' \
  '  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"' \
  '}' \
  > "$tmp_dir/pr-sequence/after.json"
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
  '#!/bin/bash' \
  'set -euo pipefail' \
  'printf "%s\n" "$*" >> "${STALE_REQUEST_VERIFY_LOG:?}"' \
  'echo "Review clearance verification failed:" >&2' \
  'echo "- No review found from chatgpt-codex-connector." >&2' \
  'exit 1' \
  > "$tmp_dir/verify-stale-request.sh"
chmod +x "$tmp_dir/verify-stale-request.sh"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-stale-request.sh"
export STALE_REQUEST_VERIFY_LOG="$tmp_dir/verify-stale-request.log"
rm -f "$STALE_REQUEST_VERIFY_LOG"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=5
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=5
set +e
timeout 2s "$helper" 123 > "$tmp_dir/stale-request-output.txt" 2> "$tmp_dir/stale-request-err.txt"
stale_request_status="$?"
set -e
if [[ "$stale_request_status" -eq 0 || "$stale_request_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail immediately when current head has no fresh review request" >&2
  cat "$tmp_dir/stale-request-err.txt" >&2
  exit 1
fi
if ! grep -F 'Current head has no fresh PR review request' "$tmp_dir/stale-request-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not explain the missing current-head review request" >&2
  cat "$tmp_dir/stale-request-err.txt" >&2
  exit 1
fi
if [[ -f "$STALE_REQUEST_VERIFY_LOG" ]]; then
  echo "wait-for-review-clear.sh should not call the review verifier before a current-head request exists" >&2
  cat "$STALE_REQUEST_VERIFY_LOG" >&2
  exit 1
fi

printf '%s\n' \
  '[' \
  '  {' \
  '    "sha": "head-2",' \
  '    "commit": {}' \
  '  }' \
  ']' \
  > "$tmp_dir/commits-unknown-head-time.json"
export GH_COMMITS_FILE="$tmp_dir/commits-unknown-head-time.json"
rm -f "$STALE_REQUEST_VERIFY_LOG"
set +e
timeout 2s "$helper" 123 > "$tmp_dir/unknown-head-output.txt" 2> "$tmp_dir/unknown-head-err.txt"
unknown_head_status="$?"
set -e
if [[ "$unknown_head_status" -eq 0 || "$unknown_head_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail immediately when current head time is unknown" >&2
  cat "$tmp_dir/unknown-head-err.txt" >&2
  exit 1
fi
if ! grep -F 'Current head has no fresh PR review request' "$tmp_dir/unknown-head-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not fail closed for unknown current head time" >&2
  cat "$tmp_dir/unknown-head-err.txt" >&2
  exit 1
fi
if [[ -f "$STALE_REQUEST_VERIFY_LOG" ]]; then
  echo "wait-for-review-clear.sh should not call the review verifier when current head time is unknown" >&2
  cat "$STALE_REQUEST_VERIFY_LOG" >&2
  exit 1
fi

printf '%s\n' \
  '[' \
  '  {' \
  '    "sha": "head-1",' \
  '    "commit": {' \
  '      "author": { "date": "2026-01-01T00:06:00Z" },' \
  '      "committer": { "date": "2026-01-01T00:06:00Z" }' \
  '    }' \
  '  }' \
  ']' \
  > "$tmp_dir/commits-missing-current-head.json"
export GH_COMMITS_FILE="$tmp_dir/commits-missing-current-head.json"
rm -f "$STALE_REQUEST_VERIFY_LOG"
set +e
timeout 2s "$helper" 123 > "$tmp_dir/missing-current-head-output.txt" 2> "$tmp_dir/missing-current-head-err.txt"
missing_current_head_status="$?"
set -e
if [[ "$missing_current_head_status" -eq 0 || "$missing_current_head_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail immediately when current head commit is missing from REST commits" >&2
  cat "$tmp_dir/missing-current-head-err.txt" >&2
  exit 1
fi
if ! grep -F 'Current head has no fresh PR review request' "$tmp_dir/missing-current-head-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not fail closed for missing current head commit" >&2
  cat "$tmp_dir/missing-current-head-err.txt" >&2
  exit 1
fi
if [[ -f "$STALE_REQUEST_VERIFY_LOG" ]]; then
  echo "wait-for-review-clear.sh should not call the review verifier when current head commit is missing" >&2
  cat "$STALE_REQUEST_VERIFY_LOG" >&2
  exit 1
fi

export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=6
node -e '
const fs = require("node:fs");
const [file, reviewRequest] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify([
  {
    id: 3,
    body: reviewRequest,
    created_at: "2026-01-01T00:04:00Z",
    user: { login: "yong-wei" },
    html_url: "https://github.com/opt-de/major/pull/123#issuecomment-3",
  },
])}\n`);
' "$tmp_dir/issue-comments.json" "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST"

printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'count_file="${VERIFY_COUNT_FILE:?}"' \
  'count=0' \
  'if [[ -f "$count_file" ]]; then' \
  '  count="$(cat "$count_file")"' \
  'fi' \
  'count="$((count + 1))"' \
  'printf "%s" "$count" > "$count_file"' \
  'printf "%s\n" "${OPENSPEC_BUDDY_REUSE_PR_REST_CACHE:-}" >> "${VERIFY_REUSE_LOG_FILE:?}"' \
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
export VERIFY_REUSE_LOG_FILE="$tmp_dir/verify-cache-refresh-reuse.log"
rm -f "$VERIFY_COUNT_FILE"
rm -f "$VERIFY_REUSE_LOG_FILE"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-cache-refresh.sh"
export GH_PR_SEQUENCE_DIR="$tmp_dir/pr-sequence"
export GH_PR_SEQUENCE_COUNT_FILE="$tmp_dir/pr-sequence.count"
export GH_PR_SEQUENCE_STATIC_COUNT=4
rm -f "$GH_PR_SEQUENCE_COUNT_FILE"

if ! timeout 10s "$helper" 123 > "$tmp_dir/cache-refresh-output.txt" 2> "$tmp_dir/cache-refresh-err.txt"; then
  echo "wait-for-review-clear.sh did not refresh commit cache before the verifier run" >&2
  cat "$tmp_dir/cache-refresh-output.txt" >&2
  cat "$tmp_dir/cache-refresh-err.txt" >&2
  exit 1
fi
if ! grep -F 'cached head and commit state agree' "$tmp_dir/cache-refresh-output.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not return the cache refresh verifier success output" >&2
  cat "$tmp_dir/cache-refresh-output.txt" >&2
  exit 1
fi
if [[ "$(tr '\n' ' ' < "$VERIFY_REUSE_LOG_FILE" | sed 's/ *$//')" != "1" ]]; then
  echo "wait-for-review-clear.sh should reuse REST cache after the light REST refresh" >&2
  cat "$VERIFY_REUSE_LOG_FILE" >&2
  exit 1
fi
unset GH_PR_SEQUENCE_DIR
unset GH_PR_SEQUENCE_COUNT_FILE
unset GH_PR_SEQUENCE_STATIC_COUNT

export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=1
export VERIFY_COUNT_FILE="$tmp_dir/verify-timeout-boundary.count"
export VERIFY_REUSE_LOG_FILE="$tmp_dir/verify-timeout-boundary-reuse.log"
rm -f "$VERIFY_COUNT_FILE" "$VERIFY_REUSE_LOG_FILE"
export GH_PR_SEQUENCE_DIR="$tmp_dir/pr-sequence"
export GH_PR_SEQUENCE_COUNT_FILE="$tmp_dir/pr-timeout-boundary-sequence.count"
export GH_PR_SEQUENCE_STATIC_COUNT=4
rm -f "$GH_PR_SEQUENCE_COUNT_FILE"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-timeout-boundary.log"
if ! timeout 8s "$helper" 123 > "$tmp_dir/timeout-boundary-output.txt" 2> "$tmp_dir/timeout-boundary-err.txt"; then
  echo "wait-for-review-clear.sh missed a light-state change at the timeout boundary" >&2
  cat "$tmp_dir/timeout-boundary-output.txt" >&2
  cat "$tmp_dir/timeout-boundary-err.txt" >&2
  exit 1
fi
if ! grep -F 'cached head and commit state agree' "$tmp_dir/timeout-boundary-output.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not run the final timeout-boundary verifier" >&2
  cat "$tmp_dir/timeout-boundary-output.txt" >&2
  exit 1
fi
if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
  echo "wait-for-review-clear.sh should not request a retry after a timeout-boundary clean review" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2
  exit 1
fi
unset GH_PR_SEQUENCE_DIR
unset GH_PR_SEQUENCE_COUNT_FILE
unset GH_PR_SEQUENCE_STATIC_COUNT

export VERIFY_MODE=waitable
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-review-clear.sh"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=2
export GH_PR_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"
export GH_COMMENT_LOG_FILE="$tmp_dir/comment-retry-timeout.log"
printf '%s\n' \
  '#!/bin/bash' \
  'set -euo pipefail' \
  'context_file=""' \
  'while [[ "$#" -gt 0 ]]; do' \
  '  case "$1" in' \
  '    --context-file)' \
  '      context_file="${2:-}"' \
  '      shift 2' \
  '      ;;' \
  '    *)' \
  '      printf "%s " "$1" >> "${GH_COMMENT_LOG_FILE:?}"' \
  '      shift' \
  '      ;;' \
  '  esac' \
  'done' \
  'printf "\n" >> "${GH_COMMENT_LOG_FILE:?}"' \
  'printf "%s\n" "${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:?}" >> "${GH_COMMENT_LOG_FILE:?}"' \
  'if [[ -n "$context_file" ]]; then cat "$context_file" >> "${GH_COMMENT_LOG_FILE:?}"; fi' \
  'node -e '\''const fs=require("node:fs"); const [file, body]=process.argv.slice(1); fs.writeFileSync(file, `${JSON.stringify([{id:99,body,created_at:"2026-01-01T00:05:00Z",user:{login:"yong-wei"},html_url:"https://github.com/opt-de/major/pull/123#issuecomment-99"}])}\n`);'\'' "${GH_ISSUE_COMMENTS_FILE:?}" "${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:?}"' \
  > "$tmp_dir/request-pr-review-retry.sh"
chmod +x "$tmp_dir/request-pr-review-retry.sh"
export OPENSPEC_BUDDY_REQUEST_PR_REVIEW_HELPER="$tmp_dir/request-pr-review-retry.sh"
rm -f "$GH_COMMENT_LOG_FILE"
set +e
timeout 12s "$helper" 123 > "$tmp_dir/retry-timeout-output.txt" 2> "$tmp_dir/retry-timeout-err.txt"
retry_timeout_status="$?"
set -e
unset VERIFY_MODE
unset OPENSPEC_BUDDY_REQUEST_PR_REVIEW_HELPER
if [[ "$retry_timeout_status" -ne 124 ]]; then
  echo "wait-for-review-clear.sh should return 124 after the second wait window times out (status=$retry_timeout_status)" >&2
  cat "$tmp_dir/retry-timeout-output.txt" >&2
  cat "$tmp_dir/retry-timeout-err.txt" >&2
  if [[ -e "$GH_COMMENT_LOG_FILE" ]]; then
    cat "$GH_COMMENT_LOG_FILE" >&2
  fi
  if [[ -e "$GH_LOG_FILE" ]]; then
    tail -80 "$GH_LOG_FILE" >&2
  fi
  exit 1
fi
if ! grep -F -- "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "wait-for-review-clear.sh did not force a retry review request after the first timeout" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2 || true
  exit 1
fi
if ! grep -F -- "本轮是 review wait retry" "$GH_COMMENT_LOG_FILE" >/dev/null; then
  echo "wait-for-review-clear.sh retry request did not include retry context" >&2
  cat "$GH_COMMENT_LOG_FILE" >&2
  exit 1
fi
if ! grep -F 'after 2 wait rounds' "$tmp_dir/retry-timeout-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not report second-round human intervention timeout" >&2
  cat "$tmp_dir/retry-timeout-err.txt" >&2
  exit 1
fi

cat > "$tmp_dir/gh-head-change" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"
state_file="${HEAD_CHANGE_STATE_FILE:?}"
state="head-1"
if [[ -f "$state_file" ]]; then
  state="$(cat "$state_file")"
fi
if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  count_file="${HEAD_CHANGE_COUNT_FILE:?}"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(cat "$count_file")"
  fi
  count="$((count + 1))"
  printf '%s' "$count" > "$count_file"
  if [[ "$count" -le "${HEAD_CHANGE_STATIC_COUNT:-4}" ]]; then
    printf 'head-1' > "$state_file"
    cat "${GH_PR_HEAD_1_FILE:?}"
  else
    printf 'head-2' > "$state_file"
    cat "${GH_PR_HEAD_2_FILE:?}"
  fi
  exit 0
fi
if [[ "$1" == "api" && "$2" == */issues/42 ]]; then
  printf '%s\n' '{"number":42,"state":"open","labels":[{"name":"status:claimed"}]}'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/42/comments* ]]; then
  printf '%s\n' '[[{"created_at":"2026-01-01T00:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: @YW\nchange_id: buddy-test-branch\nbranch: buddy-test-branch\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-01-02T00:00:00.000Z"}]]'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/123/comments* ]]; then
  printf '['
  cat "${GH_HEAD_CHANGE_COMMENTS_FILE:?}"
  printf ']\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == */issues/123/comments* ]]; then
  cat "${GH_HEAD_CHANGE_COMMENTS_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/commits* ]]; then
  if [[ "$state" == "head-1" ]]; then
    printf '['
    cat "${GH_COMMITS_HEAD_1_FILE:?}"
    printf ']\n'
    printf 'head-2' > "$state_file"
  else
    printf '['
    cat "${GH_COMMITS_HEAD_2_FILE:?}"
    printf ']\n'
  fi
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/commits* ]]; then
  if [[ "$state" == "head-1" ]]; then
    cat "${GH_COMMITS_HEAD_1_FILE:?}"
    printf 'head-2' > "$state_file"
  else
    cat "${GH_COMMITS_HEAD_2_FILE:?}"
  fi
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/comments* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/comments* ]]; then
  printf '[]\n'
  exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */pulls/123/reviews* ]]; then
  printf '[[]]\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123/reviews* ]]; then
  printf '[]\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  cat "${GH_THREADS_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '%s\n' '{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}'
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "comment" ]]; then
  printf '%s\n' "$*" >> "${GH_COMMENT_LOG_FILE:-/dev/null}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh-head-change"
mv "$tmp_dir/gh" "$tmp_dir/gh-original"
cp "$tmp_dir/gh-head-change" "$tmp_dir/gh"
export GH_PR_HEAD_1_FILE="$tmp_dir/pr.json"
export GH_PR_HEAD_2_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_HEAD_1_FILE="$tmp_dir/commits.json"
export GH_COMMITS_HEAD_2_FILE="$tmp_dir/commits-head-2.json"
node -e '
const fs = require("node:fs");
const [file, reviewRequest] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify([
  {
    id: 4,
    body: reviewRequest,
    created_at: "2026-01-01T00:01:00Z",
    user: { login: "yong-wei" },
    html_url: "https://github.com/opt-de/major/pull/123#issuecomment-4",
  },
])}\n`);
' "$tmp_dir/issue-comments-head-change-stale.json" "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST"
export GH_HEAD_CHANGE_COMMENTS_FILE="$tmp_dir/issue-comments-head-change-stale.json"
export HEAD_CHANGE_STATE_FILE="$tmp_dir/head-change-state"
export HEAD_CHANGE_COUNT_FILE="$tmp_dir/head-change-count"
export HEAD_CHANGE_STATIC_COUNT=4
rm -f "$HEAD_CHANGE_STATE_FILE" "$HEAD_CHANGE_COUNT_FILE"
export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS=0
export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS=1
export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS=6
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-cache-refresh.sh"
export VERIFY_COUNT_FILE="$tmp_dir/verify-head-change.count"
export VERIFY_REUSE_LOG_FILE="$tmp_dir/verify-head-change-reuse.log"
rm -f "$VERIFY_COUNT_FILE" "$VERIFY_REUSE_LOG_FILE"
set +e
timeout 10s "$helper" 123 > "$tmp_dir/head-change-output.txt" 2> "$tmp_dir/head-change-err.txt"
head_change_status="$?"
set -e
mv "$tmp_dir/gh-original" "$tmp_dir/gh"
unset HEAD_CHANGE_COUNT_FILE
unset HEAD_CHANGE_STATIC_COUNT
if [[ "$head_change_status" -eq 0 || "$head_change_status" -eq 124 ]]; then
  echo "wait-for-review-clear.sh should fail when PR head changes and the review request becomes stale during wait" >&2
  cat "$tmp_dir/head-change-err.txt" >&2
  exit 1
fi
if ! grep -F 'Current head has no fresh PR review request' "$tmp_dir/head-change-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not fail closed after PR head changed during wait" >&2
  cat "$tmp_dir/head-change-err.txt" >&2
  exit 1
fi

export GH_PR_FILE="$tmp_dir/pr-head-2.json"
export GH_COMMITS_FILE="$tmp_dir/commits-head-2.json"
export GH_ISSUE_COMMENTS_FILE="$tmp_dir/issue-comments.json"
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-review-clear.sh"

cat > "$tmp_dir/threads-unresolved.json" <<'JSON'
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
set +e
"$helper" 123 > "$tmp_dir/unresolved-output.txt" 2> "$tmp_dir/unresolved-err.txt"
unresolved_status="$?"
set -e
if [[ "$unresolved_status" -eq 0 ]]; then
  echo "wait-for-review-clear.sh should fail before waiting when actionable threads are unresolved" >&2
  exit 1
fi
if ! grep -F 'Unresolved actionable Codex review threads exist' "$tmp_dir/unresolved-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not surface the review-response-gate failure (status $unresolved_status)" >&2
  cat "$tmp_dir/unresolved-output.txt" >&2
  cat "$tmp_dir/unresolved-err.txt" >&2
  tail -n 20 "$GH_LOG_FILE" >&2 || true
  exit 1
fi

echo "wait-for-review-clear tests passed"
