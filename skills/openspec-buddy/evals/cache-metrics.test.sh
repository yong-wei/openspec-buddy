#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/cache-metrics.mjs"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cache_dir="$tmp_dir/cache"
mkdir -p "$cache_dir"

"$helper" event "$cache_dir" cache issue hit '{"key":"1"}'
"$helper" event "$cache_dir" cache issue hit '{"key":"2"}'
"$helper" event "$cache_dir" cache issue miss '{"key":"3"}'
"$helper" event "$cache_dir" cache issue forced_refresh '{"key":"4"}'
"$helper" event "$cache_dir" github graphql managed_request '{"batch":1}'
"$helper" event "$cache_dir" github rest managed_request '{"batch":2}'
"$helper" event "$cache_dir" github rest managed_request '{"batch":3}'
"$helper" event "$cache_dir" coordination live-claim stale_recovery '{"status":"missing"}'

summary="$($helper summary "$cache_dir")"
expected='{"cacheHit":2,"cacheMiss":1,"forcedRefresh":1,"managedGithubRequestBatches":3,"staleRecovery":1}'
if [[ "$summary" != "$expected" ]]; then
  echo "unexpected metrics summary: $summary" >&2
  exit 1
fi

line_count="$(wc -l < "$cache_dir/cache-metrics.jsonl" | tr -d ' ')"
if [[ "$line_count" != "8" ]]; then
  echo "expected eight append-only metric events, got $line_count" >&2
  exit 1
fi

echo "cache-metrics tests passed"
