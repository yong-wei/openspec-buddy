#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/verify-claim-worktree.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

current_repo="$tmp_dir/e734/act.just.edu.cn"
foreign_repo="$tmp_dir/e946/act.just.edu.cn"
mkdir -p "$current_repo" "$foreign_repo" "$tmp_dir/bin"

cat > "$tmp_dir/bin/git" <<'EOF'
#!/bin/bash
set -euo pipefail

if [[ "${1:-}" == "-C" ]]; then
  shift 2
fi

case "${1:-}" in
  config)
    if [[ "${2:-}" == "--worktree" && "${3:-}" == "--get" ]]; then
      case "${4:-}" in
        buddy.boundBranch)
          printf '%s\n' "${BUDDY_TEST_BOUND_BRANCH:-}"
          exit 0
          ;;
        buddy.boundBase)
          printf '%s\n' "${BUDDY_TEST_BOUND_BASE:-}"
          exit 0
          ;;
        buddy.worktreeAlias)
          printf '%s\n' "${BUDDY_TEST_WORKTREE_ALIAS:-}"
          exit 0
          ;;
      esac
    fi
    ;;
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then
      printf '%s\n' "${BUDDY_TEST_REPO_ROOT:?}"
      exit 0
    fi
    ;;
  branch)
    if [[ "${2:-}" == "--show-current" ]]; then
      printf '%s\n' "${BUDDY_TEST_CURRENT_BRANCH:-}"
      exit 0
    fi
    ;;
  worktree)
    if [[ "${2:-}" == "list" && "${3:-}" == "--porcelain" ]]; then
      cat "${BUDDY_TEST_WORKTREES_FILE:?}"
      exit 0
    fi
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then
      printf 'https://github.com/example/repo.git\n'
      exit 0
    fi
    ;;
esac

echo "unexpected git invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/bin/git"

cat > "$tmp_dir/bin/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

if [[ "$1" == "api" && "$2" == "repos/example/repo/issues/649" ]]; then
  cat "${BUDDY_TEST_ISSUE_FILE:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == "repos/example/repo/issues/649/comments?per_page=100" ]]; then
  printf '['
  cat "${BUDDY_TEST_COMMENTS_FILE:?}"
  printf ']'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "repos/example/repo/pulls/77" ]]; then
  cat "${BUDDY_TEST_PR_FILE:?}"
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/bin/gh"

cat > "$tmp_dir/issue.json" <<'JSON'
{
  "number": 649,
  "state": "open",
  "labels": [
    { "name": "status:claimed" }
  ]
}
JSON
cat > "$tmp_dir/issue-ready.json" <<'JSON'
{
  "number": 649,
  "state": "open",
  "labels": [
    { "name": "status:ready" }
  ]
}
JSON

cat > "$tmp_dir/pr.json" <<'JSON'
{
  "number": 77,
  "head": { "ref": "make-graph-center-actionable" },
  "body": "Origin issue: #649\n<!-- openspec-buddy-origin-issue:649 -->"
}
JSON
cat > "$tmp_dir/pr-no-origin.json" <<'JSON'
{
  "number": 77,
  "head": { "ref": "make-graph-center-actionable" },
  "body": "No Buddy origin issue."
}
JSON

write_comments() {
  local file="$1"
  local extra="${2:-}"
  cat > "$file" <<JSON
[
  {
    "created_at": "2026-06-23T00:00:00Z",
    "body": "OpenSpec Buddy Claim\n\nclaim_id: claim-649\nstate: active\nagent: @codex\nchange_id: make-graph-center-actionable\nbranch: make-graph-center-actionable\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-06-23T12:00:00.000Z${extra}"
  }
]
JSON
}

cat > "$tmp_dir/worktrees-current.txt" <<EOF
worktree $current_repo
HEAD abc123
branch refs/heads/make-graph-center-actionable

worktree $foreign_repo
HEAD def456
branch refs/heads/dev2
EOF

