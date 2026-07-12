#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_dir="$(cd "$script_dir/.." && pwd)"
helper="$skill_dir/scripts/read-live-claim-truth.sh"
verify_helper="$skill_dir/scripts/verify-claim-worktree.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

repo_dir="$tmp_dir/repo"
bin_dir="$tmp_dir/bin"
cache_dir="$tmp_dir/cache"
mkdir -p "$repo_dir" "$bin_dir" "$cache_dir"

cat > "$bin_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${BUDDY_TEST_FAIL:-0}" == "1" && "$1" == "api" && "$2" == repos/example/repo/issues/42 ]]; then
  echo "simulated GitHub failure" >&2
  exit 1
fi

if [[ "$1" == "api" && "$2" == user && "${3:-}" == "--jq" ]]; then
  printf 'agent-a\n'
  exit 0
fi

if [[ "$1" == "api" && "$2" == repos/example/repo/issues/42 ]]; then
  cat "$BUDDY_TEST_ISSUE_FILE"
  exit 0
fi

if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == repos/example/repo/issues/42/comments?per_page=100 ]]; then
  printf '['
  cat "$BUDDY_TEST_COMMENTS_FILE"
  printf ']\n'
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$bin_dir/gh"

cat > "$bin_dir/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then
  printf '%s\n' "$BUDDY_TEST_REPO_DIR"
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "branch" && "$4" == "--show-current" ]]; then
  printf 'dev1\n'
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "remote" && "$4" == "get-url" && "$5" == origin ]]; then
  printf 'git@github.com:example/repo.git\n'
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "config" ]]; then
  if [[ "$4" == "--worktree" && "$5" == "--get" && "$6" == "buddy.boundBranch" ]]; then
    printf 'dev1\n'
    exit 0
  fi
  exit 1
fi
if [[ "$1" == "worktree" && "$2" == "list" && "$3" == "--porcelain" ]]; then
  cat "$BUDDY_TEST_WORKTREES_FILE"
  exit 0
fi

echo "unexpected git invocation: $*" >&2
exit 1
EOF
chmod +x "$bin_dir/git"

export PATH="$bin_dir:$PATH"
export BUDDY_TEST_REPO_DIR="$repo_dir"
export OPENSPEC_BUDDY_REPO_ROOT="$repo_dir"
export OPENSPEC_BUDDY_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_WORKTREE_ALIAS=dev1
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=release
export OPENSPEC_BUDDY_PROJECT_OWNER=example
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Project"
export OPENSPEC_BUDDY_NOW=2026-07-12T12:00:00Z

cat > "$tmp_dir/worktrees.txt" <<EOF
worktree $repo_dir
HEAD abc123
branch refs/heads/demo-change
EOF
export BUDDY_TEST_WORKTREES_FILE="$tmp_dir/worktrees.txt"

path_hash="$(node -e 'const crypto=require("node:crypto"); process.stdout.write(crypto.createHash("sha256").update(process.argv[1]).digest("hex"));' "$repo_dir")"

cat > "$tmp_dir/issue-claimed.json" <<'JSON'
{"number":42,"state":"open","labels":[{"name":"status:claimed"}],"assignees":[{"login":"agent-a"}]}
JSON

cat > "$tmp_dir/issue-ready.json" <<'JSON'
{"number":42,"state":"open","labels":[{"name":"status:ready"}],"assignees":[]}
JSON

cat > "$tmp_dir/comments-owned.json" <<JSON
[{"created_at":"2026-07-12T11:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-owned\\nstate: active\\nagent: @agent-a\\nchange_id: demo-change\\nbranch: demo-change\\nlease_until: 2026-07-12T13:00:00Z\\nworktree_alias: dev1\\nworktree_path_hash: $path_hash\\ncoordination_branch: dev1"}]
JSON

cat > "$tmp_dir/comments-foreign.json" <<'JSON'
[{"created_at":"2026-07-12T11:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-foreign\nstate: active\nagent: @agent-b\nchange_id: demo-change\nbranch: demo-change\nlease_until: 2026-07-12T13:00:00Z\nworktree_alias: dev2\nworktree_path_hash: foreign-hash\ncoordination_branch: dev2"}]
JSON

