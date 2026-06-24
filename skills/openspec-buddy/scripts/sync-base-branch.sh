#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/worktree-identity.sh"
openspec_buddy_require_core_config

base_branch="$OPENSPEC_BUDDY_BASE_BRANCH"
"$script_dir/verify-bound-worktree.sh" --phase base-sync >/dev/null
repo_root="$(buddy_worktree_repo_root)"
bound_branch="$(buddy_worktree_bound_branch "$repo_root")"
bound_base="$(buddy_worktree_bound_base "$repo_root")"
sync_ref="origin/$base_branch"
fetch_remote="origin"
fetch_branch="$base_branch"

if [[ -n "$bound_branch" ]]; then
  if [[ -n "$bound_base" ]]; then
    sync_ref="$bound_base"
  fi
  if [[ "$sync_ref" =~ ^([^/]+)/(.+)$ ]]; then
    fetch_remote="${BASH_REMATCH[1]}"
    fetch_branch="${BASH_REMATCH[2]}"
  else
    echo "Bound base '$sync_ref' must be a remote ref such as origin/$base_branch." >&2
    exit 1
  fi
fi

git fetch "$fetch_remote" "$fetch_branch" >/dev/null

if [[ -n "$(git status --porcelain=v1 -uall)" ]]; then
  echo "Worktree must be clean before syncing or verifying $base_branch." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"

if [[ -n "$bound_branch" ]]; then
  git merge --ff-only "$sync_ref" >/dev/null

  read -r ahead behind < <(git rev-list --left-right --count "HEAD...$sync_ref")
  if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
    echo "Bound branch $bound_branch is not exactly synchronized with $sync_ref: ahead=$ahead behind=$behind." >&2
    exit 1
  fi

  printf 'Bound branch %s synchronized with bound base %s at %s.\n' "$bound_branch" "$sync_ref" "$(git rev-parse --short HEAD)"
elif [[ "$current_branch" == "$base_branch" ]]; then
  git merge --ff-only "origin/$base_branch" >/dev/null

  read -r ahead behind < <(git rev-list --left-right --count "HEAD...origin/$base_branch")
  if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
    echo "Local $base_branch is not exactly synchronized with origin/$base_branch: ahead=$ahead behind=$behind." >&2
    exit 1
  fi

  printf 'Base branch %s synchronized at %s.\n' "$base_branch" "$(git rev-parse --short HEAD)"
else
  read -r ahead behind < <(git rev-list --left-right --count "HEAD...origin/$base_branch")
  if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
    echo "Current worktree HEAD is not aligned with origin/$base_branch: ahead=$ahead behind=$behind." >&2
    exit 1
  fi

  printf 'Current worktree aligned with base branch %s at %s.\n' "$base_branch" "$(git rev-parse --short HEAD)"
fi
