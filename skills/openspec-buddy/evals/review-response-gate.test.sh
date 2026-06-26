#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/review-response-gate.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
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
      printf 'https://github.com/yong-wei/openspec-buddy.git\n'
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

if [[ "$1" == "api" && "$2" == "user" ]]; then
  printf 'YW\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '{"remaining":1000,"resetAt":"2026-06-22T00:00:00Z"}\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
  printf '%s\n' '{"number":123,"head":{"ref":"buddy-test-branch","sha":"head-1"},"body":"Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"}'
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
if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  count=0
  if [[ -f "${GRAPHQL_COUNT_FILE:?}" ]]; then
    count="$(cat "$GRAPHQL_COUNT_FILE")"
  fi
  count="$((count + 1))"
  printf '%s' "$count" > "$GRAPHQL_COUNT_FILE"
  if [[ "${FINAL_FETCH_FAIL_ALWAYS:-0}" == "1" && "$count" -gt 1 ]]; then
    cat "${THREADS_AFTER_FILE:?}"
    echo "502 transient" >&2
    exit 1
  fi
  if [[ "${FINAL_FETCH_FAIL_ONCE:-0}" == "1" && "$count" -eq 2 ]]; then
    cat "${THREADS_AFTER_FILE:?}"
    echo "502 transient" >&2
    exit 1
  fi
  if [[ "$count" -eq 1 ]]; then
    cat "${THREADS_BEFORE_FILE:?}"
  else
    cat "${THREADS_AFTER_FILE:?}"
  fi
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

cat > "$tmp_dir/resolve-helper" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$1" >> "${RESOLVE_LOG_FILE:?}"
printf 'Review thread %s resolved and verified.\n' "$1"
EOF
chmod +x "$tmp_dir/resolve-helper"

cat > "$tmp_dir/reply-helper" <<'EOF'
#!/bin/bash
set -euo pipefail
pr_number="$1"
thread_id="$2"
shift 2
head_sha=""
body_file=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --head)
      head_sha="${2:-}"
      shift 2
      ;;
    --body-file)
      body_file="${2:-}"
      shift 2
      ;;
    *)
      echo "unexpected reply-helper option: $1" >&2
      exit 2
      ;;
  esac
done
printf '%s\t%s\t%s\t%s\n' "$pr_number" "$thread_id" "$head_sha" "$body_file" >> "${REPLY_LOG_FILE:?}"
EOF
chmod +x "$tmp_dir/reply-helper"

thread_payload() {
  local output_file="$1"
  local include_reply="$2"
  local resolved="$3"
  local reply_body="${4:-Fixed in commit abc1234. Verification: npm test passed.}"
  node -e '
const fs = require("node:fs");
const [file, includeReply, resolved, replyBody] = process.argv.slice(1);
const comments = [
  {
    author: { login: "chatgpt-codex-connector" },
    body: "P1: fix the stale branch handling.",
    url: "https://example.test/thread/comment/1",
    createdAt: "2026-06-22T00:00:00Z",
  },
];
if (includeReply === "yes") {
  comments.push({
    author: { login: "YW" },
    body: replyBody,
    url: "https://example.test/thread/comment/2",
    createdAt: "2026-06-22T00:02:00Z",
  });
}
const payload = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              id: "THREAD_1",
              isResolved: resolved === "yes",
              path: "src/demo.js",
              line: 12,
              comments: { pageInfo: { hasNextPage: false }, nodes: comments },
            },
          ],
        },
      },
    },
  },
};
fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
' "$output_file" "$include_reply" "$resolved" "$reply_body"
}

run_gate() {
  local name="$1"
  shift
  GRAPHQL_COUNT_FILE="$tmp_dir/graphql-count-$name" \
  RESOLVE_LOG_FILE="$tmp_dir/resolve-$name.log" \
  PATH="$tmp_dir:$PATH" \
  OPENSPEC_BUDDY_BASE_BRANCH=integration \
  OPENSPEC_BUDDY_RELEASE_BRANCH=main \
  OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei \
  OPENSPEC_BUDDY_PROJECT_NUMBER=1 \
  OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy" \
  OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING=0 \
  OPENSPEC_BUDDY_RESOLVE_REVIEW_THREAD_HELPER="$tmp_dir/resolve-helper" \
  OPENSPEC_BUDDY_REPLY_REVIEW_THREAD_HELPER="$tmp_dir/reply-helper" \
  REPLY_LOG_FILE="${REPLY_LOG_FILE:-$tmp_dir/reply-$name.log}" \
    "$helper" "$@"
}

export GH_LOG_FILE="$tmp_dir/gh.log"

thread_payload "$tmp_dir/no-reply-before.json" no no
thread_payload "$tmp_dir/no-reply-after.json" no no
export THREADS_BEFORE_FILE="$tmp_dir/no-reply-before.json"
export THREADS_AFTER_FILE="$tmp_dir/no-reply-after.json"
set +e
run_gate no-reply 123 >"$tmp_dir/no-reply.out" 2>"$tmp_dir/no-reply.err"
no_reply_status="$?"
set -e
if [[ "$no_reply_status" -eq 0 ]]; then
  echo "review-response-gate should fail when actionable thread has no agent reply" >&2
  exit 1
