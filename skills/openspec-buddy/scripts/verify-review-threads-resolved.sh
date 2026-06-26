#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ "$pr_ref" == "-h" || "$pr_ref" == "--help" ]]; then
  echo "Usage: verify-review-threads-resolved.sh <pr-number-or-url>"
  exit 0
fi
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-review-threads-resolved.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/review-response-gate.sh" "$pr_ref" --check-only
