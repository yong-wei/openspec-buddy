#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: review-response-gate.sh <pr-number-or-url> [--head <sha>] [--check-only] [--post-merge] [--reply-plan <json-file>]"
  exit 0
fi

pr_ref="${1:-}"
shift || true

if [[ -z "$pr_ref" ]]; then
  echo "Usage: review-response-gate.sh <pr-number-or-url> [--head <sha>] [--check-only] [--post-merge] [--reply-plan <json-file>]" >&2
  exit 2
fi

head_sha=""
check_only=0
post_merge=0
reply_plan=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --head)
      head_sha="${2:-}"
      if [[ -z "$head_sha" ]]; then
        echo "--head requires a commit sha" >&2
        exit 2
      fi
      shift 2
      ;;
    --check-only)
      check_only=1
      shift
      ;;
    --post-merge)
      post_merge=1
      shift
      ;;
    --reply-plan)
      reply_plan="${2:-}"
      if [[ -z "$reply_plan" ]]; then
        echo "--reply-plan requires a JSON file" >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

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
owner="${repo_nwo%%/*}"
repo="${repo_nwo#*/}"
cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"
if [[ "$post_merge" == "1" ]]; then
  "$script_dir/verify-bound-worktree.sh" --phase post-merge >/dev/null
else
  "$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
fi
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"
actor="${OPENSPEC_BUDDY_REVIEW_RESPONSE_AUTHOR:-}"
resolver="${OPENSPEC_BUDDY_RESOLVE_REVIEW_THREAD_HELPER:-$script_dir/resolve-review-thread.sh}"
reply_helper="${OPENSPEC_BUDDY_REPLY_REVIEW_THREAD_HELPER:-$script_dir/reply-review-thread.sh}"

fetch_threads() {
  rm -f "$cache_dir/review-threads-$pr_number.json"
  if ! buddy_review_threads_graphql "$owner" "$repo" "$pr_number" "$cache_dir" >/dev/null; then
    return 1
  fi
  printf '%s\n' "$BUDDY_REVIEW_THREADS_FILE"
}

fetch_threads_retry() {
  local output_file="$1"
  local stderr_file="$tmp_dir/fetch-final.err"
  set +e
  fetch_threads > "$output_file" 2>"$stderr_file"
  local status="$?"
  set -e
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi
  if grep -E '401|EOF|timeout|502|503|504|secondary rate' "$stderr_file" >/dev/null 2>&1; then
    sleep 1
    set +e
    fetch_threads > "$output_file" 2>>"$stderr_file"
    status="$?"
    set -e
    if [[ "$status" -eq 0 ]]; then
      return 0
    fi
  fi
  cat "$stderr_file" >&2
  return "$status"
}

threads_file="$(fetch_threads)"

if [[ "$check_only" == "1" ]]; then
  node "$script_dir/review-response-gate.mjs" check "$threads_file" "$reviewer"
  exit 0
fi

if [[ -n "$reply_plan" ]]; then
  if [[ -z "$head_sha" ]]; then
    echo "--reply-plan requires --head <sha>." >&2
    exit 2
  fi
  node "$script_dir/review-response-gate.mjs" validate-reply-plan "$threads_file" "$reviewer" "" "$head_sha" "$reply_plan"
  while IFS=$'\t' read -r plan_thread_id plan_body_file; do
    [[ -n "$plan_thread_id" ]] || continue
    "$reply_helper" "$pr_number" "$plan_thread_id" --head "$head_sha" --body-file "$plan_body_file" >/dev/null
  done < <(node "$script_dir/review-response-gate.mjs" reply-plan-lines "$threads_file" "$reviewer" "" "$head_sha" "$reply_plan")
  threads_file="$(fetch_threads)"
fi

if [[ -z "$actor" ]]; then
  actor="$(gh api user --jq '.login')"
fi

plan_file="$tmp_dir/plan.json"
node "$script_dir/review-response-gate.mjs" plan "$threads_file" "$reviewer" "$actor" "$head_sha" > "$plan_file"

mapfile -t thread_ids < <(node -e '
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const id of input.threadIds || []) console.log(id);
' "$plan_file")

if [[ "${#thread_ids[@]}" -eq 0 ]]; then
  printf 'Review response gate verified for PR #%s: no unresolved actionable Codex review threads.\n' "$pr_number"
  exit 0
fi

thread_id=""
for thread_id in "${thread_ids[@]}"; do
  "$resolver" "$thread_id"
done

final_threads_path="$tmp_dir/final-threads-path.txt"
if ! fetch_threads_retry "$final_threads_path"; then
  printf 'resolved_count: %s\n' "${#thread_ids[@]}"
  printf 'final_verify: transient-failed\n'
  printf 'safe_to_rerun: true\n'
  exit 1
fi
threads_file="$(cat "$final_threads_path")"
node "$script_dir/review-response-gate.mjs" verify "$threads_file" "$reviewer"
printf 'resolved_count: %s\n' "${#thread_ids[@]}"
printf 'final_verify: passed\n'
printf 'Review response gate verified for PR #%s: %s addressed Codex review thread(s) resolved.\n' "$pr_number" "${#thread_ids[@]}"
