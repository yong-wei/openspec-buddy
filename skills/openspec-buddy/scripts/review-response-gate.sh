#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
shift || true

if [[ -z "$pr_ref" ]]; then
  echo "Usage: review-response-gate.sh <pr-number-or-url> [--head <sha>] [--check-only]" >&2
  exit 2
fi

head_sha=""
check_only=0
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
"$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"
actor="${OPENSPEC_BUDDY_REVIEW_RESPONSE_AUTHOR:-}"
resolver="${OPENSPEC_BUDDY_RESOLVE_REVIEW_THREAD_HELPER:-$script_dir/resolve-review-thread.sh}"

fetch_threads() {
  rm -f "$cache_dir/review-threads-$pr_number.json"
  buddy_review_threads_graphql "$owner" "$repo" "$pr_number" "$cache_dir" >/dev/null
  printf '%s\n' "$BUDDY_REVIEW_THREADS_FILE"
}

threads_file="$(fetch_threads)"

if [[ "$check_only" == "1" ]]; then
  node "$script_dir/review-response-gate.mjs" check "$threads_file" "$reviewer"
  exit 0
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

threads_file="$(fetch_threads)"
node "$script_dir/review-response-gate.mjs" verify "$threads_file" "$reviewer"
printf 'Review response gate verified for PR #%s: %s addressed Codex review thread(s) resolved.\n' "$pr_number" "${#thread_ids[@]}"
