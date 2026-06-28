#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/mark-in-progress.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_VERIFY_CLAIM_WORKTREE_HELPER="$tmp_dir/verify-claim-worktree.sh"
export OPENSPEC_BUDDY_SET_STATUS_LABEL_HELPER="$tmp_dir/set-status-label.sh"
export VERIFY_LOG="$tmp_dir/verify.log"
export STATUS_LOG="$tmp_dir/status.log"
export COMMENT_LOG="$tmp_dir/comment.log"

cat > "$tmp_dir/body.md" <<'EOF'
<!-- openspec-buddy
change_id: demo-change
claim_branch: demo-change
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/demo-change
risk: low
area: test
-->

# Demo
EOF

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  body_json="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify(fs.readFileSync(process.argv[1],"utf8")));' "${BODY_FILE:?}")"
  case "${STATUS_LABELS:-missing}" in
    missing) labels='[]' ;;
    claimed) labels='[{"name":"status:claimed"}]' ;;
    archived) labels='[{"name":"status:archived"}]' ;;
    mixed) labels='[{"name":"status:claimed"},{"name":"status:archived"}]' ;;
    active-mixed) labels='[{"name":"status:claimed"},{"name":"status:in-review"}]' ;;
    *) labels='[]' ;;
  esac
  printf '{"body":%s,"labels":%s}\n' "$body_json" "$labels"
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  printf '%s\n' "$*" >> "${COMMENT_LOG:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

cat > "$OPENSPEC_BUDDY_VERIFY_CLAIM_WORKTREE_HELPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${VERIFY_LOG:?}"
EOF
chmod +x "$OPENSPEC_BUDDY_VERIFY_CLAIM_WORKTREE_HELPER"

cat > "$OPENSPEC_BUDDY_SET_STATUS_LABEL_HELPER" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${STATUS_LOG:?}"
EOF
chmod +x "$OPENSPEC_BUDDY_SET_STATUS_LABEL_HELPER"

export PATH="$tmp_dir:$PATH"
export BODY_FILE="$tmp_dir/body.md"

export STATUS_LABELS=missing
"$helper" 42 > "$tmp_dir/missing.out"
grep -F -- "--issue 42 --branch demo-change" "$VERIFY_LOG" >/dev/null
grep -F "42 status:in-progress" "$STATUS_LOG" >/dev/null
grep -F "Implementation started on branch" "$COMMENT_LOG" >/dev/null

: > "$STATUS_LOG"
: > "$COMMENT_LOG"
export STATUS_LABELS=archived
if "$helper" 42 > "$tmp_dir/archived.out" 2> "$tmp_dir/archived.err"; then
  echo "mark-in-progress should reject terminal statuses" >&2
  exit 1
fi
grep -F "must have no status label or exactly one of status:claimed, status:in-review, status:in-progress" "$tmp_dir/archived.err" >/dev/null
if [[ -s "$STATUS_LOG" ]]; then
  echo "set-status-label should not run for terminal status" >&2
  exit 1
fi

: > "$STATUS_LOG"
: > "$COMMENT_LOG"
export STATUS_LABELS=mixed
if "$helper" 42 > "$tmp_dir/mixed.out" 2> "$tmp_dir/mixed.err"; then
  echo "mark-in-progress should reject mixed terminal statuses" >&2
  exit 1
fi
grep -F "must have no status label or exactly one of status:claimed, status:in-review, status:in-progress" "$tmp_dir/mixed.err" >/dev/null
if [[ -s "$STATUS_LOG" ]]; then
  echo "set-status-label should not run for mixed terminal status" >&2
  exit 1
fi

: > "$STATUS_LOG"
: > "$COMMENT_LOG"
export STATUS_LABELS=active-mixed
if "$helper" 42 > "$tmp_dir/active-mixed.out" 2> "$tmp_dir/active-mixed.err"; then
  echo "mark-in-progress should reject mixed active statuses" >&2
  exit 1
fi
grep -F "must have no status label or exactly one of status:claimed, status:in-review, status:in-progress" "$tmp_dir/active-mixed.err" >/dev/null
if [[ -s "$STATUS_LOG" ]]; then
  echo "set-status-label should not run for mixed active status" >&2
  exit 1
fi

echo "mark-in-progress tests passed"
