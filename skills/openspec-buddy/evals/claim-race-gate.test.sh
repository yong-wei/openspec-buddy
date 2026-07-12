#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "$script_dir/.." && pwd)"
claim_change="$skill_dir/scripts/claim-change.sh"
claim_issue="$skill_dir/scripts/claim-issue.sh"
claim_lock="$skill_dir/scripts/claim-lock.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

if [[ ! -f "$claim_lock" ]]; then
  echo "claim-lock helper is required" >&2
  exit 1
fi

stub_bin="$tmp_dir/bin"
mkdir -p "$stub_bin"

cat >"$stub_bin/gh" <<'EOF'
#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$BUDDY_TEST_LOG"

if [[ "$1" == "api" && "$2" == "repos/example/repo/issues/42" ]]; then
  cat "$BUDDY_TEST_ISSUE_JSON"
  exit 0
fi

if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == "repos/example/repo/issues/42/comments?per_page=100" ]]; then
  printf '['
  cat "$BUDDY_TEST_COMMENTS_JSON"
  printf ']'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "repos/example/repo/pulls?head=example:issue-42-race&state=open&per_page=1" ]]; then
  cat "$BUDDY_TEST_PRS_JSON"
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "edit" ]]; then
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$stub_bin/gh"

cat >"$stub_bin/git" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$BUDDY_TEST_LOG"
if [[ "$1" == "push" ]]; then
  exit 0
fi
if [[ "$1" == "ls-remote" ]]; then
  if [[ "${BUDDY_TEST_BRANCH_EXISTS:-0}" == "1" ]]; then
    exit 0
  fi
  exit 2
fi
echo "unexpected git invocation: $*" >&2
exit 1
EOF
chmod +x "$stub_bin/git"

cat >"$tmp_dir/issue-ready.json" <<'JSON'
{
  "number": 42,
  "state": "open",
  "labels": [
    { "name": "status:ready" }
  ],
  "assignees": []
}
JSON

cat >"$tmp_dir/issue-claimed.json" <<'JSON'
{
  "number": 42,
  "state": "open",
  "labels": [
    { "name": "status:claimed" }
  ],
  "assignees": [
    { "login": "agent-a" }
  ]
}
JSON

cat >"$tmp_dir/issue-claimed-extra-status.json" <<'JSON'
{
  "number": 42,
  "state": "open",
  "labels": [
    { "name": "status:ready" },
    { "name": "status:claimed" }
  ],
  "assignees": [
    { "login": "agent-a" }
  ]
}
JSON

cat >"$tmp_dir/issue-claimed-no-assignee.json" <<'JSON'
{
  "number": 42,
  "state": "open",
  "labels": [
    { "name": "status:claimed" }
  ],
  "assignees": []
}
JSON

cat >"$tmp_dir/comments-current.json" <<'JSON'
[
  {
    "created_at": "2026-06-13T10:00:00Z",
    "body": "OpenSpec Buddy Claim\n\nclaim_id: claim-current\nagent: @agent-a\nchange_id: issue-42-race\nbranch: issue-42-race\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-06-13T22:00:00.000Z"
  }
]
JSON

cat >"$tmp_dir/comments-empty.json" <<'JSON'
[]
JSON

cat >"$tmp_dir/comments-other.json" <<'JSON'
[
  {
    "created_at": "2026-06-13T10:01:00Z",
    "body": "OpenSpec Buddy Claim\n\nclaim_id: claim-other\nagent: @agent-b\nchange_id: issue-42-race\nbranch: issue-42-race\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-06-13T22:30:00.000Z"
  }
]
JSON

cat >"$tmp_dir/no-prs.json" <<'JSON'
[]
JSON

cat >"$tmp_dir/open-prs.json" <<'JSON'
[
  { "number": 77, "head": { "ref": "issue-42-race" } }
]
JSON

export PATH="$stub_bin:$PATH"
export BUDDY_TEST_LOG="$tmp_dir/calls.log"
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-ready.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-empty.json"
export BUDDY_TEST_PRS_JSON="$tmp_dir/no-prs.json"
export BUDDY_TEST_BRANCH_EXISTS=1

# shellcheck source=../scripts/claim-lock.sh
source "$claim_lock"

cat >"$tmp_dir/current-metadata.json" <<'JSON'
{"coupling_group":"none"}
JSON
cat >"$tmp_dir/current-issue-coupling-label.json" <<'JSON'
{"labels":[{"name":"status:ready"},{"name":"coupling:alpha"}]}
JSON
resolved_coupling="$(buddy_resolve_coupling_group "$tmp_dir/current-metadata.json" "$tmp_dir/current-issue-coupling-label.json")"
if [[ "$resolved_coupling" != "alpha" ]]; then
  echo "current issue coupling resolver must use a stricter coupling label when metadata is none" >&2
  exit 1
