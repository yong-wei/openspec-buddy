#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-review-threads-resolved.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/review-response-gate.sh" "$pr_ref" --check-only
