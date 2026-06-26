#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ "$pr_ref" == "-h" || "$pr_ref" == "--help" ]]; then
  echo "Usage: check-review-clear-once.sh <pr-number-or-url> [--review-fix-precheck]"
  exit 0
fi
if [[ -z "$pr_ref" ]]; then
  echo "Usage: check-review-clear-once.sh <pr-number-or-url> [--review-fix-precheck]" >&2
  exit 2
fi

review_fix_precheck=0
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --review-fix-precheck)
      review_fix_precheck=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_auto_config

verify_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER:-$script_dir/verify-review-clear.sh}"
command_timeout="${OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS:-60}"

if ! [[ "$command_timeout" =~ ^[0-9]+$ ]]; then
  echo "OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS must be a non-negative integer." >&2
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
  gh pr view "$ref" --json number --jq '.number'
}

is_actionable_review_failure() {
  local output="$1"
  if grep -E 'unresolved review thread|contains P[0-2]|requested changes|Latest COMMENTED review .*not an explicit' <<<"$output" >/dev/null; then
    return 0
  fi
  return 1
}

is_waitable_review_failure() {
  local output="$1"
  if grep -E 'No review found|no .*review request comment after the current head|top-level clear comment exists|targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  return 1
}

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir)"

if [[ "${OPENSPEC_BUDDY_REUSE_PR_REST_CACHE:-0}" == "1" ]]; then
  buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
else
  OPENSPEC_BUDDY_CACHE_REFRESH=1 buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
fi

request_gate_output="$(mktemp)"
trap 'rm -f "$request_gate_output" "${output_file:-}"' EXIT
request_gate_status=0
OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
  OPENSPEC_BUDDY_REUSE_PR_REST_CACHE=1 \
  "$script_dir/verify-current-head-review-request.sh" "$pr_number" > "$request_gate_output" 2>&1 || request_gate_status="$?"
if [[ "$request_gate_status" -ne 0 ]]; then
  cat "$request_gate_output" >&2
  exit 2
fi

if [[ "$review_fix_precheck" == "1" ]]; then
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
    "$script_dir/verify-review-threads-resolved.sh" "$pr_number"
  exit 0
fi

output_file="$(mktemp)"
status=0
OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
  OPENSPEC_BUDDY_REUSE_PR_REST_CACHE=1 \
  run_with_timeout "$verify_helper" "$pr_number" > "$output_file" 2>&1 || status="$?"

if [[ "$status" -eq 0 ]]; then
  cat "$output_file"
  exit 0
fi

if [[ "$status" -eq 124 ]]; then
  echo "Review clearance verifier timed out after ${command_timeout}s." >&2
  cat "$output_file" >&2
  exit 2
fi

if is_actionable_review_failure "$(cat "$output_file")"; then
  cat "$output_file"
  exit 3
fi

if is_waitable_review_failure "$(cat "$output_file")"; then
  cat "$output_file"
  exit 1
fi

cat "$output_file" >&2
exit 2