cat > "$tmp_dir/worktrees-foreign.txt" <<EOF
worktree $current_repo
HEAD abc123
branch refs/heads/dev1

worktree $foreign_repo
HEAD def456
branch refs/heads/make-graph-center-actionable
EOF

export PATH="$tmp_dir/bin:$PATH"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE=Project
export OPENSPEC_BUDDY_REPO_ROOT="$current_repo"
export OPENSPEC_BUDDY_CACHE_DIR="$tmp_dir/cache"
export BUDDY_TEST_REPO_ROOT="$current_repo"
export BUDDY_TEST_ISSUE_FILE="$tmp_dir/issue.json"
export BUDDY_TEST_PR_FILE="$tmp_dir/pr.json"
export BUDDY_TEST_BOUND_BRANCH=""
export BUDDY_TEST_BOUND_BASE=""
export BUDDY_TEST_WORKTREE_ALIAS=""

write_comments "$tmp_dir/comments-current.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-current.json"
export BUDDY_TEST_WORKTREES_FILE="$tmp_dir/worktrees-current.txt"

export BUDDY_TEST_CURRENT_BRANCH=""
set +e
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/detached.out" 2>"$tmp_dir/detached.err"
detached_status="$?"
set -e
if [[ "$detached_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject detached HEAD" >&2
  exit 1
fi
if ! grep -F "detached HEAD" "$tmp_dir/detached.err" >/dev/null; then
  echo "verify-claim-worktree did not explain detached HEAD failure" >&2
  cat "$tmp_dir/detached.err" >&2
  exit 1
fi

export BUDDY_TEST_CURRENT_BRANCH="dev1"
export BUDDY_TEST_WORKTREES_FILE="$tmp_dir/worktrees-foreign.txt"
set +e
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/foreign.out" 2>"$tmp_dir/foreign.err"
foreign_status="$?"
set -e
if [[ "$foreign_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject a claim branch bound to another worktree" >&2
  exit 1
fi
if ! grep -F "foreign-claim-detected" "$tmp_dir/foreign.err" >/dev/null; then
  echo "verify-claim-worktree did not report foreign-claim-detected" >&2
  cat "$tmp_dir/foreign.err" >&2
  exit 1
fi

write_comments "$tmp_dir/comments-foreign-hash.json" '\nworktree_alias: dev2\nworktree_path_hash: foreignhash\ncoordination_branch: dev2\nrun_id: run-foreign'
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-foreign-hash.json"
export BUDDY_TEST_CURRENT_BRANCH="make-graph-center-actionable"
export BUDDY_TEST_WORKTREES_FILE="$tmp_dir/worktrees-current.txt"
set +e
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/hash.out" 2>"$tmp_dir/hash.err"
hash_status="$?"
set -e
if [[ "$hash_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject active claims from a different worktree path hash" >&2
  exit 1
fi
if ! grep -F "active claim belongs to another worktree" "$tmp_dir/hash.err" >/dev/null; then
  echo "verify-claim-worktree did not explain worktree hash mismatch" >&2
  cat "$tmp_dir/hash.err" >&2
  exit 1
fi

write_comments "$tmp_dir/comments-current.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-current.json"
"$helper" --issue 649 --pr 77 --branch make-graph-center-actionable >"$tmp_dir/pass.out"
if ! grep -F "Claim worktree verified" "$tmp_dir/pass.out" >/dev/null; then
  echo "verify-claim-worktree did not report success for the matching worktree" >&2
  cat "$tmp_dir/pass.out" >&2
  exit 1
fi

export BUDDY_TEST_BOUND_BRANCH="dev2"
export BUDDY_TEST_CURRENT_BRANCH="make-graph-center-actionable"
export BUDDY_TEST_WORKTREES_FILE="$tmp_dir/worktrees-current.txt"
write_comments "$tmp_dir/comments-missing-coordination.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-missing-coordination.json"
set +e
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/missing-coordination.out" 2>"$tmp_dir/missing-coordination.err"
missing_coordination_status="$?"
set -e
if [[ "$missing_coordination_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject a bound worktree claim missing coordination_branch" >&2
  exit 1
fi
if ! grep -F "missing coordination_branch" "$tmp_dir/missing-coordination.err" >/dev/null; then
  echo "verify-claim-worktree did not explain missing coordination branch failure" >&2
  cat "$tmp_dir/missing-coordination.err" >&2
  exit 1
fi

write_comments "$tmp_dir/comments-wrong-coordination.json" '\ncoordination_branch: dev1'
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-wrong-coordination.json"
set +e
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/wrong-coordination.out" 2>"$tmp_dir/wrong-coordination.err"
wrong_coordination_status="$?"
set -e
if [[ "$wrong_coordination_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject a bound worktree claim from another coordination branch" >&2
  exit 1
fi
if ! grep -F "does not match bound branch dev2" "$tmp_dir/wrong-coordination.err" >/dev/null; then
  echo "verify-claim-worktree did not explain coordination branch mismatch" >&2
  cat "$tmp_dir/wrong-coordination.err" >&2
  exit 1
fi

write_comments "$tmp_dir/comments-right-coordination.json" '\ncoordination_branch: dev2'
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-right-coordination.json"
"$helper" --issue 649 --branch make-graph-center-actionable >"$tmp_dir/right-coordination.out"
if ! grep -F "Claim worktree verified" "$tmp_dir/right-coordination.out" >/dev/null; then
  echo "verify-claim-worktree did not accept matching coordination_branch" >&2
  cat "$tmp_dir/right-coordination.out" >&2
  exit 1
fi
export BUDDY_TEST_BOUND_BRANCH=""

current_hash="$(node -e 'const crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.argv[1]).digest("hex"));' "$current_repo")"
write_comments "$tmp_dir/comments-current-run.json" "\\nworktree_alias: e734\\nworktree_path_hash: $current_hash\\ncoordination_branch: make-graph-center-actionable\\nrun_id: run-current"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-current-run.json"
"$helper" --pr 77 >"$tmp_dir/pr-only-pass.out"
if ! grep -F "Claim worktree verified" "$tmp_dir/pr-only-pass.out" >/dev/null; then
  echo "verify-claim-worktree did not verify PR-only origin issue ownership" >&2
  cat "$tmp_dir/pr-only-pass.out" >&2
  exit 1
fi

export BUDDY_TEST_ISSUE_FILE="$tmp_dir/issue-ready.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-empty.json"
printf '[]\n' > "$tmp_dir/comments-empty.json"
set +e
"$helper" --pr 77 >"$tmp_dir/pr-unclaimed.out" 2>"$tmp_dir/pr-unclaimed.err"
unclaimed_status="$?"
set -e
if [[ "$unclaimed_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject PR-only checks when the origin issue has no active claim" >&2
  exit 1
fi
if ! grep -F "no active claim comment" "$tmp_dir/pr-unclaimed.err" >/dev/null; then
  echo "verify-claim-worktree did not explain missing active claim failure" >&2
  cat "$tmp_dir/pr-unclaimed.err" >&2
  exit 1
fi
export BUDDY_TEST_ISSUE_FILE="$tmp_dir/issue.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-current-run.json"

export BUDDY_TEST_PR_FILE="$tmp_dir/pr-no-origin.json"
set +e
"$helper" --pr 77 >"$tmp_dir/pr-no-origin.out" 2>"$tmp_dir/pr-no-origin.err"
no_origin_status="$?"
set -e
if [[ "$no_origin_status" -eq 0 ]]; then
  echo "verify-claim-worktree should reject PR-only checks without an origin issue marker" >&2
  exit 1
fi
if ! grep -F "does not record an OpenSpec Buddy origin issue" "$tmp_dir/pr-no-origin.err" >/dev/null; then
  echo "verify-claim-worktree did not explain missing origin issue failure" >&2
  cat "$tmp_dir/pr-no-origin.err" >&2
  exit 1
fi

echo "claim worktree guard tests passed"