fi
if ! grep -F 'missing an agent reply with commit or verification evidence' "$tmp_dir/no-reply.err" >/dev/null; then
  echo "review-response-gate did not explain the missing reply/evidence failure" >&2
  cat "$tmp_dir/no-reply.err" >&2
  exit 1
fi
if [[ -e "$tmp_dir/resolve-no-reply.log" ]]; then
  echo "review-response-gate must not resolve a thread that has no evidence reply" >&2
  exit 1
fi

thread_payload "$tmp_dir/weak-reply-before.json" yes no "Fixed in commit abc1234."
thread_payload "$tmp_dir/weak-reply-after.json" yes no "Fixed in commit abc1234."
export THREADS_BEFORE_FILE="$tmp_dir/weak-reply-before.json"
export THREADS_AFTER_FILE="$tmp_dir/weak-reply-after.json"
set +e
run_gate weak-reply 123 >"$tmp_dir/weak-reply.out" 2>"$tmp_dir/weak-reply.err"
weak_reply_status="$?"
set -e
if [[ "$weak_reply_status" -eq 0 ]]; then
  echo "review-response-gate should fail when an agent reply names a commit but lacks verification evidence" >&2
  exit 1
fi
if [[ -e "$tmp_dir/resolve-weak-reply.log" ]]; then
  echo "review-response-gate must not resolve a thread that lacks verification evidence" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const file = process.argv[1];
const payload = {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: true },
          nodes: [],
        },
      },
    },
  },
};
fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
' "$tmp_dir/truncated-threads.json"
export THREADS_BEFORE_FILE="$tmp_dir/truncated-threads.json"
export THREADS_AFTER_FILE="$tmp_dir/truncated-threads.json"
set +e
run_gate truncated-threads 123 >"$tmp_dir/truncated-threads.out" 2>"$tmp_dir/truncated-threads.err"
truncated_threads_status="$?"
set -e
if [[ "$truncated_threads_status" -eq 0 ]]; then
  echo "review-response-gate should fail closed when reviewThreads pagination is truncated" >&2
  exit 1
fi
if ! grep -F 'GraphQL pagination was truncated' "$tmp_dir/truncated-threads.err" >/dev/null; then
  echo "review-response-gate did not report truncated reviewThreads pagination" >&2
  cat "$tmp_dir/truncated-threads.err" >&2
  exit 1
fi

thread_payload "$tmp_dir/truncated-comments.json" yes no
node -e '
const fs = require("node:fs");
const file = process.argv[1];
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
payload.data.repository.pullRequest.reviewThreads.nodes[0].comments.pageInfo.hasNextPage = true;
fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
' "$tmp_dir/truncated-comments.json"
export THREADS_BEFORE_FILE="$tmp_dir/truncated-comments.json"
export THREADS_AFTER_FILE="$tmp_dir/truncated-comments.json"
set +e
run_gate truncated-comments 123 >"$tmp_dir/truncated-comments.out" 2>"$tmp_dir/truncated-comments.err"
truncated_comments_status="$?"
set -e
if [[ "$truncated_comments_status" -eq 0 ]]; then
  echo "review-response-gate should fail closed when review thread comments pagination is truncated" >&2
  exit 1
fi
if [[ -e "$tmp_dir/resolve-truncated-comments.log" ]]; then
  echo "review-response-gate must not resolve when thread comments are truncated" >&2
  exit 1
fi

thread_payload "$tmp_dir/reply-before.json" yes no
thread_payload "$tmp_dir/reply-after.json" yes yes
export THREADS_BEFORE_FILE="$tmp_dir/reply-before.json"
export THREADS_AFTER_FILE="$tmp_dir/reply-after.json"
run_gate with-reply 123 --head abc123456789 >"$tmp_dir/reply.out"
if ! grep -F 'Review response gate verified for PR #123' "$tmp_dir/reply.out" >/dev/null; then
  echo "review-response-gate did not report success after resolving addressed thread" >&2
  cat "$tmp_dir/reply.out" >&2
  exit 1
fi
grep -F 'resolved_count: 1' "$tmp_dir/reply.out" >/dev/null
grep -F 'final_verify: passed' "$tmp_dir/reply.out" >/dev/null
if [[ "$(cat "$tmp_dir/resolve-with-reply.log")" != "THREAD_1" ]]; then
  echo "review-response-gate did not call resolver for the addressed thread" >&2
  exit 1
fi

