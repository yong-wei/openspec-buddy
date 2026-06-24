#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: wait-for-review-clear.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
openspec_buddy_require_auto_config

initial_wait="${OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS:-300}"
poll_wait="${OPENSPEC_BUDDY_REVIEW_POLL_SECONDS:-60}"
max_wait="${OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS:-900}"
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"
verify_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER:-$script_dir/verify-review-clear.sh}"
command_timeout="${OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS:-60}"
max_rounds=2

if ! [[ "$initial_wait" =~ ^[0-9]+$ && "$poll_wait" =~ ^[0-9]+$ && "$max_wait" =~ ^[0-9]+$ && "$command_timeout" =~ ^[0-9]+$ ]]; then
  echo "Review wait values must be non-negative integer seconds." >&2
  exit 2
fi

run_with_timeout() {
  if [[ "$command_timeout" -gt 0 ]] && command -v timeout >/dev/null 2>&1; then
    timeout "$command_timeout"s "$@"
  else
    "$@"
  fi
}

resolve_pr_number() {
  local ref="$1"
  if [[ "$ref" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$ref"
    return 0
  fi
  if [[ "$ref" =~ /pull/([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  run_with_timeout gh pr view "$ref" --json number --jq '.number'
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"
"$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
"$script_dir/verify-review-threads-resolved.sh" "$pr_number"
last_signature=""
last_head_sha=""
started_at="$SECONDS"

probe_state_signature() {
  local pr_file="$tmp_dir/pull.json"

  run_with_timeout gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"
  cp "$pr_file" "$cache_dir/pr-rest-$pr_number.json"

  node -e '
const fs = require("node:fs");
const pr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const signature = {
  head: pr.head?.sha || "",
  updatedAt: pr.updated_at || "",
  comments: pr.comments ?? "",
  reviewComments: pr.review_comments ?? "",
  commits: pr.commits ?? "",
  state: pr.state || "",
};
process.stdout.write(JSON.stringify(signature));
' "$pr_file"
}

probe_head_sha() {
  local signature="$1"
  node -e '
const signature = JSON.parse(process.argv[1]);
process.stdout.write(signature.head || "");
' "$signature"
}

refresh_full_rest_bundle() {
  OPENSPEC_BUDDY_CACHE_REFRESH=1 buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
  rm -f "$cache_dir/review-threads-$pr_number.json"
}

is_waitable_review_failure() {
  local output="$1"
  if grep -E 'targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  if grep -E 'unresolved review thread|contains P[0-2]|requested changes|Latest COMMENTED review .*not an explicit' <<<"$output" >/dev/null; then
    return 1
  fi
  if grep -E 'No review found|no .*review request comment after the current head|top-level clear comment exists|targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  return 1
}

run_clear_gate() {
  local reuse_rest_cache="${1:-0}"
  local output_file="$tmp_dir/verify-output.txt"
  local status=0
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
    OPENSPEC_BUDDY_REUSE_PR_REST_CACHE="$reuse_rest_cache" \
    run_with_timeout "$verify_helper" "$pr_number" > "$output_file" 2>&1 || status="$?"

  if [[ "$status" -eq 0 ]]; then
    cat "$output_file"
    return 0
  fi
  if [[ "$status" -eq 124 ]]; then
    echo "Review clearance verifier timed out after ${command_timeout}s." >&2
    cat "$output_file" >&2
    return 2
  fi

  if is_waitable_review_failure "$(cat "$output_file")"; then
    return 1
  fi

  cat "$output_file" >&2
  return 2
}

verify_current_head_request_gate() {
  local reuse_rest_cache="${1:-0}"
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
    OPENSPEC_BUDDY_REUSE_PR_REST_CACHE="$reuse_rest_cache" \
    "$script_dir/verify-current-head-review-request.sh" "$pr_number" >/dev/null
}

sleep_if_needed() {
  local seconds="$1"
  if [[ "$seconds" -gt 0 ]]; then
    sleep "$seconds"
  fi
}

run_full_check_after_change() {
  refresh_full_rest_bundle
  if ! verify_current_head_request_gate 1; then
    return 2
  fi
  set +e
  run_clear_gate 1
  gate_status="$?"
  set -e
  return "$gate_status"
}

write_retry_context() {
  local round="$1"
  local context_file="$2"
  {
    echo "本轮是 review wait retry，请基于当前 head 重新审查。"
    echo ""
    echo "- 当前 head: ${last_head_sha:-unknown}"
    echo "- 等待轮次: ${round}/${max_rounds}"
    echo "- 单轮等待上限: ${max_wait}s"
    echo "- 首轮静默等待: ${initial_wait}s"
    echo "- 轮询间隔: ${poll_wait}s"
    echo "- 触发原因: 等待窗口内未观察到当前 head 的 clean Codex review。"
    echo "- 说明: 旧 review thread 的 resolved 状态不等于当前 head 已通过复审。"
    echo "- 请求: 请确认当前 head 是否仍有 actionable P0/P1/P2，或明确回复无重大问题。"
  } > "$context_file"
}

request_retry_review() {
  local round="$1"
  local context_file="$tmp_dir/review-wait-retry-${round}.md"
  write_retry_context "$round" "$context_file"
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
    run_with_timeout "$script_dir/request-pr-review.sh" "$pr_number" --force --context-file "$context_file" >/dev/null
}

verify_current_head_request_gate 0

set +e
run_clear_gate 0
gate_status="$?"
set -e

if [[ "$gate_status" -eq 0 ]]; then
  exit 0
fi
if [[ "$gate_status" -eq 2 ]]; then
  exit 1
fi

round=1
while [[ "$round" -le "$max_rounds" ]]; do
  started_at="$SECONDS"
  last_signature="$(probe_state_signature)"
  last_head_sha="$(probe_head_sha "$last_signature")"
  sleep_if_needed "$initial_wait"

  while true; do
    elapsed=$((SECONDS - started_at))
    if [[ "$elapsed" -ge "$max_wait" ]]; then
      break
    fi

    signature="$(probe_state_signature)"
    last_head_sha="$(probe_head_sha "$signature")"

    if [[ "$signature" != "$last_signature" ]]; then
      set +e
      run_full_check_after_change
      gate_status="$?"
      set -e

      if [[ "$gate_status" -eq 0 ]]; then
        exit 0
      fi
      if [[ "$gate_status" -eq 2 ]]; then
        exit 1
      fi
      last_signature="$signature"
    fi

    elapsed=$((SECONDS - started_at))
    if [[ "$elapsed" -ge "$max_wait" ]]; then
      break
    fi

    remaining=$((max_wait - elapsed))
    next_sleep="$poll_wait"
    if [[ "$next_sleep" -gt "$remaining" ]]; then
      next_sleep="$remaining"
    fi
    sleep_if_needed "$next_sleep"
  done

  signature="$(probe_state_signature)"
  last_head_sha="$(probe_head_sha "$signature")"
  if [[ "$signature" != "$last_signature" ]]; then
    set +e
    run_full_check_after_change
    gate_status="$?"
    set -e

    if [[ "$gate_status" -eq 0 ]]; then
      exit 0
    fi
    if [[ "$gate_status" -eq 2 ]]; then
      exit 1
    fi
    last_signature="$signature"
  fi

  if [[ "$round" -lt "$max_rounds" ]]; then
    echo "Timed out waiting for a current-head clean review on PR #$pr_number from $reviewer after ${max_wait}s; requesting one retry review with context." >&2
    request_retry_review "$((round + 1))"
    round="$((round + 1))"
    continue
  fi

  elapsed=$((SECONDS - started_at))
  echo "Timed out waiting for a current-head clean review on PR #$pr_number from $reviewer after ${max_rounds} wait rounds (${max_wait}s each)." >&2
  echo "Run verify-review-clear.sh for the latest diagnostic, then mark the issue needs-human if no clean review exists." >&2
  exit 124
done
