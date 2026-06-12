#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/resolve-review-thread.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

stub_bin="$tmp_dir/bin"
mkdir -p "$stub_bin"
ln -s "$repo_root/skills/openspec-buddy/evals/fixtures/resolve-review-thread-gh-stub.sh" "$stub_bin/gh"

run_case() {
  local case_name="$1"
  local expected_status="$2"
  local expected_count="$3"
  local count_file="$tmp_dir/count-$case_name"
  local case_file="$tmp_dir/case-$case_name"
  printf '%s' "$case_name" > "$case_file"
  : > "$count_file"

  set +e
  PATH="$stub_bin:$PATH" \
  OPENSPEC_BUDDY_BASE_BRANCH=integration \
  OPENSPEC_BUDDY_RELEASE_BRANCH=main \
  OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei \
  OPENSPEC_BUDDY_PROJECT_NUMBER=1 \
  OPENSPEC_BUDDY_PROJECT_TITLE="ACT Openspec LTE" \
  RESOLVE_THREAD_CASE_FILE="$case_file" \
  RESOLVE_THREAD_COUNT_FILE="$count_file" \
    "$helper" THREAD_1 > "$tmp_dir/stdout-$case_name" 2> "$tmp_dir/stderr-$case_name"
  local status="$?"
  set -e

  if [[ "$status" != "$expected_status" ]]; then
    echo "case $case_name expected status $expected_status, got $status" >&2
    cat "$tmp_dir/stdout-$case_name" >&2
    cat "$tmp_dir/stderr-$case_name" >&2
    exit 1
  fi

  local count
  count="$(cat "$count_file")"
  if [[ "$count" != "$expected_count" ]]; then
    echo "case $case_name expected gh count $expected_count, got $count" >&2
    exit 1
  fi
}

run_case already-resolved 0 1
run_case resolve-success 0 3
run_case resolve-still-open 1 3

echo "resolve-review-thread tests passed"
