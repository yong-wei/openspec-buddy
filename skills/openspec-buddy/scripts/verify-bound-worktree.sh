#!/usr/bin/env bash
set -euo pipefail

phase=""
expected_branch=""
allow_detached=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --phase)
      phase="${2:-}"
      shift 2
      ;;
    --branch)
      expected_branch="${2:-}"
      shift 2
      ;;
    --allow-detached)
      allow_detached=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$phase" ]]; then
  echo "Usage: verify-bound-worktree.sh --phase <base-sync|pre-claim|goal-loop-start|post-merge|active-claim|readonly> [--branch <name>] [--allow-detached]" >&2
  exit 2
fi

case "$phase" in
  base-sync|pre-claim|goal-loop-start|post-merge|active-claim|readonly)
    ;;
  *)
    echo "Unknown bound worktree phase: $phase" >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/worktree-identity.sh"
openspec_buddy_require_core_config

repo_root="$(buddy_worktree_repo_root)"
current_branch="$(buddy_worktree_current_branch "$repo_root")"
bound_branch="$(buddy_worktree_bound_branch "$repo_root")"
bound_base="$(buddy_worktree_bound_base "$repo_root")"
if [[ -z "$bound_base" ]]; then
  bound_base="origin/$OPENSPEC_BUDDY_BASE_BRANCH"
fi

if [[ -z "$bound_branch" ]]; then
  printf 'No bound worktree branch configured; phase %s uses legacy branch alignment.\n' "$phase"
  exit 0
fi

if [[ -z "$current_branch" ]]; then
  if [[ "$phase" == "readonly" && "$allow_detached" == "1" ]]; then
    printf 'Bound worktree readonly phase allows detached HEAD for %s.\n' "$bound_branch"
    exit 0
  fi
  echo "Bound worktree guard failed: detached HEAD is not allowed during $phase; switch to '$bound_branch'." >&2
  exit 61
fi

case "$phase" in
  base-sync|pre-claim|goal-loop-start|post-merge)
    if [[ "$current_branch" != "$bound_branch" ]]; then
      echo "Bound worktree guard failed: current branch '$current_branch' does not match expected bound branch '$bound_branch' during $phase." >&2
      exit 62
    fi
    ;;
  active-claim)
    if [[ -n "$expected_branch" && "$current_branch" != "$expected_branch" ]]; then
      echo "Bound worktree guard failed: current branch '$current_branch' does not match expected claim branch '$expected_branch' during active-claim." >&2
      exit 63
    fi
    ;;
  readonly)
    ;;
esac

printf 'Bound worktree verified for phase %s on branch %s with bound branch %s and bound base %s.\n' "$phase" "$current_branch" "$bound_branch" "$bound_base"