fi

cat >"$tmp_dir/current-issue-multiple-coupling-labels.json" <<'JSON'
{"labels":[{"name":"status:ready"},{"name":"coupling:alpha"},{"name":"coupling:beta"}]}
JSON
set +e
buddy_resolve_coupling_group "$tmp_dir/current-metadata.json" "$tmp_dir/current-issue-multiple-coupling-labels.json" >"$tmp_dir/multiple-coupling.out" 2>"$tmp_dir/multiple-coupling.err"
multiple_coupling_status="$?"
set -e
if [[ "$multiple_coupling_status" -eq 0 ]]; then
  echo "current issue coupling resolver must reject multiple concrete coupling labels" >&2
  exit 1
fi
if ! grep -F "multiple coupling labels" "$tmp_dir/multiple-coupling.err" >/dev/null; then
  echo "coupling resolver should explain multiple coupling labels" >&2
  cat "$tmp_dir/multiple-coupling.err" >&2
  exit 1
fi

cat >"$tmp_dir/current-issue-conflicting-coupling.json" <<'JSON'
{"labels":[{"name":"status:ready"},{"name":"coupling:beta"}]}
JSON
cat >"$tmp_dir/current-metadata-alpha.json" <<'JSON'
{"coupling_group":"alpha"}
JSON
set +e
buddy_resolve_coupling_group "$tmp_dir/current-metadata-alpha.json" "$tmp_dir/current-issue-conflicting-coupling.json" >"$tmp_dir/conflicting-coupling.out" 2>"$tmp_dir/conflicting-coupling.err"
conflicting_coupling_status="$?"
set -e
if [[ "$conflicting_coupling_status" -eq 0 ]]; then
  echo "current issue coupling resolver must reject metadata and label disagreement" >&2
  exit 1
fi
if ! grep -F "metadata and labels disagree" "$tmp_dir/conflicting-coupling.err" >/dev/null; then
  echo "coupling resolver should explain metadata and label disagreement" >&2
  cat "$tmp_dir/conflicting-coupling.err" >&2
  exit 1
fi

set +e
buddy_preflight_claim_truth_check "42" "issue-42-race" "issue-42-race" "agent-a" "example/repo" "$tmp_dir/preflight" 2>"$tmp_dir/preflight.err"
preflight_status="$?"
set -e

if [[ "$preflight_status" -eq 0 ]]; then
  echo "preflight must reject a ready issue when the claim branch already exists" >&2
  exit 1
fi

if grep -E 'issue edit|issue comment|issue develop|project item-edit|set-project' "$BUDDY_TEST_LOG" >/dev/null; then
  echo "preflight failure must not perform claim writes or peripheral mutations" >&2
  cat "$BUDDY_TEST_LOG" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
export BUDDY_TEST_BRANCH_EXISTS=0
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-claimed-extra-status.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-empty.json"

set +e
buddy_preflight_claim_truth_check "42" "issue-42-race" "issue-42-race" "agent-a" "example/repo" "$tmp_dir/preflight-extra-status" 2>"$tmp_dir/preflight-extra-status.err"
preflight_extra_status="$?"
set -e

if [[ "$preflight_extra_status" -eq 0 ]]; then
  echo "preflight must reject multiple status labels before claim write" >&2
  exit 1
fi
if ! grep -F "multiple status labels" "$tmp_dir/preflight-extra-status.err" >/dev/null; then
  echo "preflight should explain multiple status labels" >&2
  cat "$tmp_dir/preflight-extra-status.err" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
export BUDDY_TEST_BRANCH_EXISTS=0
export BUDDY_TEST_PRS_JSON="$tmp_dir/open-prs.json"
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-ready.json"

set +e
buddy_preflight_claim_truth_check "42" "issue-42-race" "issue-42-race" "agent-a" "example/repo" "$tmp_dir/preflight-open-pr" 2>"$tmp_dir/preflight-open-pr.err"
preflight_pr_status="$?"
set -e

if [[ "$preflight_pr_status" -eq 0 ]]; then
  echo "preflight must reject a ready issue when an open PR already exists for the claim branch" >&2
  exit 1
fi

if grep -E 'issue edit|issue comment|issue develop|project item-edit|set-project' "$BUDDY_TEST_LOG" >/dev/null; then
  echo "open PR preflight failure must not perform claim writes or peripheral mutations" >&2
  cat "$BUDDY_TEST_LOG" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
export BUDDY_TEST_BRANCH_EXISTS=0
export BUDDY_TEST_PRS_JSON="$tmp_dir/no-prs.json"
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-claimed.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-other.json"

