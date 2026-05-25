#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

base_branch="$OPENSPEC_BUDDY_BASE_BRANCH"

git fetch origin "$base_branch" >/dev/null

if [[ -n "$(git status --porcelain=v1 -uall)" ]]; then
  echo "Worktree must be clean before syncing $base_branch." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$base_branch"; then
  git switch "$base_branch" >/dev/null
else
  git switch -c "$base_branch" --track "origin/$base_branch" >/dev/null
fi

git merge --ff-only "origin/$base_branch" >/dev/null

read -r ahead behind < <(git rev-list --left-right --count "HEAD...origin/$base_branch")
if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
  echo "Local $base_branch is not exactly synchronized with origin/$base_branch: ahead=$ahead behind=$behind." >&2
  exit 1
fi

printf 'Base branch %s synchronized at %s.\n' "$base_branch" "$(git rev-parse --short HEAD)"
