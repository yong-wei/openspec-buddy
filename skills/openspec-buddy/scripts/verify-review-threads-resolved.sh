#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ "$pr_ref" == "-h" || "$pr_ref" == "--help" ]]; then
  echo "Usage: verify-review-threads-resolved.sh <pr-number-or-url> [--post-merge]"
  exit 0
fi
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-review-threads-resolved.sh <pr-number-or-url> [--post-merge]" >&2
  exit 2
fi
shift || true

post_merge=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --post-merge)
      post_merge=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$post_merge" == "1" ]]; then
  "$script_dir/review-response-gate.sh" "$pr_ref" --check-only --post-merge
else
  "$script_dir/review-response-gate.sh" "$pr_ref" --check-only
fi
