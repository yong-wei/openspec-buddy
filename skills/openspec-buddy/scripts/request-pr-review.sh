#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"

if [[ "$pr_ref" == "-h" || "$pr_ref" == "--help" ]]; then
  echo "Usage: request-pr-review.sh <pr-number-or-url> [--dry-run] [--force] [--context-file <file>] [--require-threads-resolved]"
  exit 0
fi

if [[ -z "$pr_ref" ]]; then
  echo "Usage: request-pr-review.sh <pr-number-or-url> [--dry-run] [--force] [--context-file <file>] [--require-threads-resolved]" >&2
  exit 2
fi

dry_run=0
force_request=0
context_file=""
require_threads_resolved=0
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --force)
      force_request=1
      shift
      ;;
    --context-file)
      context_file="${2:-}"
      if [[ -z "$context_file" ]]; then
        echo "Missing value for --context-file." >&2
        exit 2
      fi
      shift 2
      ;;
    --require-threads-resolved)
      require_threads_resolved=1
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
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
openspec_buddy_require_core_config

review_request="${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"
if [[ -z "$review_request" ]]; then
  echo "Missing OPENSPEC_BUDDY_PR_REVIEW_REQUEST; configure the explicit PR review request before entering review." >&2
  exit 2
fi
review_request_body="$review_request"
if [[ -n "$context_file" ]]; then
  if [[ ! -f "$context_file" ]]; then
    echo "Review request context file not found: $context_file" >&2
    exit 2
  fi
  review_context="$(<"$context_file")"
  if [[ -n "$review_context" ]]; then
    review_request_body="${review_request_body}"$'\n\n'"${review_context}"
  fi
fi

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
  return 1
}

cache_dir="$(buddy_cache_dir)"
repo_nwo="$(buddy_repo_nwo)"
buddy_signal_apply "$cache_dir" "$repo_nwo"
pr_number="$(resolve_pr_number "$pr_ref")" || {
  echo "Could not resolve pull request number from: $pr_ref" >&2
  exit 1
}

"$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
if [[ "$require_threads_resolved" == "1" || "${OPENSPEC_BUDDY_REVIEW_FIX_CONTEXT:-0}" == "1" ]]; then
  "$script_dir/verify-review-threads-resolved.sh" "$pr_ref"
fi

OPENSPEC_BUDDY_CACHE_REFRESH=1 buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
request_state="$(node "$script_dir/review-request-state.mjs" "$review_request" "$BUDDY_PR_REST_FILE" "$BUDDY_COMMITS_FILE" "$BUDDY_ISSUE_COMMENTS_FILE")"

clear_candidate="$(node "$script_dir/current-head-clear-comment-candidate.mjs" "$review_request" "$BUDDY_PR_REST_FILE" "$BUDDY_COMMITS_FILE" "$BUDDY_ISSUE_COMMENTS_FILE" "$BUDDY_REVIEWS_FILE" "${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}")"
if [[ "$(node -e 'const data=JSON.parse(process.argv[1]); process.stdout.write(data.hasCandidate ? "1" : "0");' "$clear_candidate")" == "1" ]]; then
  clear_output="$(mktemp)"
  clear_status=0
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" \
    OPENSPEC_BUDDY_REUSE_PR_REST_CACHE=1 \
    "$script_dir/verify-review-clear.sh" "$pr_number" \
      --pr-file "$BUDDY_PR_REST_FILE" \
      --reviews-file "$BUDDY_REVIEWS_FILE" \
      --commits-file "$BUDDY_COMMITS_FILE" \
      --issue-comments-file "$BUDDY_ISSUE_COMMENTS_FILE" \
      --review-comments-file "$BUDDY_REVIEW_COMMENTS_FILE" > "$clear_output" 2>&1 || clear_status="$?"
  if [[ "$clear_status" -eq 0 ]]; then
    cat "$clear_output"
    rm -f "$clear_output"
    printf 'PR review already clear for %s; refusing to request duplicate review.\n' "$pr_ref"
    exit 0
  fi
  rm -f "$clear_output"
fi

if [[ "$request_state" == "present-current-head" && "$force_request" != "1" ]]; then
  printf 'PR review request already present for %s (%s).\n' "$pr_ref" "$request_state"
  exit 0
fi

if [[ "$dry_run" == "1" ]]; then
  printf '[dry-run] add PR review request to %s: %s\n' "$pr_ref" "$review_request_body"
else
  run_with_timeout gh pr comment "$pr_ref" --body "$review_request_body" >/dev/null
  buddy_invalidate_cache "$(buddy_cache_path pr "$pr_number" "$cache_dir")"
  buddy_invalidate_pr_rest_bundle_cache "$cache_dir" "$pr_number"
  if [[ "${OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH:-0}" != "1" ]]; then
    buddy_signal_publish request-pr-review "pr:$pr_number"
  fi
  printf 'PR review request added to %s.\n' "$pr_ref"
fi
