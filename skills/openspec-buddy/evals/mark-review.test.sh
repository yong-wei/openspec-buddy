#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/mark-review.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy"
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review"
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

cat > "$tmp_dir/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then shift 2; fi
case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/yong-wei/openspec-buddy.git\n'; exit 0; fi
    ;;
esac
exit 0
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  printf 'false\n'
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

for script in ensure-pr-base.sh verify-claim-worktree.sh configure-pr-metadata.sh verify-pr-coordination.sh set-status-label.sh; do
  cat > "$tmp_dir/$script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF
  chmod +x "$tmp_dir/$script"
done

cat > "$tmp_dir/request-pr-review.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "${REQUEST_LOG_FILE:?}"
EOF
chmod +x "$tmp_dir/request-pr-review.sh"

export PATH="$tmp_dir:$PATH"
export REQUEST_LOG_FILE="$tmp_dir/request.log"

PATH="$tmp_dir:$PATH" \
  OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo" \
  OPENSPEC_BUDDY_ENSURE_PR_BASE_HELPER="$tmp_dir/ensure-pr-base.sh" \
  OPENSPEC_BUDDY_VERIFY_CLAIM_WORKTREE_HELPER="$tmp_dir/verify-claim-worktree.sh" \
  OPENSPEC_BUDDY_CONFIGURE_PR_METADATA_HELPER="$tmp_dir/configure-pr-metadata.sh" \
  OPENSPEC_BUDDY_REQUEST_PR_REVIEW_HELPER="$tmp_dir/request-pr-review.sh" \
  OPENSPEC_BUDDY_VERIFY_PR_COORDINATION_HELPER="$tmp_dir/verify-pr-coordination.sh" \
  OPENSPEC_BUDDY_SET_STATUS_LABEL_HELPER="$tmp_dir/set-status-label.sh" \
  "$helper" 42 https://github.com/yong-wei/openspec-buddy/pull/123

if ! grep -F -- '--require-threads-resolved' "$REQUEST_LOG_FILE" >/dev/null; then
  echo "mark-review.sh must require review threads to be resolved before requesting review" >&2
  cat "$REQUEST_LOG_FILE" >&2
  exit 1
fi

echo "mark-review tests passed"