set +e
buddy_verify_claim_lock_rest "42" "issue-42-race" "agent-a" "claim-current" "2026-06-13T22:00:00.000Z" "example/repo" "$tmp_dir/verify" 2>"$tmp_dir/verify.err"
verify_status="$?"
set -e

if [[ "$verify_status" -eq 0 ]]; then
  echo "claim verification must reject when the latest claim comment belongs to another agent" >&2
  exit 1
fi

if grep -E 'issue develop|project item-edit|set-project' "$BUDDY_TEST_LOG" >/dev/null; then
  echo "claim verification failure must not perform peripheral mutations" >&2
  cat "$BUDDY_TEST_LOG" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-claimed-extra-status.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-current.json"

set +e
buddy_verify_claim_lock_rest "42" "issue-42-race" "agent-a" "claim-current" "2026-06-13T22:00:00.000Z" "example/repo" "$tmp_dir/verify-extra-status" "issue-42-race" 2>"$tmp_dir/verify-extra-status.err"
extra_status_verify="$?"
set -e

if [[ "$extra_status_verify" -eq 0 ]]; then
  echo "claim verification must reject multiple status labels after claim write" >&2
  exit 1
fi
if ! grep -F "expected exactly status:claimed" "$tmp_dir/verify-extra-status.err" >/dev/null; then
  echo "claim verification should explain multiple status labels" >&2
  cat "$tmp_dir/verify-extra-status.err" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-claimed-no-assignee.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-current.json"

set +e
buddy_verify_claim_lock_rest "42" "issue-42-race" "agent-a" "claim-current" "2026-06-13T22:00:00.000Z" "example/repo" "$tmp_dir/verify-no-assignee" "issue-42-race" 2>"$tmp_dir/verify-no-assignee.err"
assignee_verify="$?"
set -e

if [[ "$assignee_verify" -eq 0 ]]; then
  echo "claim verification must reject missing assignee after claim write" >&2
  exit 1
fi
if ! grep -F "assignee agent-a is missing" "$tmp_dir/verify-no-assignee.err" >/dev/null; then
  echo "claim verification should explain missing assignee" >&2
  cat "$tmp_dir/verify-no-assignee.err" >&2
  exit 1
fi

export BUDDY_TEST_ISSUE_JSON="$tmp_dir/issue-claimed.json"
export BUDDY_TEST_COMMENTS_JSON="$tmp_dir/comments-other.json"

: > "$BUDDY_TEST_LOG"
buddy_delete_claim_branch_if_owned "42" "issue-42-race" "issue-42-race" "agent-a" "claim-current" "2026-06-13T22:00:00.000Z" "example/repo" "$tmp_dir/delete-not-owner"

if grep -F 'git push origin :refs/heads/issue-42-race' "$BUDDY_TEST_LOG" >/dev/null; then
  echo "cleanup must not delete a claim branch when the latest active claim belongs to another agent" >&2
  cat "$BUDDY_TEST_LOG" >&2
  exit 1
fi

: > "$BUDDY_TEST_LOG"
buddy_release_claim_lock "42" "issue-42-race" "issue-42-race" "agent-a" "claim-current" "2026-06-13T22:00:00.000Z" "test release"

if ! grep -F 'OpenSpec Buddy Claim Release' "$BUDDY_TEST_LOG" >/dev/null; then
  echo "failed claim cleanup must be able to publish an OpenSpec Buddy Claim Release comment" >&2
  cat "$BUDDY_TEST_LOG" >&2
  exit 1
fi

if ! grep -n 'buddy_verify_claim_lock_rest' "$claim_change" >/dev/null; then
  echo "claim-change.sh must verify the minimal claim lock before peripheral work" >&2
  exit 1
fi

if ! awk '
  /buddy_verify_claim_lock_rest/ && !verified { verified=NR }
  /gh issue develop "\$issue_number"/ { develop=NR }
  /set-project-date\.sh/ { project=NR }
  END { exit !(verified && develop && project && verified < develop && verified < project) }
' "$claim_change"; then
  echo "claim-change.sh must run claim verification before Development link and Project Start" >&2
  exit 1
fi

if ! awk '
  /buddy_verify_claim_lock_rest/ && !verified { verified=NR }
  /gh issue develop "\$issue_number"/ { develop=NR }
  /set-project-date\.sh/ { project=NR }
  END { exit !(verified && develop && project && verified < develop && verified < project) }
' "$claim_issue"; then
  echo "claim-issue.sh must run claim verification before Development link and Project Start" >&2
  exit 1
fi

echo "claim race gate tests passed"
