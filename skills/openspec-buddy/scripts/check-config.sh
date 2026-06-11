#!/usr/bin/env bash
set -euo pipefail

mode="${1:-core}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"

case "$mode" in
  core)
    openspec_buddy_require_core_config
    ;;
  local)
    openspec_buddy_require_local_only_config
    ;;
  auto)
    openspec_buddy_require_auto_config
    ;;
  *)
    echo "Usage: check-config.sh [core|local|auto]" >&2
    exit 2
    ;;
esac

printf '%s\n' \
  "OpenSpec Buddy configuration ok." \
  "base_branch=$OPENSPEC_BUDDY_BASE_BRANCH" \
  "project_status_field=$OPENSPEC_BUDDY_PROJECT_STATUS_FIELD" \
  "project_status_todo=$OPENSPEC_BUDDY_PROJECT_STATUS_TODO" \
  "project_status_in_progress=$OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS" \
  "project_status_done=$OPENSPEC_BUDDY_PROJECT_STATUS_DONE" \
  "project_start_field=$OPENSPEC_BUDDY_PROJECT_START_FIELD" \
  "project_end_field=$OPENSPEC_BUDDY_PROJECT_END_FIELD" \
  "claim_ttl_hours=$OPENSPEC_BUDDY_CLAIM_TTL_HOURS" \
  "review_wait_seconds=$OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS" \
  "review_quiet_checks=$OPENSPEC_BUDDY_REVIEW_QUIET_CHECKS" \
  "review_initial_wait_seconds=$OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS" \
  "review_poll_seconds=$OPENSPEC_BUDDY_REVIEW_POLL_SECONDS" \
  "review_max_wait_seconds=$OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS" \
  "command_prefix=$OPENSPEC_BUDDY_COMMAND_PREFIX" \
  "pr_development_link_mode=$OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE"

if [[ "$mode" != "local" ]]; then
  printf '%s\n' \
    "release_branch=$OPENSPEC_BUDDY_RELEASE_BRANCH" \
    "project_owner=$OPENSPEC_BUDDY_PROJECT_OWNER" \
    "project_number=$OPENSPEC_BUDDY_PROJECT_NUMBER" \
    "project_title=$OPENSPEC_BUDDY_PROJECT_TITLE"
fi

if [[ "$mode" == "auto" ]]; then
  printf 'pr_review_request=%s\n' "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST"
fi
