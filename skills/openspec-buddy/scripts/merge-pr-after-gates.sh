#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
pr_number="${2:-}"
expected_head="${3:-}"

if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: merge-pr-after-gates.sh <issue-number> <pr-number> <expected-head>"
  exit 0
fi
if [[ -z "$issue_number" || -z "$pr_number" || -z "$expected_head" ]]; then
  echo "Usage: merge-pr-after-gates.sh <issue-number> <pr-number> <expected-head>" >&2
  exit 2
fi

truthy() {
  case "${1:-}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if ! truthy "${OPENSPEC_BUDDY_AUTO_CONTROLLER_CHILD:-}"; then
  echo "Controller-owned merge refused: merge-pr-after-gates.sh is internal to Buddy Auto." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

repo_nwo="${OPENSPEC_BUDDY_REPO_NWO:-}"
if [[ -z "$repo_nwo" ]]; then
  remote_url="$(git -C "${OPENSPEC_BUDDY_REPO_ROOT:-.}" remote get-url origin 2>/dev/null || true)"
  if [[ "$remote_url" == git@github.com:* ]]; then
    repo_nwo="${remote_url#git@github.com:}"
  elif [[ "$remote_url" == https://github.com/* ]]; then
    repo_nwo="${remote_url#https://github.com/}"
  fi
  repo_nwo="${repo_nwo%.git}"
fi
if [[ -z "$repo_nwo" || "$repo_nwo" != */* ]]; then
  echo "Cannot determine the exact GitHub repository for PR #$pr_number." >&2
  exit 2
fi

base_branch="${OPENSPEC_BUDDY_BASE_BRANCH:-integration}"
pr_file="$tmp_dir/pr.json"
check_suites_file="$tmp_dir/check-suites.json"
check_runs_file="$tmp_dir/check-runs.json"
status_file="$tmp_dir/status.json"
ci_detail_file="$tmp_dir/ci-detail.txt"
review_output="$tmp_dir/review.out"

gate_log() {
  if [[ -n "${OPENSPEC_BUDDY_MERGE_GATE_LOG:-}" ]]; then
    printf '%s\n' "$1" >> "$OPENSPEC_BUDDY_MERGE_GATE_LOG"
  fi
}

fail() {
  echo "$*" >&2
  exit 1
}

fetch_pr_truth() {
  OPENSPEC_BUDDY_CACHE_REFRESH=1 gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"
}

pr_field() {
  node -e '
const fs = require("node:fs");
let value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const key of process.argv[2].split(".")) {
  if (value === null || value === undefined) break;
  value = value[key];
}
if (value === null || value === undefined) process.stdout.write("");
else if (typeof value === "object") process.stdout.write(JSON.stringify(value));
else process.stdout.write(String(value));
' "$pr_file" "$1"
}

verify_ci_and_mergeability() {
  local head="$1"
  local mergeable_state
  local mergeable
  local draft
  local state
  local base
  local ci_observation_attempts=7
  local ci_observation_interval=5
  local attempt
  local ci_status
  local final_ci_status=2
  local all_samples_zero=true
  local allow_no_ci=false
  mergeable="$(pr_field mergeable)"
  mergeable_state="$(pr_field mergeable_state)"
  draft="$(pr_field draft)"
  state="$(pr_field state | tr '[:lower:]' '[:upper:]')"
  base="$(pr_field base.ref)"
  [[ "$state" == "OPEN" ]] || fail "PR #$pr_number is not open: ${state:-unknown}."
  [[ "$base" == "$base_branch" ]] || fail "PR #$pr_number targets ${base:-unknown}; expected $base_branch."
  [[ "$draft" != "true" ]] || fail "PR #$pr_number is still a draft."
  [[ "$mergeable" == "true" ]] || fail "PR #$pr_number is not mergeable: ${mergeable:-unknown}."
  if [[ -n "$mergeable_state" && "$mergeable_state" != "clean" && "$mergeable_state" != "has_hooks" ]]; then
    fail "PR #$pr_number merge state is not clean: $mergeable_state."
  fi

  if truthy "${OPENSPEC_BUDDY_ALLOW_NO_CI:-false}"; then
    allow_no_ci=true
  fi

  for ((attempt = 1; attempt <= ci_observation_attempts; attempt++)); do
    gh api "repos/$repo_nwo/commits/$head/check-suites?per_page=100" > "$check_suites_file"
    gh api "repos/$repo_nwo/commits/$head/check-runs?per_page=100" > "$check_runs_file"
    gh api "repos/$repo_nwo/commits/$head/status?per_page=100" > "$status_file"
    set +e
    node -e '
const fs = require("node:fs");
const suites = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const checks = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const status = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const allowed = new Set(["success", "neutral", "skipped"]);
const checkSuites = Array.isArray(suites.check_suites) ? suites.check_suites : [];
const checkRuns = Array.isArray(checks.check_runs) ? checks.check_runs : [];
if (typeof suites.total_count === "number" && suites.total_count > checkSuites.length) {
  process.stderr.write(`CI check suites response is incomplete: expected ${suites.total_count}, received ${checkSuites.length}.\n`);
  process.exit(1);
}
if (typeof checks.total_count === "number" && checks.total_count > checkRuns.length) {
  process.stderr.write(`CI check runs response is incomplete: expected ${checks.total_count}, received ${checkRuns.length}.\n`);
  process.exit(1);
}
const badSuite = checkSuites.find((suite) => suite.status !== "completed" || !allowed.has(String(suite.conclusion || "").toLowerCase()));
if (badSuite) {
  process.stderr.write(`CI check suite is not successful: ${badSuite.app?.name || "unnamed"} (${badSuite.status}/${badSuite.conclusion}).\n`);
  process.exit(1);
}
const badCheck = checkRuns.find((run) => run.status !== "completed" || !allowed.has(String(run.conclusion || "").toLowerCase()));
if (badCheck) {
  process.stderr.write(`CI check is not successful: ${badCheck.name || "unnamed"} (${badCheck.status}/${badCheck.conclusion}).\n`);
  process.exit(1);
}
const combinedState = String(status.state || "").toLowerCase();
const legacyStatuses = Array.isArray(status.statuses) ? status.statuses : [];
if (typeof status.total_count === "number" && status.total_count > legacyStatuses.length) {
  process.stderr.write(`Legacy CI status response is incomplete: expected ${status.total_count}, received ${legacyStatuses.length}.\n`);
  process.exit(1);
}
const badLegacyStatus = legacyStatuses.find((item) => String(item.state || "").toLowerCase() !== "success");
if (badLegacyStatus) {
  process.stderr.write(`Legacy CI status is not successful: ${badLegacyStatus.context || "unnamed"} (${badLegacyStatus.state}).\n`);
  process.exit(1);
}
if (checkSuites.length === 0 && checkRuns.length === 0 && legacyStatuses.length === 0) {
  process.exit(2);
}
const checksOnlyPending = combinedState === "pending" && legacyStatuses.length === 0;
if (combinedState && combinedState !== "success" && !checksOnlyPending) {
  process.stderr.write(`Combined CI status is not successful: ${combinedState}.\n`);
  process.exit(1);
}
' "$check_suites_file" "$check_runs_file" "$status_file" 2> "$ci_detail_file"
    ci_status="$?"
    set -e
    final_ci_status="$ci_status"

    case "$ci_status" in
      0) all_samples_zero=false ;;
      2) ;;
      *)
        cat "$ci_detail_file" >&2
        fail "CI checks are failing or pending for PR #$pr_number."
        ;;
    esac

    if [[ "$attempt" -lt "$ci_observation_attempts" ]]; then
      sleep "$ci_observation_interval"
    fi
  done

  case "$final_ci_status" in
    0) return 0 ;;
    2)
      if [[ "$all_samples_zero" == true && "$allow_no_ci" == true ]]; then
        return 0
      fi
      if [[ "$all_samples_zero" == true ]]; then
        fail "No CI signals were observed for PR #$pr_number. Set OPENSPEC_BUDDY_ALLOW_NO_CI=true only for repositories that intentionally have no CI."
      fi
      fail "CI signals disappeared before the observation window ended for PR #$pr_number."
      ;;
    *)
      cat "$ci_detail_file" >&2
      fail "CI checks are failing or pending for PR #$pr_number."
      ;;
  esac
}

fetch_pr_truth
gate_log fresh-pr-truth
pr_number_from_truth="$(pr_field number)"
head_from_truth="$(pr_field head.sha)"
[[ "$pr_number_from_truth" == "$pr_number" ]] || fail "Fresh PR truth returned PR #${pr_number_from_truth:-unknown}, expected #$pr_number."
[[ "$head_from_truth" == "$expected_head" ]] || fail "Fresh PR head $head_from_truth differs from expected head $expected_head."

review_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER:-$script_dir/verify-review-clear.sh}"
set +e
"$review_helper" "$pr_number" > "$review_output" 2>&1
review_status="$?"
set -e
gate_log verify-review-clear
if [[ "$review_status" -ne 0 ]]; then
  cat "$review_output" >&2
  exit "$review_status"
fi

coordination_helper="${OPENSPEC_BUDDY_VERIFY_PR_COORDINATION_HELPER:-$script_dir/verify-pr-coordination.sh}"
if ! "$coordination_helper" "$issue_number" "$pr_number" > "$tmp_dir/coordination.out" 2>&1; then
  cat "$tmp_dir/coordination.out" >&2
  exit 1
fi
gate_log verify-pr-coordination

gate_log verify-ci-and-mergeability
verify_ci_and_mergeability "$expected_head"

fetch_pr_truth
gate_log fresh-head-compare
head_before_merge="$(pr_field head.sha)"
[[ "$head_before_merge" == "$expected_head" ]] || fail "PR head changed before merge: $head_before_merge (expected $expected_head)."

merge_output="$tmp_dir/merge.out"
set +e
gh pr merge --repo "$repo_nwo" "$pr_number" --squash --delete-branch --match-head-commit "$expected_head" > "$merge_output" 2>&1
merge_status="$?"
set -e
if [[ "$merge_status" -ne 0 ]]; then
  cat "$merge_output" >&2
  exit "$merge_status"
fi

fetch_pr_truth
gate_log verify-merged-head
merged_state="$(pr_field state | tr '[:lower:]' '[:upper:]')"
merged_at="$(pr_field merged_at)"
merged_head="$(pr_field head.sha)"
merge_commit="$(pr_field merge_commit_sha)"
[[ "$merged_state" == "CLOSED" && -n "$merged_at" ]] || fail "PR #$pr_number did not verify as merged after gh pr merge."
[[ "$merged_head" == "$expected_head" ]] || fail "Merged PR head $merged_head differs from authorized head $expected_head."
[[ -n "$merge_commit" ]] || fail "Merged PR #$pr_number did not return a merge commit."

line_value() {
  local key="$1"
  sed -n "s/^${key}:[[:space:]]*//p" "$review_output" | tail -1
}

node -e '
const output = {
  merged: true,
  pr: process.argv[1],
  head: process.argv[2],
  mergeCommit: process.argv[3],
  reviewRequestId: process.argv[4],
  reviewResponseId: process.argv[5],
  reviewResponseUrl: process.argv[6],
};
process.stdout.write(`${JSON.stringify(output)}\n`);
' "$pr_number" "$expected_head" "$merge_commit" "$(line_value review_request_id)" "$(line_value review_response_id)" "$(line_value review_response_url)"