cat > "$tmp_dir/comments-expired.json" <<JSON
[{"created_at":"2026-07-12T11:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-expired\\nstate: active\\nagent: @agent-a\\nchange_id: demo-change\\nbranch: demo-change\\nlease_until: 2026-07-12T11:59:59Z\\nworktree_alias: dev1\\nworktree_path_hash: $path_hash\\ncoordination_branch: dev1"}]
JSON

cat > "$tmp_dir/comments-invalid.json" <<JSON
[{"created_at":"2026-07-12T11:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-invalid\\nstate: active\\nagent: @agent-a\\nchange_id: demo-change\\nbranch: demo-change\\nworktree_alias: dev1\\nworktree_path_hash: $path_hash\\ncoordination_branch: dev1"}]
JSON

cat > "$tmp_dir/comments-missing-coordination.json" <<JSON
[{"created_at":"2026-07-12T11:00:00Z","body":"OpenSpec Buddy Claim\\n\\nclaim_id: claim-missing-coordination\\nstate: active\\nagent: @agent-a\\nchange_id: demo-change\\nbranch: demo-change\\nlease_until: 2026-07-12T13:00:00Z\\nworktree_alias: dev1\\nworktree_path_hash: $path_hash"}]
JSON

cat > "$tmp_dir/comments-empty.json" <<'JSON'
[]
JSON

run_probe() {
  local issue_file="$1"
  local comments_file="$2"
  export BUDDY_TEST_ISSUE_FILE="$issue_file"
  export BUDDY_TEST_COMMENTS_FILE="$comments_file"
  "$helper" 42
}

assert_status() {
  local expected="$1"
  local actual
  actual="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.status);' "$2")"
  if [[ "$actual" != "$expected" ]]; then
    echo "expected status $expected, got $actual" >&2
    cat "$2" >&2
    exit 1
  fi
}

run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-owned.json" > "$tmp_dir/owned.json"
assert_status owned "$tmp_dir/owned.json"

run_probe "$tmp_dir/issue-ready.json" "$tmp_dir/comments-empty.json" > "$tmp_dir/missing.json"
assert_status missing "$tmp_dir/missing.json"

run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-foreign.json" > "$tmp_dir/foreign.json"
assert_status foreign "$tmp_dir/foreign.json"

run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-expired.json" > "$tmp_dir/expired.json"
assert_status expired "$tmp_dir/expired.json"

run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-invalid.json" > "$tmp_dir/invalid.json"
assert_status invalid "$tmp_dir/invalid.json"

run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-missing-coordination.json" > "$tmp_dir/missing-coordination.json"
assert_status invalid "$tmp_dir/missing-coordination.json"

set +e
BUDDY_TEST_FAIL=1 run_probe "$tmp_dir/issue-claimed.json" "$tmp_dir/comments-owned.json" > "$tmp_dir/failure.out" 2> "$tmp_dir/failure.err"
failure_status="$?"
set -e
if [[ "$failure_status" -ne 2 ]]; then
  echo "GitHub probe failure must exit 2, got $failure_status" >&2
  cat "$tmp_dir/failure.err" >&2
  exit 1
fi
if ! grep -Fi "live claim truth" "$tmp_dir/failure.err" >/dev/null; then
  echo "GitHub probe failure must explain that live claim truth is unavailable" >&2
  cat "$tmp_dir/failure.err" >&2
  exit 1
fi

export BUDDY_TEST_ISSUE_FILE="$tmp_dir/issue-claimed.json"
export BUDDY_TEST_COMMENTS_FILE="$tmp_dir/comments-owned.json"
set +e
"$verify_helper" --issue 42 --branch demo-change --allow-coordination-branch --json > "$tmp_dir/verify-json.out" 2> "$tmp_dir/verify-json.err"
verify_status="$?"
set -e
if [[ "$verify_status" -ne 0 ]]; then
  echo "verify-claim-worktree --json should accept the live owned claim, got $verify_status" >&2
  cat "$tmp_dir/verify-json.err" >&2
  exit 1
fi
node -e '
const fs = require("node:fs");
const lines = fs.readFileSync(process.argv[1], "utf8").trim().split(/\r?\n/);
if (lines.length !== 1) {
  throw new Error(`--json output must contain exactly one line, got ${lines.length}`);
}
const probe = JSON.parse(lines[0]);
if (probe.status !== "owned" || probe.source !== "github-rest") {
  throw new Error(`unexpected probe: ${JSON.stringify(probe)}`);
}
' "$tmp_dir/verify-json.out"

echo "read-live-claim-truth tests passed"
