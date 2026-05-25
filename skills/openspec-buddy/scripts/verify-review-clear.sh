#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-review-clear.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_file="$tmp_dir/pr.json"
review_comments_file="$tmp_dir/review-comments.json"
review_threads_file="$tmp_dir/review-threads.json"
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"

gh pr view "$pr_ref" --json number,url,headRefOid,reviews,comments,commits > "$pr_file"
pr_number="$(node -e 'const fs=require("fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(pr.number));' "$pr_file")"
repo_nwo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
owner="${repo_nwo%%/*}"
repo="${repo_nwo#*/}"

gh api "repos/$repo_nwo/pulls/$pr_number/comments" --paginate > "$review_comments_file"
gh api graphql \
  -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          path
          line
          startLine
          originalLine
          comments(first: 50) {
            nodes {
              author { login }
              body
              url
            }
          }
        }
      }
    }
  }
}' \
  -f owner="$owner" \
  -f repo="$repo" \
  -F number="$pr_number" > "$review_threads_file"

node "$script_dir/verify-review-clear.mjs" "$pr_file" "$review_comments_file" "$review_threads_file" "$reviewer"
