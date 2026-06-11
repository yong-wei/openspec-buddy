#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ -z "$pr_ref" ]]; then
  echo "Usage: verify-review-clear.sh <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_file="$tmp_dir/pr.json"
pr_rest_file="$tmp_dir/pr-rest.json"
reviews_file="$tmp_dir/reviews.json"
commits_file="$tmp_dir/commits.json"
issue_comments_file="$tmp_dir/issue-comments.json"
review_comments_file="$tmp_dir/review-comments.json"
review_threads_file="$tmp_dir/review-threads.json"
reviewer="${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}"

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
  gh pr view "$ref" --json number --jq '.number'
}

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
owner="${repo_nwo%%/*}"
repo="${repo_nwo#*/}"
cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"

buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
cp "$BUDDY_PR_REST_FILE" "$pr_rest_file"
cp "$BUDDY_REVIEWS_FILE" "$reviews_file"
cp "$BUDDY_COMMITS_FILE" "$commits_file"
cp "$BUDDY_ISSUE_COMMENTS_FILE" "$issue_comments_file"
cp "$BUDDY_REVIEW_COMMENTS_FILE" "$review_comments_file"

node -e '
const fs = require("node:fs");
const [prRestFile, reviewsFile, commitsFile, commentsFile, prFile] = process.argv.slice(1);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

const pr = readJson(prRestFile);
const reviews = array(readJson(reviewsFile));
const commits = array(readJson(commitsFile));
const comments = array(readJson(commentsFile));

const output = {
  number: pr.number,
  url: pr.html_url,
  headRefOid: pr.head?.sha || "",
  reviews: reviews.map((review, index) => ({
    __index: index,
    author: review.user,
    user: review.user,
    state: review.state,
    body: review.body || "",
    submittedAt: review.submitted_at,
    commit: { oid: review.commit_id || "" },
    commit_id: review.commit_id || "",
  })),
  comments: comments.map((comment) => ({
    author: comment.user,
    user: comment.user,
    body: comment.body || "",
    createdAt: comment.created_at,
    url: comment.html_url,
  })),
  commits: commits.map((commit) => ({
    oid: commit.sha,
    committedDate: commit.commit?.committer?.date || commit.commit?.author?.date || "",
    authoredDate: commit.commit?.author?.date || "",
  })),
};

fs.writeFileSync(prFile, `${JSON.stringify(output)}\n`);
' "$pr_rest_file" "$reviews_file" "$commits_file" "$issue_comments_file" "$pr_file"

buddy_review_threads_graphql "$owner" "$repo" "$pr_number" "$cache_dir" >/dev/null
cp "$BUDDY_REVIEW_THREADS_FILE" "$review_threads_file"

node "$script_dir/verify-review-clear.mjs" "$pr_file" "$review_comments_file" "$review_threads_file" "$reviewer"
