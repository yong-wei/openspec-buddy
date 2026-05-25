#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/sync-base-branch.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=opt-de
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"

git init --bare "$tmp_dir/origin.git" >/dev/null
git clone "$tmp_dir/origin.git" "$tmp_dir/seed" >/dev/null 2>&1
git -C "$tmp_dir/seed" config user.email test@example.com
git -C "$tmp_dir/seed" config user.name "Test User"
printf 'base\n' > "$tmp_dir/seed/README.md"
git -C "$tmp_dir/seed" add README.md
git -C "$tmp_dir/seed" commit -m "base" >/dev/null
git -C "$tmp_dir/seed" branch -M integration
git -C "$tmp_dir/seed" push origin integration >/dev/null 2>&1

git clone "$tmp_dir/origin.git" "$tmp_dir/work" >/dev/null 2>&1
git -C "$tmp_dir/work" switch -c topic origin/integration >/dev/null 2>&1

(cd "$tmp_dir/work" && "$helper")
current_branch="$(git -C "$tmp_dir/work" branch --show-current)"
if [[ "$current_branch" != "topic" ]]; then
  echo "sync-base-branch.sh changed the current worktree branch" >&2
  exit 1
fi
if [[ "$(git -C "$tmp_dir/work" rev-parse HEAD)" != "$(git -C "$tmp_dir/work" rev-parse origin/integration)" ]]; then
  echo "sync-base-branch.sh accepted a worktree that was not aligned with origin/integration" >&2
  exit 1
fi

git -C "$tmp_dir/seed" switch integration >/dev/null
printf 'remote\n' >> "$tmp_dir/seed/README.md"
git -C "$tmp_dir/seed" commit -am "remote update" >/dev/null
git -C "$tmp_dir/seed" push origin integration >/dev/null 2>&1

if (cd "$tmp_dir/work" && "$helper") >"$tmp_dir/behind.out" 2>"$tmp_dir/behind.err"; then
  echo "sync-base-branch.sh fast-forwarded a non-base worktree branch" >&2
  exit 1
fi
if ! grep -F "Current worktree HEAD is not aligned with origin/integration" "$tmp_dir/behind.err" >/dev/null; then
  echo "sync-base-branch.sh did not explain the non-base alignment failure" >&2
  exit 1
fi
if [[ "$(git -C "$tmp_dir/work" branch --show-current)" != "topic" ]]; then
  echo "sync-base-branch.sh changed branch after non-base alignment failure" >&2
  exit 1
fi

git clone "$tmp_dir/origin.git" "$tmp_dir/basework" >/dev/null 2>&1
git -C "$tmp_dir/basework" switch -c integration origin/integration >/dev/null 2>&1
git -C "$tmp_dir/seed" switch integration >/dev/null
printf 'remote 2\n' >> "$tmp_dir/seed/README.md"
git -C "$tmp_dir/seed" commit -am "remote update 2" >/dev/null
git -C "$tmp_dir/seed" push origin integration >/dev/null 2>&1
(cd "$tmp_dir/basework" && "$helper")
if [[ "$(git -C "$tmp_dir/basework" rev-parse HEAD)" != "$(git -C "$tmp_dir/basework" rev-parse origin/integration)" ]]; then
  echo "sync-base-branch.sh did not fast-forward the configured base branch" >&2
  exit 1
fi

printf 'dirty\n' >> "$tmp_dir/work/README.md"
if (cd "$tmp_dir/work" && "$helper") >"$tmp_dir/sync-base-dirty.out" 2>"$tmp_dir/sync-base-dirty.err"; then
  echo "sync-base-branch.sh succeeded with a dirty worktree" >&2
  exit 1
fi
if ! grep -F "Worktree must be clean" "$tmp_dir/sync-base-dirty.err" >/dev/null; then
  echo "sync-base-branch.sh did not explain the dirty worktree failure" >&2
  exit 1
fi

echo "sync-base-branch tests passed"
