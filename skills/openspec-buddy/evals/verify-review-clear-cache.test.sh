#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="$script_dir/../scripts/verify-review-clear.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cache_dir="$tmp_dir/cache"
mkdir -p "$cache_dir"

cat > "$cache_dir/pr-rest-123.json" <<'JSON'
{"number":123,"html_url":"https://github.com/owner/repo/pull/123","head":{"sha":"head-1"}}
JSON
cat > "$cache_dir/reviews-123.json" <<'JSON'
[{"user":{"login":"chatgpt-codex-connector"},"state":"COMMENTED","body":"No actionable findings.","submitted_at":"2026-01-01T00:02:00Z","commit_id":"head-1"}]
JSON
cat > "$cache_dir/commits-123.json" <<'JSON'
[{"sha":"head-1","commit":{"author":{"date":"2026-01-01T00:00:00Z"},"committer":{"date":"2026-01-01T00:00:00Z"}}}]
JSON
cat > "$cache_dir/issue-comments-123.json" <<'JSON'
[{"user":{"login":"YW"},"body":"@codex review 中文回复，即使没有重大问题也必须给出显式回复","created_at":"2026-01-01T00:01:00Z","html_url":"https://github.com/owner/repo/pull/123#issuecomment-1"}]
JSON
cat > "$cache_dir/review-comments-123.json" <<'JSON'
[]
JSON

cat > "$tmp_dir/gh-env.sh" <<'EOF'
git() {
  if [[ "${1:-}" == "-C" ]]; then
    shift 2
  fi
  case "${1:-}" in
    rev-parse)
      if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; return 0; fi
      ;;
    branch)
      if [[ "${2:-}" == "--show-current" ]]; then printf 'buddy-test-branch\n'; return 0; fi
      ;;
    worktree)
      if [[ "${2:-}" == "list" && "${3:-}" == "--porcelain" ]]; then printf 'worktree %s\nHEAD abc123\nbranch refs/heads/buddy-test-branch\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; return 0; fi
      ;;
    remote)
      if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/owner/repo.git\n'; return 0; fi
      ;;
  esac
  echo "unexpected git call: $*" >&2
  return 99
}
export -f git
gh() {
  printf '%s\n' "$*" >> "$GH_LOG_FILE"
  if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
    printf '%s\n' '{"number":123,"head":{"ref":"buddy-test-branch","sha":"head-1"},"body":"Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"}'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/reviews* ]]; then
    printf '%s\n' '[[{"user":{"login":"chatgpt-codex-connector"},"state":"COMMENTED","body":"No actionable findings.","submitted_at":"2026-01-01T00:02:00Z","commit_id":"head-1"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/commits* ]]; then
    printf '%s\n' '[[{"sha":"head-1","commit":{"author":{"date":"2026-01-01T00:00:00Z"},"committer":{"date":"2026-01-01T00:00:00Z"}}}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/comments* ]]; then
    printf '%s\n' '[[]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/123/comments* ]]; then
    printf '%s\n' '[[{"user":{"login":"YW"},"body":"@codex review 中文回复，即使没有重大问题也必须给出显式回复","created_at":"2026-01-01T00:01:00Z","html_url":"https://github.com/owner/repo/pull/123#issuecomment-1"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == */issues/42 ]]; then
    printf '{"number":42,"state":"open","labels":[{"name":"status:claimed"}]}\n'
    return 0
  fi
  if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/42/comments* ]]; then
    printf '%s\n' '[[{"created_at":"2026-01-01T00:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: @YW\nchange_id: buddy-test-branch\nbranch: buddy-test-branch\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-01-02T00:00:00.000Z"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "graphql" ]]; then
    cat <<'JSON'
{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}
JSON
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
    cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
    return 0
  fi
  echo "unexpected gh call: $*" >&2
  return 99
}
export -f gh
EOF
export GH_LOG_FILE="$tmp_dir/gh.log"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE=Repo
export OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review 中文回复，即使没有重大问题也必须给出显式回复"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_REUSE_PR_REST_CACHE=1
export OPENSPEC_BUDDY_REPO_ROOT="$tmp_dir/repo"
mkdir -p "$OPENSPEC_BUDDY_REPO_ROOT"

output="$(BASH_ENV="$tmp_dir/gh-env.sh" bash "$helper" 123)"

if [[ "$output" != *'Review clearance verified for PR #123'* ]]; then
  echo "expected verify-review-clear success output" >&2
  exit 1
fi

graphql_calls="$(grep -c '^api graphql' "$GH_LOG_FILE" | tr -d ' ')"
if [[ "$graphql_calls" != "1" ]]; then
  echo "expected exactly one GraphQL call for review threads" >&2
  exit 1
