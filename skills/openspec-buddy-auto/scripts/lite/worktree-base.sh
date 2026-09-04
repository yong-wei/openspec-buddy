#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/../../../openspec-buddy/scripts/load-config.sh"
openspec_buddy_require_local_only_config

command_name="${1:-}"
case "$command_name" in
  enter|leave) ;;
  *)
    echo "Usage: worktree-base.sh <enter|leave> [change_id]" >&2
    exit 2
    ;;
esac

change_id="${2:-}"
if [[ "$command_name" == "leave" ]]; then
  if [[ ! "$change_id" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    echo "Usage: worktree-base.sh leave <change_id>" >&2
    exit 2
  fi
fi

worktree_config_get() {
  git config --worktree --get "$1" 2>/dev/null || true
}

validate_ref_name() {
  local label="$1" value="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ || "$value" == *..* ]]; then
    echo "Invalid $label: '$value'." >&2
    exit 1
  fi
}

validate_ref_name "OPENSPEC_BUDDY_BASE_BRANCH" "$OPENSPEC_BUDDY_BASE_BRANCH"

bound_branch="$(worktree_config_get buddy.boundBranch)"
bound_base="$(worktree_config_get buddy.boundBase)"
if [[ -z "$bound_base" ]]; then
  bound_base="origin/$OPENSPEC_BUDDY_BASE_BRANCH"
fi
if [[ -n "$bound_branch" ]]; then
  validate_ref_name "buddy.boundBranch" "$bound_branch"
fi
validate_ref_name "buddy.boundBase" "$bound_base"

require_clean_worktree() {
  if [[ -n "$(git status --porcelain=v1 -uall)" ]]; then
    echo "$1" >&2
    exit 1
  fi
}

align_with_bound_base() {
  local fetch_remote fetch_base
  if [[ "$bound_base" =~ ^([^/]+)/(.+)$ ]]; then
    fetch_remote="${BASH_REMATCH[1]}"
    fetch_base="${BASH_REMATCH[2]}"
  else
    echo "Bound base '$bound_base' must be a remote ref such as origin/$OPENSPEC_BUDDY_BASE_BRANCH." >&2
    exit 1
  fi

  git fetch "$fetch_remote" "$fetch_base" >/dev/null
  require_clean_worktree "Worktree must be clean before aligning with $bound_base; commit or stash your changes and retry."
  git merge --ff-only "$bound_base" >/dev/null

  local ahead behind
  read -r ahead behind < <(git rev-list --left-right --count "HEAD...$bound_base")
  if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
    echo "Branch $(git branch --show-current) diverged from $bound_base: ahead=$ahead behind=$behind. Resolve the divergence manually before claiming new work." >&2
    exit 1
  fi

  printf 'Aligned %s with %s at %s.\n' "$(git branch --show-current)" "$bound_base" "$(git rev-parse --short HEAD)" >&2
}

if [[ "$command_name" == "enter" ]]; then
  if [[ -z "$bound_branch" ]]; then
    echo "No buddy.boundBranch configured; enter keeps legacy branch behavior." >&2
    exit 0
  fi

  current_branch="$(git branch --show-current)"
  if [[ -z "$current_branch" ]]; then
    echo "Detached HEAD is not allowed before a new claim; switch to bound branch '$bound_branch'." >&2
    exit 1
  fi
  if [[ "$current_branch" != "$bound_branch" ]]; then
    require_clean_worktree "Worktree is not clean on branch '$current_branch'; commit or stash your changes, then switch to '$bound_branch' manually or retry."
    git switch -- "$bound_branch" >&2
    printf 'Switched to bound branch %s.\n' "$bound_branch" >&2
  fi

  align_with_bound_base
  exit 0
fi

# leave <change_id>
require_clean_worktree "Worktree must be clean before leaving the claim branch; commit or stash your changes and retry."

current_branch="$(git branch --show-current)"
return_branch="$bound_branch"
if [[ -z "$return_branch" ]]; then
  return_branch="$OPENSPEC_BUDDY_BASE_BRANCH"
fi
if [[ "$current_branch" == "$change_id" ]]; then
  git switch -- "$return_branch" >&2
  printf 'Switched from claim branch %s to %s.\n' "$change_id" "$return_branch" >&2
fi
if [[ "$(git branch --show-current)" == "$change_id" ]]; then
  echo "Could not leave claim branch '$change_id'." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$change_id"; then
  if ! remote_ref="$(git ls-remote origin "refs/heads/$change_id" 2>/dev/null)"; then
    echo "Could not read remote state for claim branch '$change_id'; refusing to delete the local branch." >&2
    exit 1
  fi
  if [[ -n "$remote_ref" ]]; then
    if ! git fetch origin "refs/heads/$change_id:refs/remotes/origin/$change_id" >/dev/null 2>&1; then
      echo "Could not fetch origin/$change_id; refusing to delete the local branch." >&2
      exit 1
    fi
    if ! git merge-base --is-ancestor "$change_id" "origin/$change_id"; then
      echo "Local claim branch '$change_id' has commits not present on origin/$change_id; refusing to delete it. Push or reconcile the branch manually." >&2
      exit 1
    fi
  else
    echo "Warning: remote claim branch origin/$change_id no longer exists; assuming closeout verified delivery." >&2
  fi
  git branch -D -- "$change_id" >/dev/null
  printf 'Deleted local claim branch %s.\n' "$change_id" >&2
fi

align_with_bound_base
