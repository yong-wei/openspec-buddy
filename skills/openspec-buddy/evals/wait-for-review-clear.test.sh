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
  '  cat "${GH_PR_FILE:?}"' \
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

printf '%s\n' \
  '#!/bin/bash' \
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
  '#!/bin/bash' \
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
  '  "head": { "sha": "head-2", "ref": "buddy-test-branch" },' \
  '  "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"' \
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
export VERIFY_REUSE_LOG_FILE="$tmp_dir/verify-cache-refresh-reuse.log"
rm -f "$VERIFY_COUNT_FILE"
rm -f "$VERIFY_REUSE_LOG_FILE"
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
if [[ "$(tr '\n' ' ' < "$VERIFY_REUSE_LOG_FILE" | sed 's/ *$//')" != "0 1" ]]; then
  echo "wait-for-review-clear.sh should only reuse REST cache after the light REST refresh" >&2
  cat "$VERIFY_REUSE_LOG_FILE" >&2
  exit 1
fi

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
timeout 2s "$helper" 123 > "$tmp_dir/unresolved-output.txt" 2> "$tmp_dir/unresolved-err.txt"
unresolved_status="$?"
set -e
if [[ "$unresolved_status" -eq 0 ]]; then
  echo "wait-for-review-clear.sh should fail before waiting when actionable threads are unresolved" >&2
  exit 1
fi
if ! grep -F 'Unresolved actionable Codex review threads exist' "$tmp_dir/unresolved-err.txt" >/dev/null; then
  echo "wait-for-review-clear.sh did not surface the review-response-gate failure" >&2
  cat "$tmp_dir/unresolved-err.txt" >&2
  exit 1
fi

echo "wait-for-review-clear tests passed"
