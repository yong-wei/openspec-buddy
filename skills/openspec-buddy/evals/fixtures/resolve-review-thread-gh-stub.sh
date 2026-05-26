#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "api" || "${2:-}" != "graphql" ]]; then
  echo "unexpected gh invocation: $*" >&2
  exit 9
fi

case_file="${RESOLVE_THREAD_CASE_FILE:?}"
count_file="${RESOLVE_THREAD_COUNT_FILE:?}"
count="$(cat "$count_file" 2>/dev/null || printf '0')"
count=$((count + 1))
printf '%s' "$count" > "$count_file"

case_name="$(cat "$case_file")"
args="$*"
thread_id="THREAD_1"

if [[ "$args" == *"resolveReviewThread"* ]]; then
  printf '{"data":{"resolveReviewThread":{"thread":{"id":"%s","isResolved":true}}}}\n' "$thread_id"
  exit 0
fi

case "$case_name:$count" in
  already-resolved:1)
    printf '{"data":{"node":{"id":"%s","isResolved":true,"isOutdated":false,"path":"src/app.ts","line":42}}}\n' "$thread_id"
    ;;
  resolve-success:1)
    printf '{"data":{"node":{"id":"%s","isResolved":false,"isOutdated":true,"path":"src/app.ts","line":42}}}\n' "$thread_id"
    ;;
  resolve-success:3)
    printf '{"data":{"node":{"id":"%s","isResolved":true,"isOutdated":true,"path":"src/app.ts","line":42}}}\n' "$thread_id"
    ;;
  resolve-still-open:1)
    printf '{"data":{"node":{"id":"%s","isResolved":false,"isOutdated":true,"path":"src/app.ts","line":42}}}\n' "$thread_id"
    ;;
  resolve-still-open:3)
    printf '{"data":{"node":{"id":"%s","isResolved":false,"isOutdated":true,"path":"src/app.ts","line":42}}}\n' "$thread_id"
    ;;
  *)
    echo "unexpected case/count $case_name:$count" >&2
    exit 10
    ;;
esac
