#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  printf '%s\n' '{"remaining":0,"resetAt":"2026-06-12T00:30:00Z"}'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  echo "graphql should not run when budget guard fails" >&2
  exit 99
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

cat > "$tmp_dir/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$repo_root/skills/openspec-buddy/scripts/github-fetch.sh"
buddy_graphql_api -f query='query { viewer { login } }'
EOF
chmod +x "$tmp_dir/run.sh"

cat > "$tmp_dir/run-conditional.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$repo_root/skills/openspec-buddy/scripts/github-fetch.sh"
buddy_issue_relationships_graphql owner repo 1 >/dev/null
EOF
chmod +x "$tmp_dir/run-conditional.sh"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"

set +e
"$tmp_dir/run.sh" >"$tmp_dir/out.txt" 2>"$tmp_dir/err.txt"
status="$?"
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected buddy_graphql_api to fail when budget guard fails" >&2
  exit 1
fi

if ! grep -E 'below (threshold|required minimum)' "$tmp_dir/err.txt" >/dev/null; then
  echo "expected GraphQL budget diagnostic" >&2
  cat "$tmp_dir/err.txt" >&2
  exit 1
fi

if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "buddy_graphql_api should not call gh api graphql when budget guard fails" >&2
  exit 1
fi

: > "$GH_LOG_FILE"

set +e
"$tmp_dir/run-conditional.sh" >"$tmp_dir/out-conditional.txt" 2>"$tmp_dir/err-conditional.txt"
status="$?"
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected conditional GraphQL path to fail when budget guard fails" >&2
  exit 1
fi

if ! grep -E 'below (threshold|required minimum)' "$tmp_dir/err-conditional.txt" >/dev/null; then
  echo "expected conditional GraphQL budget diagnostic" >&2
  cat "$tmp_dir/err-conditional.txt" >&2
  exit 1
fi

if grep -F 'api graphql' "$GH_LOG_FILE" >/dev/null; then
  echo "conditional GraphQL path should not call gh api graphql when budget guard fails" >&2
  exit 1
fi

echo "github-fetch GraphQL guard tests passed"
