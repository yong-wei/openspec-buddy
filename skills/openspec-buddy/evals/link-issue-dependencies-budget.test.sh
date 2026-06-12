#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
helper="$repo_root/skills/openspec-buddy/scripts/link-issue-dependencies.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '%s\n' '{"remaining":300,"resetAt":"2026-06-12T00:30:00Z"}'
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  if [[ "$3" == "1" ]]; then
    printf '%s\n' '{"id":"ISSUE_1","number":1,"url":"https://github.com/owner/repo/issues/1"}'
  elif [[ "$3" == "2" ]]; then
    printf '%s\n' '{"id":"ISSUE_2","number":2,"url":"https://github.com/owner/repo/issues/2"}'
  elif [[ "$3" == "3" ]]; then
    printf '%s\n' '{"id":"ISSUE_3","number":3,"url":"https://github.com/owner/repo/issues/3"}'
  else
    printf '%s\n' '{"id":"ISSUE_4","number":4,"url":"https://github.com/owner/repo/issues/4"}'
  fi
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  echo "graphql mutation should not execute when remaining budget cannot cover all pairs" >&2
  exit 99
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"

set +e
"$helper" 1 2 3 4 >"$tmp_dir/out.txt" 2>"$tmp_dir/err.txt"
status="$?"
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected dependency linking to fail before partial execution under low GraphQL budget" >&2
  exit 1
fi

if ! grep -F 'below required minimum' "$tmp_dir/err.txt" >/dev/null; then
  echo "expected low-budget dependency diagnostic" >&2
  cat "$tmp_dir/err.txt" >&2
  exit 1
fi

if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "dependency mutation should not start when preflight budget is insufficient" >&2
  exit 1
fi

echo "link-issue-dependencies budget tests passed"
