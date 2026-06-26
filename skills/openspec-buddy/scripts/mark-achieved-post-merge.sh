#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: mark-achieved-post-merge.sh <issue-number> <archive-path> <pr-number-or-url>"
  exit 0
fi

issue_number="${1:-}"
archive_path="${2:-}"
pr_ref="${3:-}"
if [[ -z "$issue_number" || -z "$archive_path" || -z "$pr_ref" ]]; then
  echo "Usage: mark-achieved-post-merge.sh <issue-number> <archive-path> <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

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

verify_inputs_helper="${OPENSPEC_BUDDY_VERIFY_POST_MERGE_ACHIEVEMENT_INPUTS_HELPER:-$script_dir/verify-post-merge-achievement-inputs.sh}"
verify_threads_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_THREADS_RESOLVED_HELPER:-$script_dir/verify-review-threads-resolved.sh}"
mark_achieved_helper="${OPENSPEC_BUDDY_MARK_ACHIEVED_HELPER:-$script_dir/mark-achieved.sh}"

"$verify_inputs_helper" "$issue_number" "$archive_path" "$pr_ref" >/dev/null
pr_number="$(resolve_pr_number "$pr_ref")"

"$verify_threads_helper" "$pr_number" --post-merge >/dev/null
OPENSPEC_BUDDY_POST_MERGE=1 "$mark_achieved_helper" "$issue_number" "$archive_path" "$pr_number"