fi

if ! grep -E 'repos/.*/issues/123/comments|repos/.*/pulls/123/(reviews|comments|commits)' "$GH_LOG_FILE" >/dev/null; then
  echo "verify-review-clear must refresh the raw REST bundle even when reuse is requested" >&2
  exit 1
fi

cat > "$cache_dir/review-threads-123.json" <<'JSON'
{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}
JSON
cat > "$tmp_dir/gh-env.sh" <<'EOF'
git() {
  if [[ "${1:-}" == "-C" ]]; then
    shift 2
  fi
  case "${1:-}" in
    rev-parse)
      if [[ "${2:-}" == "--show-toplevel" ]]; then printf '%s\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; return 0; fi
      ;;
    branch)
      if [[ "${2:-}" == "--show-current" ]]; then printf 'buddy-test-branch\n'; return 0; fi
      ;;
    worktree)
      if [[ "${2:-}" == "list" && "${3:-}" == "--porcelain" ]]; then printf 'worktree %s\nHEAD abc123\nbranch refs/heads/buddy-test-branch\n' "${OPENSPEC_BUDDY_REPO_ROOT:?}"; return 0; fi
      ;;
    remote)
      if [[ "${2:-}" == "get-url" ]]; then printf 'https://github.com/owner/repo.git\n'; return 0; fi
      ;;
  esac
  echo "unexpected git call: $*" >&2
  return 99
}
export -f git
gh() {
  printf '%s\n' "$*" >> "$GH_LOG_FILE"
  if [[ "$1" == "api" && "$2" == */pulls/123 ]]; then
    printf '%s\n' '{"number":123,"head":{"ref":"buddy-test-branch","sha":"head-1"},"body":"Origin issue: #42\n<!-- openspec-buddy-origin-issue:42 -->"}'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/reviews* ]]; then
    printf '%s\n' '[[{"user":{"login":"chatgpt-codex-connector"},"state":"COMMENTED","body":"No actionable findings.","submitted_at":"2026-01-01T00:02:00Z","commit_id":"head-1"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/commits* ]]; then
    printf '%s\n' '[[{"sha":"head-1","commit":{"author":{"date":"2026-01-01T00:00:00Z"},"committer":{"date":"2026-01-01T00:00:00Z"}}}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */pulls/123/comments* ]]; then
    printf '%s\n' '[[]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "--paginate" && "$3" == "--slurp" && "$4" == */issues/123/comments* ]]; then
    printf '%s\n' '[[{"user":{"login":"YW"},"body":"@codex review 中文回复，即使没有重大问题也必须给出显式回复","created_at":"2026-01-01T00:01:00Z","html_url":"https://github.com/owner/repo/pull/123#issuecomment-1"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == */issues/42 ]]; then
    printf '{"number":42,"state":"open","labels":[{"name":"status:claimed"}]}\n'
    return 0
  fi
  if [[ "$1" == "api" && "${2:-}" == "--paginate" && "${3:-}" == "--slurp" && "${4:-}" == */issues/42/comments* ]]; then
    printf '%s\n' '[[{"created_at":"2026-01-01T00:00:00Z","body":"OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: @YW\nchange_id: buddy-test-branch\nbranch: buddy-test-branch\nbase_branch: integration\nbase_sha: abc123\nlease_until: 2026-01-02T00:00:00.000Z"}]]'
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "graphql" ]]; then
    cat <<'JSON'
{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[{"isResolved":false,"path":"src/demo.js","line":12,"comments":{"nodes":[{"author":{"login":"chatgpt-codex-connector"},"body":"P1: still broken","url":"https://example.test/thread"}]}}]}}}}}
JSON
    return 0
  fi
  if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
    cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
    return 0
  fi
  echo "unexpected gh call: $*" >&2
  return 99
}
export -f gh
EOF

set +e
BASH_ENV="$tmp_dir/gh-env.sh" bash "$helper" 123 >"$tmp_dir/stale-out.txt" 2>"$tmp_dir/stale-err.txt"
stale_status="$?"
set -e

if [[ "$stale_status" -eq 0 ]]; then
  echo "verify-review-clear should refresh review threads instead of trusting stale cache" >&2
  exit 1
fi

if ! grep -F 'Found unresolved review thread' "$tmp_dir/stale-err.txt" >/dev/null; then
  echo "expected refreshed GraphQL review thread failure" >&2
  cat "$tmp_dir/stale-err.txt" >&2
  exit 1
fi

echo "verify-review-clear cache tests passed"
