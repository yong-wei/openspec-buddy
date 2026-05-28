#!/usr/bin/env bash

# Shared OpenSpec Buddy configuration. Source this file from shell helpers before
# reading any OPENSPEC_BUDDY_* value.

openspec_buddy_missing_config=()

openspec_buddy_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

openspec_buddy_repo_root() {
  if [[ -n "${OPENSPEC_BUDDY_REPO_ROOT:-}" ]]; then
    cd "$OPENSPEC_BUDDY_REPO_ROOT" && pwd
    return 0
  fi

  if git rev-parse --show-toplevel >/dev/null 2>&1; then
    git rev-parse --show-toplevel
    return 0
  fi

  pwd
}

openspec_buddy_decode_env_value() {
  local value
  value="$(openspec_buddy_trim "$1")"

  if [[ "$value" == \"*\" && "$value" == *\" && "${#value}" -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' && "${#value}" -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

openspec_buddy_load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0

  local line trimmed name value line_number
  line_number=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    trimmed="$(openspec_buddy_trim "$line")"

    if [[ -z "$trimmed" || "$trimmed" == \#* ]]; then
      continue
    fi

    if [[ "$trimmed" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      name="${BASH_REMATCH[2]}"
      value="$(openspec_buddy_decode_env_value "${BASH_REMATCH[3]}")"
    else
      printf 'Invalid OpenSpec Buddy env file line: %s:%s\n' "$env_file" "$line_number" >&2
      exit 2
    fi

    if [[ "$name" != OPENSPEC_BUDDY_* ]]; then
      continue
    fi

    if [[ -z "${!name:-}" ]]; then
      export "$name=$value"
    fi
  done <"$env_file"
}

openspec_buddy_load_project_env() {
  local env_file="${OPENSPEC_BUDDY_ENV_FILE:-}"

  if [[ -z "$env_file" ]]; then
    env_file="$(openspec_buddy_repo_root)/.env.openspec-buddy"
  fi

  openspec_buddy_load_env_file "$env_file"
}

openspec_buddy_load_project_env

openspec_buddy_require_var() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    openspec_buddy_missing_config+=("$name")
  fi
}

openspec_buddy_print_missing_and_exit() {
  if [[ "${#openspec_buddy_missing_config[@]}" -eq 0 ]]; then
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  {
    echo "Missing OpenSpec Buddy configuration:"
    for name in "${openspec_buddy_missing_config[@]}"; do
      echo "- $name"
    done
    echo
    echo "First run: ask the user for these project values, then generate .env.openspec-buddy."
    echo "Use: $script_dir/init-config.sh"
    echo "If the npm package is installed, use: openspec-buddy init"
  } >&2
  exit 2
}

openspec_buddy_apply_optional_defaults() {
  export OPENSPEC_BUDDY_PROJECT_STATUS_FIELD="${OPENSPEC_BUDDY_PROJECT_STATUS_FIELD:-Status}"
  export OPENSPEC_BUDDY_PROJECT_STATUS_TODO="${OPENSPEC_BUDDY_PROJECT_STATUS_TODO:-Todo}"
  export OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS="${OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS:-In Progress}"
  export OPENSPEC_BUDDY_PROJECT_STATUS_DONE="${OPENSPEC_BUDDY_PROJECT_STATUS_DONE:-Done}"
  export OPENSPEC_BUDDY_PROJECT_START_FIELD="${OPENSPEC_BUDDY_PROJECT_START_FIELD:-Start}"
  export OPENSPEC_BUDDY_PROJECT_END_FIELD="${OPENSPEC_BUDDY_PROJECT_END_FIELD:-End}"
  export OPENSPEC_BUDDY_CLAIM_TTL_HOURS="${OPENSPEC_BUDDY_CLAIM_TTL_HOURS:-12}"
  export OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS="${OPENSPEC_BUDDY_REVIEW_WAIT_SECONDS:-300}"
  export OPENSPEC_BUDDY_REVIEW_QUIET_CHECKS="${OPENSPEC_BUDDY_REVIEW_QUIET_CHECKS:-3}"
  export OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS="${OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS:-300}"
  export OPENSPEC_BUDDY_REVIEW_POLL_SECONDS="${OPENSPEC_BUDDY_REVIEW_POLL_SECONDS:-120}"
  export OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS="${OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS:-900}"
  export OPENSPEC_BUDDY_COMMAND_PREFIX="${OPENSPEC_BUDDY_COMMAND_PREFIX:-}"
  export OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE="${OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE:-auto}"
}

openspec_buddy_require_core_config() {
  openspec_buddy_missing_config=()
  openspec_buddy_apply_optional_defaults
  openspec_buddy_require_var OPENSPEC_BUDDY_BASE_BRANCH
  openspec_buddy_require_var OPENSPEC_BUDDY_RELEASE_BRANCH
  openspec_buddy_require_var OPENSPEC_BUDDY_PROJECT_OWNER
  openspec_buddy_require_var OPENSPEC_BUDDY_PROJECT_NUMBER
  openspec_buddy_require_var OPENSPEC_BUDDY_PROJECT_TITLE
  openspec_buddy_print_missing_and_exit
}

openspec_buddy_require_auto_config() {
  openspec_buddy_require_core_config
  openspec_buddy_missing_config=()
  openspec_buddy_require_var OPENSPEC_BUDDY_PR_REVIEW_REQUEST
  openspec_buddy_print_missing_and_exit
}
