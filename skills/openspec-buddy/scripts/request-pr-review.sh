#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
mode="${2:-}"

if [[ -z "$pr_ref" ]]; then
  echo "Usage: request-pr-review.sh <pr-number-or-url> [--dry-run]" >&2
  exit 2
fi

dry_run=0
if [[ "$mode" == "--dry-run" ]]; then
  dry_run=1
elif [[ -n "$mode" ]]; then
  echo "Unknown option: $mode" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

review_request="${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"
if [[ -z "$review_request" ]]; then
  echo "Missing OPENSPEC_BUDDY_PR_REVIEW_REQUEST; configure the explicit PR review request before entering review." >&2
  exit 2
fi

existing_comments="$(gh pr view "$pr_ref" --json comments --jq '.comments[].body' 2>/dev/null || true)"
if grep -F -- "$review_request" <<<"$existing_comments" >/dev/null; then
  printf 'PR review request already present for %s.\n' "$pr_ref"
  exit 0
fi

if [[ "$dry_run" == "1" ]]; then
  printf '[dry-run] add PR review request to %s: %s\n' "$pr_ref" "$review_request"
else
  gh pr comment "$pr_ref" --body "$review_request" >/dev/null
  printf 'PR review request added to %s.\n' "$pr_ref"
fi
