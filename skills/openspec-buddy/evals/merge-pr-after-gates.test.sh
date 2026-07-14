#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/merge-pr-after-gates.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

if [[ ! -f "$helper" ]]; then
  echo "merge-pr-after-gates.sh is missing" >&2
  exit 1
fi

export OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD=1
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
export OPENSPEC_BUDDY_REPO_NWO=owner/repo
export OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER="$tmp_dir/verify-review-clear.sh"
export OPENSPEC_BUDDY_VERIFY_PR_COORDINATION_HELPER="$tmp_dir/verify-pr-coordination.sh"
export OPENSPEC_BUDDY_MERGE_GATE_LOG="$tmp_dir/order.log"
export GH_LOG_FILE="$tmp_dir/gh.log"
export PR_FILE="$tmp_dir/pr.json"
export PR_FETCH_COUNT_FILE="$tmp_dir/pr-fetch-count"
export MERGE_MARKER="$tmp_dir/merged"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'GIT'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then shift 2; fi
if [[ "${1:-}" == "remote" && "${2:-}" == "get-url" ]]; then
  printf 'https://github.com/owner/repo.git\n'
  exit 0
fi
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "--show-toplevel" ]]; then
  printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"
  exit 0
fi
echo "unexpected git invocation: $*" >&2
exit 99
GIT
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/verify-review-clear.sh" <<'VERIFY'
#!/usr/bin/env bash
set -euo pipefail
case "${REVIEW_MODE:-success}" in
  success)
    printf '%s\n' 'review_outcome: clear' 'review_request_id: request-1' 'review_response_id: response-1' 'review_response_url: https://example.test/review/response-1'
    exit 0
    ;;
  unavailable)
    printf '%s\n' 'review_outcome: unavailable' 'Review response is unavailable'
    exit 4
    ;;
  missing)
    printf '%s\n' 'review_outcome: pending' 'No review response found'
    exit 1
    ;;
  unresolved)
    printf '%s\n' 'review_outcome: clear' 'unresolved review thread: PRRT_1'
    exit 1
    ;;
esac
exit 1
VERIFY
chmod +x "$tmp_dir/verify-review-clear.sh"

cat > "$tmp_dir/verify-pr-coordination.sh" <<'VERIFY'
#!/usr/bin/env bash
set -euo pipefail
exit 0
VERIFY
chmod +x "$tmp_dir/verify-pr-coordination.sh"

cat > "$tmp_dir/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_LOG_FILE:?}"
if [[ "${1:-}" == "api" && "${2:-}" == repos/owner/repo/pulls/123 ]]; then
  count=0
  if [[ -f "${PR_FETCH_COUNT_FILE:?}" ]]; then count="$(<"$PR_FETCH_COUNT_FILE")"; fi
  count=$((count + 1))
  printf '%s\n' "$count" > "$PR_FETCH_COUNT_FILE"
  if [[ -f "${MERGE_MARKER:?}" ]]; then
    cat <<'JSON'
{"number":123,"state":"closed","merged_at":"2026-07-12T04:00:00Z","merge_commit_sha":"merge-1","head":{"sha":"head-1","ref":"change-1"},"base":{"ref":"integration"},"draft":false,"mergeable":true,"mergeable_state":"clean"}
JSON
  elif [[ "${FINAL_HEAD_CHANGE:-0}" == "1" && "$count" == "2" ]]; then
    cat <<'JSON'
{"number":123,"state":"open","merged_at":null,"head":{"sha":"head-2","ref":"change-1"},"base":{"ref":"integration"},"draft":false,"mergeable":true,"mergeable_state":"clean"}
JSON
  elif [[ "${PR_HEAD_MODE:-head-1}" == "head-2" ]]; then
    cat <<'JSON'
{"number":123,"state":"open","merged_at":null,"head":{"sha":"head-2","ref":"change-1"},"base":{"ref":"integration"},"draft":false,"mergeable":true,"mergeable_state":"clean"}
JSON
  else
    base="integration"
    if [[ "${BASE_WRONG:-0}" == "1" ]]; then base="main"; fi
    mergeable=true
    if [[ "${MERGEABLE_FALSE:-0}" == "1" ]]; then mergeable=false; fi
    printf '{"number":123,"state":"open","merged_at":null,"head":{"sha":"head-1","ref":"change-1"},"base":{"ref":"%s"},"draft":false,"mergeable":%s,"mergeable_state":"clean"}\n' "$base" "$mergeable"
  fi
  exit 0
