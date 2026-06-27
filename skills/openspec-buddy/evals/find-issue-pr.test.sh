#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/find-issue-pr.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=yong-wei
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Buddy"
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
echo "unexpected git invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/git"

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  node -e 'const body = `<!-- openspec-buddy
change_id: demo-change
claim_branch: demo-change
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/demo-change
risk: low
area: tests
-->`; process.stdout.write(JSON.stringify({number:42,body,labels:[],projectItems:[]}));'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/42/comments* ]]; then
  printf '%s\n' '[[{"created_at":"2026-06-26T00:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: @YW\nchange_id: demo-change\nbranch: demo-change\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-06-27T00:00:00.000Z"}]]'
  exit 0
fi
if [[ "$1" == "api" && "$2" == "repos/yong-wei/openspec-buddy/pulls?state=all&head=yong-wei:demo-change&per_page=20" ]]; then
  if [[ "${GH_PULLS_FAIL_ONCE:-0}" == "1" ]]; then
    count_file="${GH_PULLS_COUNT_FILE:?}"
    count=0
    if [[ -f "$count_file" ]]; then count="$(cat "$count_file")"; fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$count_file"
    if [[ "$count" -eq 1 ]]; then
      echo "GitHub API EOF" >&2
      exit 1
    fi
  fi
  cat "${PRS_FILE:?}"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"

cat > "$tmp_dir/open-prs.json" <<'JSON'
[
  {
    "number": 123,
    "state": "open",
    "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->",
    "head": { "sha": "head-1", "ref": "demo-change" },
    "html_url": "https://github.com/yong-wei/openspec-buddy/pull/123"
  }
]
JSON
export PRS_FILE="$tmp_dir/open-prs.json"
open_result="$("$helper" 42)"
node -e 'const data=JSON.parse(process.argv[1]); if (data.pr !== 123 || data.state !== "OPEN") process.exit(1);' "$open_result"

export GH_PULLS_FAIL_ONCE=1
export GH_PULLS_COUNT_FILE="$tmp_dir/pulls-count.txt"
rm -f "$GH_PULLS_COUNT_FILE"
retry_result="$("$helper" 42)"
node -e 'const data=JSON.parse(process.argv[1]); if (data.pr !== 123 || data.state !== "OPEN") process.exit(1);' "$retry_result"
if [[ "$(cat "$GH_PULLS_COUNT_FILE")" != "2" ]]; then
  echo "find-issue-pr should retry one transient pulls query failure" >&2
  exit 1
fi
unset GH_PULLS_FAIL_ONCE GH_PULLS_COUNT_FILE

cat > "$tmp_dir/closed-prs.json" <<'JSON'
[
  {
    "number": 122,
    "state": "closed",
    "merged": false,
    "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->",
    "head": { "sha": "head-old", "ref": "demo-change" },
    "html_url": "https://github.com/yong-wei/openspec-buddy/pull/122"
  }
]
JSON
export PRS_FILE="$tmp_dir/closed-prs.json"
closed_result="$("$helper" 42)"
node -e 'const data=JSON.parse(process.argv[1]); if (data.pr !== null || data.closedPr !== 122 || !/not open/.test(data.reason || "")) process.exit(1);' "$closed_result"

cat > "$tmp_dir/merged-prs.json" <<'JSON'
[
  {
    "number": 124,
    "state": "closed",
    "merged": true,
    "body": "Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->",
    "head": { "sha": "head-merged", "ref": "demo-change" },
    "html_url": "https://github.com/yong-wei/openspec-buddy/pull/124"
  }
]
JSON
export PRS_FILE="$tmp_dir/merged-prs.json"
merged_result="$("$helper" 42)"
node -e 'const data=JSON.parse(process.argv[1]); if (data.pr !== 124 || data.merged !== true || data.state !== "CLOSED") process.exit(1);' "$merged_result"

echo "find-issue-pr tests passed"
