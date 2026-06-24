#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-current-head-review-request.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_auto_config

review_request="${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"

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

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir)"

OPENSPEC_BUDDY_CACHE_REFRESH=1 buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
request_state="$(node "$script_dir/review-request-state.mjs" "$review_request" "$BUDDY_PR_REST_FILE" "$BUDDY_COMMITS_FILE" "$BUDDY_ISSUE_COMMENTS_FILE")"

if [[ "$request_state" == "present-current-head" ]]; then
  printf 'Current-head PR review request verified for %s (%s).\n' "$pr_ref" "$request_state"
  exit 0
fi

{
  echo "Current head has no fresh PR review request for $pr_ref ($request_state)."
  echo "Run request-pr-review.sh $pr_ref before wait-for-review-clear.sh."
} >&2
exit 1
