#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/mark-achieved-post-merge.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then
  shift 2
fi
case "${1:-}" in
  remote)
    if [[ "${2:-}" == "get-url" ]]; then
      printf 'https://github.com/yong-wei/openspec-buddy.git\n'
      exit 0
    fi
    ;;
  config)
    if [[ "${2:-}" == "--worktree" && "${3:-}" == "--get" && "${4:-}" == "buddy.boundBase" ]]; then
      printf 'origin/integration\n'
      exit 0
    fi
    ;;
  cat-file)
    if [[ "${2:-}" == "-e" && "${3:-}" == "origin/integration:openspec/changes/archive/2026-06-26-demo/tasks.md" ]]; then
      exit 0
    fi
    ;;
  show)
    if [[ "${2:-}" == "origin/integration:openspec/changes/archive/2026-06-26-demo/tasks.md" ]]; then
      printf '%s\n' '- [x] Done'
      exit 0
    fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "api" && "$2" == "repos/yong-wei/openspec-buddy/pulls/123" ]]; then
  cat "${PR_JSON_FILE:?}"
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  node -e 'const body = `<!-- openspec-buddy
change_id: demo
claim_branch: demo
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/demo
risk: low
area: tests
-->`; process.stdout.write(JSON.stringify({id:"ISSUE_NODE_ID",number:42,title:"Demo",url:"https://example.test/issues/42",state:"CLOSED",body,labels:[],assignees:[],projectItems:[],updatedAt:"2026-06-26T00:00:00Z"}));'
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

cat > "$tmp_dir/verify-bound" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${BOUND_LOG_FILE:?}"
EOF
chmod +x "$tmp_dir/verify-bound"

cat > "$tmp_dir/verify-threads" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${THREAD_LOG_FILE:?}"
EOF
chmod +x "$tmp_dir/verify-threads"

cat > "$tmp_dir/mark-achieved" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${MARK_LOG_FILE:?}"
EOF
chmod +x "$tmp_dir/mark-achieved"

export PATH="$tmp_dir:$PATH"
export OPENSPEC_BUDDY_VERIFY_BOUND_WORKTREE_HELPER="$tmp_dir/verify-bound"
export OPENSPEC_BUDDY_VERIFY_REVIEW_THREADS_RESOLVED_HELPER="$tmp_dir/verify-threads"
export OPENSPEC_BUDDY_MARK_ACHIEVED_HELPER="$tmp_dir/mark-achieved"
export BOUND_LOG_FILE="$tmp_dir/bound.log"
export THREAD_LOG_FILE="$tmp_dir/threads.log"
export MARK_LOG_FILE="$tmp_dir/mark.log"

write_pr() {
  local file="$1"
  local merged_at="$2"
  local body="$3"
  node -e '
const fs = require("node:fs");
const [file, mergedAt, body] = process.argv.slice(1);
fs.writeFileSync(file, `${JSON.stringify({
  number: 123,
  merged_at: mergedAt || null,
  body,
})}\n`);
' "$file" "$merged_at" "$body"
}

write_pr "$tmp_dir/merged.json" "2026-06-26T00:00:00Z" $'Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->'
export PR_JSON_FILE="$tmp_dir/merged.json"
"$helper" 42 openspec/changes/archive/2026-06-26-demo 123
if [[ "$(cat "$MARK_LOG_FILE")" != "42 openspec/changes/archive/2026-06-26-demo 123" ]]; then
  echo "mark-achieved-post-merge should delegate to mark-achieved after all gates pass" >&2
  exit 1
fi

set +e
"$helper" 42 openspec/changes/archive/missing 123 >"$tmp_dir/missing-archive.out" 2>"$tmp_dir/missing-archive.err"
missing_archive_status="$?"
set -e
if [[ "$missing_archive_status" -eq 0 ]]; then
  echo "mark-achieved-post-merge should reject missing archive tasks on the bound base" >&2
  exit 1
fi
grep -F 'Archive tasks file does not exist' "$tmp_dir/missing-archive.err" >/dev/null

write_pr "$tmp_dir/closed-unmerged.json" "" $'Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->'
export PR_JSON_FILE="$tmp_dir/closed-unmerged.json"
set +e
"$helper" 42 openspec/changes/archive/2026-06-26-demo 123 >"$tmp_dir/unmerged.out" 2>"$tmp_dir/unmerged.err"
unmerged_status="$?"
set -e
if [[ "$unmerged_status" -eq 0 ]]; then
  echo "mark-achieved-post-merge should reject closed but unmerged PRs" >&2
  exit 1
fi
grep -F 'is not merged' "$tmp_dir/unmerged.err" >/dev/null

write_pr "$tmp_dir/no-origin.json" "2026-06-26T00:00:00Z" "No origin marker"
export PR_JSON_FILE="$tmp_dir/no-origin.json"
set +e
"$helper" 42 openspec/changes/archive/2026-06-26-demo 123 >"$tmp_dir/no-origin.out" 2>"$tmp_dir/no-origin.err"
no_origin_status="$?"
set -e
if [[ "$no_origin_status" -eq 0 ]]; then
  echo "mark-achieved-post-merge should reject PRs without an origin issue marker" >&2
  exit 1
fi
grep -F 'does not record an OpenSpec Buddy origin issue' "$tmp_dir/no-origin.err" >/dev/null

write_pr "$tmp_dir/wrong-origin.json" "2026-06-26T00:00:00Z" $'Origin issue: #99\n<!-- openspec-buddy-origin-issue:99 -->'
export PR_JSON_FILE="$tmp_dir/wrong-origin.json"
set +e
"$helper" 42 openspec/changes/archive/2026-06-26-demo 123 >"$tmp_dir/wrong-origin.out" 2>"$tmp_dir/wrong-origin.err"
wrong_origin_status="$?"
set -e
if [[ "$wrong_origin_status" -eq 0 ]]; then
  echo "mark-achieved-post-merge should reject PRs for a different origin issue" >&2
  exit 1
fi
grep -F 'does not match issue #42' "$tmp_dir/wrong-origin.err" >/dev/null

echo "mark-achieved-post-merge tests passed"
