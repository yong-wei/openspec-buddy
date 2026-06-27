#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/release-claim.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy"
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
export OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR="$tmp_dir/lanes"
export OPENSPEC_BUDDY_WORKTREE_ALIAS=dev1
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT" "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR"
export ACTIVE_PATH_HASH
ACTIVE_PATH_HASH="$(node -e 'const crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.argv[1]).digest("hex"));' "$OPENSPEC_BUDDY_REPO_ROOT")"
LANE_PATH_HASH="$(node -e 'const crypto=require("node:crypto"); const fs=require("node:fs"); process.stdout.write(crypto.createHash("sha256").update(fs.realpathSync(process.argv[1])).digest("hex"));' "$OPENSPEC_BUDDY_REPO_ROOT")"

cat > "$tmp_dir/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-C" ]]; then shift 2; fi
case "${1:-}" in
  rev-parse)
    if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; exit 0; fi
    ;;
  config)
    if [[ "${2:-}" == "--worktree" && "${3:-}" == "--get" && "${4:-}" == "buddy.worktreeAlias" && "${NO_GIT_ALIAS:-0}" != "1" ]]; then
      printf 'dev1\n'
      exit 0
    fi
    exit 1
    ;;
  remote)
    if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/yong-wei/openspec-buddy.git\n'; exit 0; fi
    ;;
  ls-remote)
    if [[ "${4:-}" == "demo-change" ]]; then printf 'base123\trefs/heads/demo-change\n'; exit 0; fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${GH_LOG:?}"
if [[ "$1" == "api" && "$2" == "user" ]]; then
  printf 'YW\n'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "repos/yong-wei/openspec-buddy/issues/42" ]]; then
  printf '%s\n' '{"number":42,"state":"open","labels":[{"name":"status:claimed"}]}'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/42/comments* ]]; then
  if [[ "${ACTIVE_RELEASED:-0}" == "1" ]]; then
    printf '[[{"created_at":"2026-06-26T00:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-42\\nstate: active\\nagent: @YW\\nchange_id: demo-change\\nbranch: demo-change\\nbase_branch: integration\\nbase_sha: base123\\nlease_until: 2026-06-27T00:00:00.000Z\\nworktree_alias: dev1\\nworktree_path_hash: %s"},{"created_at":"2026-06-26T00:01:00Z","body":"OpenSpec Buddy Claim Release\\n\\nclaim_id: claim-42\\nstate: released"}]]\n' "${ACTIVE_PATH_HASH:?}"
    exit 0
  fi
  printf '[[{"created_at":"2026-06-26T00:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-42\\nstate: active\\nagent: @YW\\nchange_id: demo-change\\nbranch: demo-change\\nbase_branch: integration\\nbase_sha: base123\\nlease_until: 2026-06-27T00:00:00.000Z\\nworktree_alias: %s\\nworktree_path_hash: %s"}]]\n' "${ACTIVE_ALIAS:-dev1}" "${ACTIVE_PATH_HASH:?}"
  exit 0
fi
if [[ "$1" == "api" && "$2" == "repos/yong-wei/openspec-buddy/pulls?head=yong-wei:demo-change&state=open&per_page=1" ]]; then
  if [[ "${OPEN_PR_EXISTS:-0}" == "1" ]]; then
    printf '%s\n' '[{"number":123}]'
  else
    printf '%s\n' '[]'
  fi
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  printf '%s\n' "$*" >> "${COMMENT_LOG:?}"
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  printf 'status:claimed\n'
  exit 0
fi
if [[ "$1" == "issue" && "$2" == "edit" ]]; then
  printf '%s\n' "$*" >> "${EDIT_LOG:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_LOG="$tmp_dir/gh.log"
export COMMENT_LOG="$tmp_dir/comment.log"
export EDIT_LOG="$tmp_dir/edit.log"

cat > "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev1.json" <<'JSON'
{
  "version": 1,
  "worktree": { "alias": "dev1" },
  "maxLanes": 2,
  "lanes": [
    { "id": "issue-42", "issue": "42", "change": "demo-change", "branch": "demo-change", "pr": "", "head": "", "stage": "blocked" },
    { "id": "issue-43", "issue": "43", "change": "next", "branch": "next", "pr": "", "head": "", "stage": "waiting_review" }
  ]
}
JSON
cat > "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev2.json" <<'JSON'
{
  "version": 1,
  "worktree": { "alias": "dev2" },
  "maxLanes": 2,
  "lanes": [
    { "id": "issue-42", "issue": "42", "change": "demo-change", "branch": "demo-change", "pr": "", "head": "", "stage": "blocked" }
  ]
}
JSON
hash16="$(node -e 'process.stdout.write(process.argv[1].slice(0, 16))' "$LANE_PATH_HASH")"
cat > "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/$hash16.json" <<'JSON'
{
  "version": 1,
  "worktree": { "pathHash": "hash16" },
  "maxLanes": 2,
  "lanes": [
    { "id": "issue-42", "issue": "42", "change": "demo-change", "branch": "demo-change", "pr": "", "head": "", "stage": "blocked" }
  ]
}
JSON

"$helper" 42 --reason "misclaimed lane" --clear-lane > "$tmp_dir/output.txt"

grep -F "OpenSpec Buddy Claim Release" "$COMMENT_LOG" >/dev/null
grep -F "claim_id: claim-42" "$COMMENT_LOG" >/dev/null
grep -F -- "--remove-label status:claimed --add-label status:ready" "$EDIT_LOG" >/dev/null
node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.lanes.some((lane) => String(lane.issue) === "42")) process.exit(1);
if (!data.lanes.some((lane) => String(lane.issue) === "43")) process.exit(1);
' "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev1.json"
node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!data.lanes.some((lane) => String(lane.issue) === "42")) process.exit(1);
' "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev2.json"

export NO_GIT_ALIAS=1
"$helper" 42 --reason "hash lane" --clear-lane > "$tmp_dir/hash-output.txt"
node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.lanes.some((lane) => String(lane.issue) === "42")) process.exit(1);
' "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/$hash16.json"
unset NO_GIT_ALIAS

cat > "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev1.json" <<'JSON'
{
  "version": 1,
  "worktree": { "alias": "dev1" },
  "maxLanes": 2,
  "lanes": [
    { "id": "issue-42", "issue": "42", "change": "demo-change", "branch": "demo-change", "pr": "", "head": "", "stage": "blocked" }
  ]
}
JSON
export ACTIVE_RELEASED=1
"$helper" 42 --reason "retry converge" --clear-lane > "$tmp_dir/retry-output.txt"
grep -F "reconciled status:ready" "$tmp_dir/retry-output.txt" >/dev/null
node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.lanes.some((lane) => String(lane.issue) === "42")) process.exit(1);
' "$OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR/dev1.json"
unset ACTIVE_RELEASED

export ACTIVE_ALIAS=dev2
if "$helper" 42 --reason "foreign" > "$tmp_dir/foreign.out" 2> "$tmp_dir/foreign.err"; then
  echo "release-claim should reject foreign claims by default" >&2
  exit 1
fi
grep -F "Refusing to release foreign claim" "$tmp_dir/foreign.err" >/dev/null
unset ACTIVE_ALIAS

export OPEN_PR_EXISTS=1
if "$helper" 42 --reason "open pr" > "$tmp_dir/open-pr.out" 2> "$tmp_dir/open-pr.err"; then
  echo "release-claim should reject claims with open PRs" >&2
  exit 1
fi
grep -F "open PR exists" "$tmp_dir/open-pr.err" >/dev/null

echo "release-claim tests passed"