printf '%s\n' 'Fixed in commit abc1234. Verification: npm test passed.' > "$tmp_dir/thread-reply.md"
node -e '
const fs = require("node:fs");
const [file, bodyFile] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify({ threads: [{ id: "THREAD_1", head: "wrong-head", bodyFile }] })}\n`);
' "$tmp_dir/reply-plan-wrong-head.json" "$tmp_dir/thread-reply.md"
thread_payload "$tmp_dir/reply-plan-wrong-before.json" no no
thread_payload "$tmp_dir/reply-plan-wrong-after.json" yes yes
export THREADS_BEFORE_FILE="$tmp_dir/reply-plan-wrong-before.json"
export THREADS_AFTER_FILE="$tmp_dir/reply-plan-wrong-after.json"
set +e
REPLY_LOG_FILE="$tmp_dir/reply-plan-wrong.log" run_gate reply-plan-wrong-head 123 --head head-1 --reply-plan "$tmp_dir/reply-plan-wrong-head.json" >"$tmp_dir/reply-plan-wrong.out" 2>"$tmp_dir/reply-plan-wrong.err"
reply_plan_wrong_status="$?"
set -e
if [[ "$reply_plan_wrong_status" -eq 0 ]]; then
  echo "review-response-gate should reject a reply plan targeting a different head" >&2
  exit 1
fi
grep -F 'targets head wrong-head, expected head-1' "$tmp_dir/reply-plan-wrong.err" >/dev/null
if [[ -e "$tmp_dir/reply-plan-wrong.log" ]]; then
  echo "review-response-gate must not call reply helper for an invalid reply plan" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const [file, bodyFile] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify({ threads: [{ id: "THREAD_1", head: "head-1", bodyFile }] })}\n`);
' "$tmp_dir/reply-plan.json" "$tmp_dir/thread-reply.md"
thread_payload "$tmp_dir/reply-plan-before.json" no no
thread_payload "$tmp_dir/reply-plan-after.json" yes yes
export THREADS_BEFORE_FILE="$tmp_dir/reply-plan-before.json"
export THREADS_AFTER_FILE="$tmp_dir/reply-plan-after.json"
REPLY_LOG_FILE="$tmp_dir/reply-plan.log" run_gate reply-plan 123 --head head-1 --reply-plan "$tmp_dir/reply-plan.json" >"$tmp_dir/reply-plan.out"
if ! grep -F 'no unresolved actionable Codex review threads' "$tmp_dir/reply-plan.out" >/dev/null; then
  echo "review-response-gate did not complete after reply-plan helper resolved the thread state" >&2
  cat "$tmp_dir/reply-plan.out" >&2
  exit 1
fi
if [[ "$(cut -f1-3 "$tmp_dir/reply-plan.log")" != $'123\tTHREAD_1\thead-1' ]]; then
  echo "review-response-gate did not call reply helper with PR, thread, and head" >&2
  cat "$tmp_dir/reply-plan.log" >&2
  exit 1
fi

thread_payload "$tmp_dir/transient-before.json" yes no
thread_payload "$tmp_dir/transient-after.json" yes yes
export THREADS_BEFORE_FILE="$tmp_dir/transient-before.json"
export THREADS_AFTER_FILE="$tmp_dir/transient-after.json"
export FINAL_FETCH_FAIL_ONCE=1
run_gate transient-final 123 --head abc123456789 >"$tmp_dir/transient.out"
unset FINAL_FETCH_FAIL_ONCE
grep -F 'resolved_count: 1' "$tmp_dir/transient.out" >/dev/null
grep -F 'final_verify: passed' "$tmp_dir/transient.out" >/dev/null

thread_payload "$tmp_dir/transient-fail-before.json" yes no
thread_payload "$tmp_dir/transient-fail-after.json" yes yes
export THREADS_BEFORE_FILE="$tmp_dir/transient-fail-before.json"
export THREADS_AFTER_FILE="$tmp_dir/transient-fail-after.json"
set +e
export FINAL_FETCH_FAIL_ALWAYS=1
run_gate transient-final-fail 123 --head abc123456789 >"$tmp_dir/transient-fail.out" 2>"$tmp_dir/transient-fail.err"
transient_fail_status="$?"
unset FINAL_FETCH_FAIL_ALWAYS
set -e
if [[ "$transient_fail_status" -eq 0 ]]; then
  echo "review-response-gate should fail when final verification fails twice" >&2
  exit 1
fi
grep -F 'resolved_count: 1' "$tmp_dir/transient-fail.out" >/dev/null
grep -F 'final_verify: transient-failed' "$tmp_dir/transient-fail.out" >/dev/null
grep -F 'safe_to_rerun: true' "$tmp_dir/transient-fail.out" >/dev/null

thread_payload "$tmp_dir/still-open-before.json" yes no
thread_payload "$tmp_dir/still-open-after.json" yes no
export THREADS_BEFORE_FILE="$tmp_dir/still-open-before.json"
export THREADS_AFTER_FILE="$tmp_dir/still-open-after.json"
set +e
run_gate still-open 123 >"$tmp_dir/still-open.out" 2>"$tmp_dir/still-open.err"
still_open_status="$?"
set -e
if [[ "$still_open_status" -eq 0 ]]; then
  echo "review-response-gate should fail when the post-resolve GraphQL check is still unresolved" >&2
  exit 1
fi
if ! grep -F 'still has unresolved actionable Codex review threads' "$tmp_dir/still-open.err" >/dev/null; then
  echo "review-response-gate did not fail on post-resolve unresolved state" >&2
  cat "$tmp_dir/still-open.err" >&2
  exit 1
fi

echo "review-response-gate tests passed"