fi
if [[ "${1:-}" == "api" && "${2:-}" == repos/owner/repo/commits/*/check-runs* ]]; then
  case "${CHECK_MODE:-success}" in
    empty) printf '%s\n' '{"check_runs":[]}' ;;
    failing) printf '%s\n' '{"check_runs":[{"status":"completed","conclusion":"failure"}]}' ;;
    pending) printf '%s\n' '{"check_runs":[{"status":"in_progress","conclusion":null}]}' ;;
    *) printf '%s\n' '{"check_runs":[{"status":"completed","conclusion":"success"}]}' ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "api" && "${2:-}" == repos/owner/repo/commits/*/status* ]]; then
  case "${STATUS_MODE:-success}" in
    checks-only) printf '%s\n' '{"state":"pending","statuses":[]}' ;;
    legacy-failure) printf '%s\n' '{"state":"failure","statuses":[{"state":"failure"}]}' ;;
    legacy-pending) printf '%s\n' '{"state":"pending","statuses":[{"state":"pending"}]}' ;;
    *) printf '%s\n' '{"state":"success","statuses":[]}' ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "pr" && "${2:-}" == "merge" ]]; then
  printf 'gh-pr-merge\n' >> "${OPENSPEC_BUDDY_MERGE_GATE_LOG:?}"
  touch "${MERGE_MARKER:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
GH
chmod +x "$tmp_dir/gh"
export PATH="$tmp_dir:$PATH"

run_case() {
  local name="$1"
  shift
  : > "$OPENSPEC_BUDDY_MERGE_GATE_LOG"
  : > "$GH_LOG_FILE"
  rm -f "$PR_FETCH_COUNT_FILE" "$MERGE_MARKER"
  REVIEW_MODE=success CHECK_MODE=success STATUS_MODE=success BASE_WRONG=0 MERGEABLE_FALSE=0 PR_HEAD_MODE=head-1 FINAL_HEAD_CHANGE=0 "$@"
}

expect_denied() {
  local name="$1"
  shift
  run_case "$name" env "$@" bash "$helper" 42 123 head-1 >"$tmp_dir/$name.out" 2>"$tmp_dir/$name.err" || status=$?
  status="${status:-0}"
  if [[ "$status" -eq 0 ]]; then
    echo "$name should be denied" >&2
    exit 1
  fi
  if [[ -s "$tmp_dir/$name.merge" || -f "$MERGE_MARKER" ]]; then
    echo "$name attempted a merge" >&2
    exit 1
  fi
  unset status
}

expect_denied unavailable env REVIEW_MODE=unavailable
expect_denied missing-response env REVIEW_MODE=missing
expect_denied unresolved-thread env REVIEW_MODE=unresolved
expect_denied ci-failing env CHECK_MODE=failing
expect_denied ci-pending env CHECK_MODE=pending
expect_denied legacy-status-failure env STATUS_MODE=legacy-failure
expect_denied legacy-status-pending env STATUS_MODE=legacy-pending
expect_denied not-mergeable env MERGEABLE_FALSE=1
expect_denied wrong-base env BASE_WRONG=1
expect_denied stale-head env PR_HEAD_MODE=head-2
expect_denied head-race env FINAL_HEAD_CHANGE=1

run_case success env REVIEW_MODE=success CHECK_MODE=success bash "$helper" 42 123 head-1 >"$tmp_dir/success.out"
expected_order='fresh-pr-truth
verify-review-clear
verify-pr-coordination
verify-ci-and-mergeability
fresh-head-compare
gh-pr-merge
verify-merged-head'
if [[ "$(<"$OPENSPEC_BUDDY_MERGE_GATE_LOG")" != "$expected_order" ]]; then
  echo "unexpected merge gate order" >&2
  cat "$OPENSPEC_BUDDY_MERGE_GATE_LOG" >&2
  exit 1
fi
node -e '
const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (data.merged !== true || data.pr !== "123" || data.head !== "head-1" || data.mergeCommit !== "merge-1" || data.reviewRequestId !== "request-1" || data.reviewResponseId !== "response-1") process.exit(1);
' "$tmp_dir/success.out"

run_case checks-only env STATUS_MODE=checks-only bash "$helper" 42 123 head-1 >"$tmp_dir/checks-only.out"
node -e '
const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (data.merged !== true || data.pr !== "123" || data.head !== "head-1") process.exit(1);
' "$tmp_dir/checks-only.out"

run_case empty-ci env CHECK_MODE=empty STATUS_MODE=checks-only bash "$helper" 42 123 head-1 >"$tmp_dir/empty-ci.out"
node -e '
const data = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (data.merged !== true || data.pr !== "123" || data.head !== "head-1") process.exit(1);
' "$tmp_dir/empty-ci.out"
if ! grep -F -- 'pr merge --repo owner/repo 123 --squash --delete-branch --match-head-commit head-1' "$GH_LOG_FILE" >/dev/null; then
  echo "merge command must target the verified repository explicitly" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

echo "merge-pr-after-gates tests passed"
