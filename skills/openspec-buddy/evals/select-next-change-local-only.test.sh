#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
selector="$script_dir/../scripts/select-next-change.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

stub_bin="$tmp_dir/bin"
mkdir -p "$stub_bin"

cat >"$stub_bin/openspec" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "list" && "${2:-}" == "--json" ]]; then
  if [[ "${OPEN_SPEC_MODE:-local-only}" == "mixed" ]]; then
    cat <<'JSON'
{
  "changes": [
    "issue-backed-change",
    {
      "change_id": "local-only-refactor",
      "no_issue": true,
      "series": "local",
      "risk": "low"
    }
  ]
}
JSON
    exit 0
  fi
  cat <<'JSON'
{
  "changes": [
    {
      "change_id": "local-only-refactor",
      "no_issue": true,
      "series": "local",
      "risk": "low"
    }
  ]
}
JSON
  exit 0
fi

echo "unexpected openspec invocation: $*" >&2
exit 1
EOF
chmod +x "$stub_bin/openspec"

cat >"$stub_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "gh should not be called in local-only mode" >&2
exit 1
EOF
chmod +x "$stub_bin/gh"

output="$(
  env -i \
    PATH="$stub_bin:$PATH" \
    HOME="$HOME" \
    OPENSPEC_BUDDY_BASE_BRANCH=integration \
    bash "$selector"
)"

if [[ "$output" != *'"change_id": "local-only-refactor"'* ]]; then
  printf 'Expected local-only selector output.\n\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *'"local_only": true'* ]]; then
  printf 'Expected local_only marker in selector output.\n\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

output_with_core="$(
  env -i \
    PATH="$stub_bin:$PATH" \
    HOME="$HOME" \
    OPENSPEC_BUDDY_BASE_BRANCH=integration \
    OPENSPEC_BUDDY_RELEASE_BRANCH=main \
    OPENSPEC_BUDDY_PROJECT_OWNER=example \
    OPENSPEC_BUDDY_PROJECT_NUMBER=1 \
    OPENSPEC_BUDDY_PROJECT_TITLE="Example Project" \
    bash "$selector"
)"

if [[ "$output_with_core" != *'"change_id": "local-only-refactor"'* ]]; then
  printf 'Expected local-only selector output with full core config.\n\nOutput:\n%s\n' "$output_with_core" >&2
  exit 1
fi

set +e
mixed_stdout="$(
  env -i \
    PATH="$stub_bin:$PATH" \
    HOME="$HOME" \
    OPEN_SPEC_MODE=mixed \
    OPENSPEC_BUDDY_BASE_BRANCH=integration \
    OPENSPEC_BUDDY_RELEASE_BRANCH=main \
    OPENSPEC_BUDDY_PROJECT_OWNER=example \
    OPENSPEC_BUDDY_PROJECT_NUMBER=1 \
    OPENSPEC_BUDDY_PROJECT_TITLE="Example Project" \
    bash "$selector" 2>"$tmp_dir/mixed.err"
)"
mixed_status="$?"
set -e

if [[ "$mixed_status" -ne 0 ]]; then
  printf 'Expected mixed local-only fallback to succeed.\n\nStderr:\n%s\n' "$(cat "$tmp_dir/mixed.err")" >&2
  exit 1
fi

if [[ "$mixed_stdout" != *'"change_id": "local-only-refactor"'* ]]; then
  printf 'Expected local-only fallback output in mixed mode.\n\nOutput:\n%s\n' "$mixed_stdout" >&2
  exit 1
fi

if ! grep -F 'issue-backed candidates were not fully evaluated' "$tmp_dir/mixed.err" >/dev/null; then
  printf 'Expected warning for mixed local-only and issue-backed fallback.\n\nStderr:\n%s\n' "$(cat "$tmp_dir/mixed.err")" >&2
  exit 1
fi

echo "select-next-change local-only tests passed"
