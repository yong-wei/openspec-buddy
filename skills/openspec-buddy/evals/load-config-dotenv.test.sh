#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check_config="$script_dir/../scripts/check-config.sh"
parse_issue_metadata="$script_dir/../scripts/parse-issue-metadata.mjs"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

env_file="$tmp_dir/openspec-buddy.env"
cat >"$env_file" <<'ENV'
OPENSPEC_BUDDY_BASE_BRANCH=dotenv-base
OPENSPEC_BUDDY_RELEASE_BRANCH=dotenv-release
OPENSPEC_BUDDY_PROJECT_OWNER=dotenv-owner
OPENSPEC_BUDDY_PROJECT_NUMBER=42
OPENSPEC_BUDDY_PROJECT_TITLE="Dotenv Project"
OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS="Doing Work"
OPENSPEC_BUDDY_COMMAND_PREFIX=rtk
OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=keyword
OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复"
ENV

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\n\nOutput:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

output="$(
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    OPENSPEC_BUDDY_ENV_FILE="$env_file" \
    bash "$check_config" auto
)"

assert_contains "$output" "base_branch=dotenv-base"
assert_contains "$output" "release_branch=dotenv-release"
assert_contains "$output" "project_owner=dotenv-owner"
assert_contains "$output" "project_number=42"
assert_contains "$output" "project_title=Dotenv Project"
assert_contains "$output" "project_status_in_progress=Doing Work"
assert_contains "$output" "command_prefix=rtk"
assert_contains "$output" "pr_development_link_mode=keyword"
assert_contains "$output" "pr_review_request=@codex review 中文回复"

override_output="$(
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    OPENSPEC_BUDDY_ENV_FILE="$env_file" \
    OPENSPEC_BUDDY_BASE_BRANCH=external-base \
    bash "$check_config" core
)"

assert_contains "$override_output" "base_branch=external-base"

issue_body="$tmp_dir/issue.md"
cat >"$issue_body" <<'ISSUE'
---
change_id: sample-change
claim_branch: sample-change
series: sample-series
coupling_group: none
execution_mode: isolated
base_branch: dotenv-base
depends_on: []
blocked_by: []
blocking: []
openspec_path: openspec/changes/sample-change
risk: low
area: tooling
---

Sample issue.
ISSUE

metadata_output="$(
  env -i \
    PATH="$PATH" \
    HOME="$HOME" \
    OPENSPEC_BUDDY_ENV_FILE="$env_file" \
    node "$parse_issue_metadata" "$issue_body"
)"

assert_contains "$metadata_output" '"base_branch": "dotenv-base"'
