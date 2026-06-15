#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: wait-for-review-clear.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
openspec_buddy_require_auto_config

initial_wait="${OPENSPEC_BUDDY_REVIEW_INITIAL_WAIT_SECONDS:-300}"
poll_wait="${OPENSPEC_BUDDY_REVIEW_POLL_SECONDS:-120}"
max_wait="${OPENSPEC_BUDDY_REVIEW_MAX_WAIT_SECONDS:-900}"
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"
verify_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER:-$script_dir/verify-review-clear.sh}"
command_timeout="${OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS:-60}"

if ! [[ "$initial_wait" =~ ^[0-9]+$ && "$poll_wait" =~ ^[0-9]+$ && "$max_wait" =~ ^[0-9]+$ && "$command_timeout" =~ ^[0-9]+$ ]]; then
  echo "Review wait values must be non-negative integer seconds." >&2
  exit 2
fi

run_with_timeout() {
  if [[ "$command_timeout" -gt 0 ]] && command -v timeout >/dev/null 2>&1; then
    timeout "$command_timeout"s "$@"
  else
    "$@"
  fi
}

gh_api_paginated_array() {
  local endpoint="$1"
  run_with_timeout gh api --paginate --slurp "$endpoint" | node -e '
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const pages = Array.isArray(input) ? input : [];
const flattened = pages.flatMap((page) => Array.isArray(page) ? page : []);
process.stdout.write(`${JSON.stringify(flattened)}\n`);
'
}

resolve_pr_number() {
  local ref="$1"
  if [[ "$ref" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$ref"
    return 0
  fi
  if [[ "$ref" =~ /pull/([0-9]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  run_with_timeout gh pr view "$ref" --json number --jq '.number'
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"
last_signature=""
first_check=1
started_at="$SECONDS"

light_state_signature() {
  local pr_file="$tmp_dir/pull.json"
  local issue_comments_file="$tmp_dir/issue-comments.json"
  local review_comments_file="$tmp_dir/review-comments.json"
  local reviews_file="$tmp_dir/reviews.json"
  local commits_file="$tmp_dir/commits.json"

  run_with_timeout gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"
  gh_api_paginated_array "repos/$repo_nwo/issues/$pr_number/comments?per_page=100" > "$issue_comments_file"
  gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/comments?per_page=100" > "$review_comments_file"
  gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/reviews?per_page=100" > "$reviews_file"
  gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/commits?per_page=100" > "$commits_file"
  cp "$pr_file" "$cache_dir/pr-rest-$pr_number.json"
  cp "$issue_comments_file" "$cache_dir/issue-comments-$pr_number.json"
  cp "$review_comments_file" "$cache_dir/review-comments-$pr_number.json"
  cp "$reviews_file" "$cache_dir/reviews-$pr_number.json"
  cp "$commits_file" "$cache_dir/commits-$pr_number.json"
  rm -f "$cache_dir/review-threads-$pr_number.json"

  node -e '
const fs = require("node:fs");
const [prFile, issueCommentsFile, reviewCommentsFile, reviewsFile] = process.argv.slice(1);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const ids = (items) => Array.isArray(items) ? items.map((item) => [
  item.id || item.node_id || "",
  item.updated_at || item.created_at || item.submitted_at || "",
  item.commit_id || "",
  item.state || "",
].join(":")) : [];
const pr = read(prFile);
const signature = {
  head: pr.head?.sha || "",
  issueComments: ids(read(issueCommentsFile)),
  reviewComments: ids(read(reviewCommentsFile)),
  reviews: ids(read(reviewsFile)),
};
process.stdout.write(JSON.stringify(signature));
' "$pr_file" "$issue_comments_file" "$review_comments_file" "$reviews_file"
}

is_waitable_review_failure() {
  local output="$1"
  if grep -E 'targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  if grep -E 'unresolved review thread|contains P[0-2]|requested changes|Latest COMMENTED review .*not an explicit' <<<"$output" >/dev/null; then
    return 1
  fi
  if grep -E 'No review found|no .*review request comment after the current head|top-level clear comment exists|targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  return 1
}

run_clear_gate() {
  local output_file="$tmp_dir/verify-output.txt"
  local status=0
  OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir" run_with_timeout "$verify_helper" "$pr_number" > "$output_file" 2>&1 || status="$?"

  if [[ "$status" -eq 0 ]]; then
    cat "$output_file"
    return 0
  fi
  if [[ "$status" -eq 124 ]]; then
    echo "Review clearance verifier timed out after ${command_timeout}s." >&2
    cat "$output_file" >&2
    return 2
  fi

  if is_waitable_review_failure "$(cat "$output_file")"; then
    return 1
  fi

  cat "$output_file" >&2
  return 2
}

sleep_if_needed() {
  local seconds="$1"
  if [[ "$seconds" -gt 0 ]]; then
    sleep "$seconds"
  fi
}

set +e
run_clear_gate
gate_status="$?"
set -e

if [[ "$gate_status" -eq 0 ]]; then
  exit 0
fi
if [[ "$gate_status" -eq 2 ]]; then
  exit 1
fi

sleep_if_needed "$initial_wait"

while true; do
  elapsed=$((SECONDS - started_at))
  signature="$(light_state_signature)"

  if [[ "$first_check" -eq 1 || "$signature" != "$last_signature" || "$elapsed" -ge "$max_wait" ]]; then
    set +e
    run_clear_gate
    gate_status="$?"
    set -e

    if [[ "$gate_status" -eq 0 ]]; then
      exit 0
    fi
    if [[ "$gate_status" -eq 2 ]]; then
      exit 1
    fi
  fi

  first_check=0
  last_signature="$signature"
  elapsed=$((SECONDS - started_at))
  if [[ "$elapsed" -ge "$max_wait" ]]; then
    echo "Timed out waiting for a current-head clean review on PR #$pr_number from $reviewer after ${max_wait}s." >&2
    echo "Run verify-review-clear.sh for the latest diagnostic before deciding whether to continue waiting or mark needs-human." >&2
    exit 124
  fi

  remaining=$((max_wait - elapsed))
  next_sleep="$poll_wait"
  if [[ "$next_sleep" -gt "$remaining" ]]; then
    next_sleep="$remaining"
  fi
  sleep_if_needed "$next_sleep"
done
