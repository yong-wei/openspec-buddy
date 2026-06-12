#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"

repo_root="$(openspec_buddy_repo_root)"
cache_dir="${1:-${OPENSPEC_BUDDY_CACHE_DIR:-${OPENSPEC_BUDDY_GH_CACHE_DIR:-}}}"

resolved_dir="$(node "$script_dir/buddy-cache.mjs" ensure "$repo_root" "$cache_dir")"
export OPENSPEC_BUDDY_CACHE_DIR="$resolved_dir"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$resolved_dir"
printf '%s\n' "$resolved_dir"
