#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sync_helper="$script_dir/../scripts/sync-base-branch.sh"
bound_helper="$script_dir/../scripts/verify-bound-worktree.sh"
claim_helper="$script_dir/../scripts/claim-issue.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE=Project

git init --bare "$tmp_dir/origin.git" >/dev/null
git clone "$tmp_dir/origin.git" "$tmp_dir/seed" >/dev/null 2>&1
git -C "$tmp_dir/seed" config user.email test@example.com
git -C "$tmp_dir/seed" config user.name "Test User"
printf 'base\n' > "$tmp_dir/seed/README.md"
git -C "$tmp_dir/seed" add README.md
git -C "$tmp_dir/seed" commit -m "base" >/dev/null
git -C "$tmp_dir/seed" branch -M integration
git -C "$tmp_dir/seed" push origin integration >/dev/null 2>&1

configure_bound_worktree() {
  local repo="$1"
  local branch="$2"
  local bound_base="${3:-origin/integration}"
  git -C "$repo" config extensions.worktreeConfig true
  git -C "$repo" config --worktree buddy.boundBranch "$branch"
  git -C "$repo" config --worktree buddy.boundBase "$bound_base"
  git -C "$repo" config --worktree buddy.worktreeAlias "$branch"
}

git clone "$tmp_dir/origin.git" "$tmp_dir/dev2" >/dev/null 2>&1
git -C "$tmp_dir/dev2" switch -c dev2 origin/integration >/dev/null 2>&1
configure_bound_worktree "$tmp_dir/dev2" dev2

git -C "$tmp_dir/seed" switch integration >/dev/null
printf 'remote\n' >> "$tmp_dir/seed/README.md"
git -C "$tmp_dir/seed" commit -am "remote update" >/dev/null
git -C "$tmp_dir/seed" push origin integration >/dev/null 2>&1

(cd "$tmp_dir/dev2" && "$sync_helper")
if [[ "$(git -C "$tmp_dir/dev2" rev-parse HEAD)" != "$(git -C "$tmp_dir/dev2" rev-parse origin/integration)" ]]; then
  echo "sync-base-branch.sh did not fast-forward the bound branch" >&2
  exit 1
fi
if [[ "$(git -C "$tmp_dir/dev2" branch --show-current)" != "dev2" ]]; then
  echo "sync-base-branch.sh left the bound branch" >&2
  exit 1
fi

git clone "$tmp_dir/origin.git" "$tmp_dir/boundbase" >/dev/null 2>&1
git -C "$tmp_dir/boundbase" switch -c dev2 origin/integration >/dev/null 2>&1
configure_bound_worktree "$tmp_dir/boundbase" dev2 origin/integration
(
  export OPENSPEC_BUDDY_BASE_BRANCH=wrong-base
  cd "$tmp_dir/boundbase" && "$sync_helper"
)
if [[ "$(git -C "$tmp_dir/boundbase" rev-parse HEAD)" != "$(git -C "$tmp_dir/boundbase" rev-parse origin/integration)" ]]; then
  echo "sync-base-branch.sh did not use buddy.boundBase when base branch env differed" >&2
  exit 1
fi

git clone "$tmp_dir/origin.git" "$tmp_dir/detached" >/dev/null 2>&1
git -C "$tmp_dir/detached" switch -c dev2 origin/integration >/dev/null 2>&1
configure_bound_worktree "$tmp_dir/detached" dev2
git -C "$tmp_dir/detached" switch --detach origin/integration >/dev/null 2>&1
if (cd "$tmp_dir/detached" && "$bound_helper" --phase pre-claim) >"$tmp_dir/detached.out" 2>"$tmp_dir/detached.err"; then
  echo "verify-bound-worktree.sh accepted detached HEAD in a bound worktree" >&2
  exit 1
fi
if ! grep -F "detached HEAD" "$tmp_dir/detached.err" >/dev/null; then
  echo "verify-bound-worktree.sh did not explain detached HEAD failure" >&2
  cat "$tmp_dir/detached.err" >&2
  exit 1
fi
if (cd "$tmp_dir/detached" && "$sync_helper") >"$tmp_dir/sync-detached.out" 2>"$tmp_dir/sync-detached.err"; then
  echo "sync-base-branch.sh accepted detached HEAD in a bound worktree" >&2
  exit 1
fi
if ! grep -F "detached HEAD" "$tmp_dir/sync-detached.err" >/dev/null; then
  echo "sync-base-branch.sh did not surface detached HEAD failure" >&2
  cat "$tmp_dir/sync-detached.err" >&2
  exit 1
fi

git clone "$tmp_dir/origin.git" "$tmp_dir/wrong" >/dev/null 2>&1
git -C "$tmp_dir/wrong" switch -c topic origin/integration >/dev/null 2>&1
configure_bound_worktree "$tmp_dir/wrong" dev2
if (cd "$tmp_dir/wrong" && "$bound_helper" --phase pre-claim) >"$tmp_dir/wrong.out" 2>"$tmp_dir/wrong.err"; then
  echo "verify-bound-worktree.sh accepted a non-bound branch" >&2
  exit 1
fi
if ! grep -F "expected bound branch 'dev2'" "$tmp_dir/wrong.err" >/dev/null; then
  echo "verify-bound-worktree.sh did not explain non-bound branch failure" >&2
  cat "$tmp_dir/wrong.err" >&2
  exit 1
fi

git clone "$tmp_dir/origin.git" "$tmp_dir/unbound" >/dev/null 2>&1
git -C "$tmp_dir/unbound" switch -c topic origin/integration >/dev/null 2>&1
(cd "$tmp_dir/unbound" && "$bound_helper" --phase pre-claim) >"$tmp_dir/unbound.out"
if ! grep -F "No bound worktree branch configured" "$tmp_dir/unbound.out" >/dev/null; then
  echo "verify-bound-worktree.sh did not preserve unbound compatibility" >&2
  cat "$tmp_dir/unbound.out" >&2
  exit 1
fi

mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/gh" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "${BUDDY_TEST_GH_LOG:?}"
exit 99
EOF
chmod +x "$tmp_dir/bin/gh"
export PATH="$tmp_dir/bin:$PATH"
export BUDDY_TEST_GH_LOG="$tmp_dir/gh.log"
: > "$BUDDY_TEST_GH_LOG"
if (cd "$tmp_dir/detached" && "$claim_helper") >"$tmp_dir/claim-detached.out" 2>"$tmp_dir/claim-detached.err"; then
  echo "claim-issue.sh accepted detached HEAD in a bound worktree" >&2
  exit 1
fi
if ! grep -F "detached HEAD" "$tmp_dir/claim-detached.err" >/dev/null; then
  echo "claim-issue.sh did not surface bound worktree failure" >&2
  cat "$tmp_dir/claim-detached.err" >&2
  exit 1
fi
if [[ -s "$BUDDY_TEST_GH_LOG" ]]; then
  echo "claim-issue.sh called gh before the bound worktree gate passed" >&2
  cat "$BUDDY_TEST_GH_LOG" >&2
  exit 1
fi

echo "bound worktree guard tests passed"
