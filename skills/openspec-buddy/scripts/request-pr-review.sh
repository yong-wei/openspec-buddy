#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
mode="${2:-}"

if [[ -z "$pr_ref" ]]; then
  echo "Usage: request-pr-review.sh <pr-number-or-url> [--dry-run]" >&2
  exit 2
fi

dry_run=0
if [[ "$mode" == "--dry-run" ]]; then
  dry_run=1
elif [[ -n "$mode" ]]; then
  echo "Unknown option: $mode" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
openspec_buddy_require_core_config

review_request="${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"
if [[ -z "$review_request" ]]; then
  echo "Missing OPENSPEC_BUDDY_PR_REVIEW_REQUEST; configure the explicit PR review request before entering review." >&2
  exit 2
fi

command_timeout="${OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS:-60}"

if ! [[ "$command_timeout" =~ ^[0-9]+$ ]]; then
  echo "OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS must be a non-negative integer." >&2
  exit 2
fi

run_with_timeout() {
  if [[ "$command_timeout" -gt 0 ]] && command -v timeout >/dev/null 2>&1; then
    timeout "$command_timeout"s "$@"
  else
    "$@"
  fi
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
  return 1
}

cache_dir="$(buddy_cache_dir)"
repo_nwo="$(buddy_repo_nwo)"
buddy_signal_apply "$cache_dir" "$repo_nwo"
pr_number="$(resolve_pr_number "$pr_ref")" || {
  echo "Could not resolve pull request number from: $pr_ref" >&2
  exit 1
}

"$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
"$script_dir/verify-review-threads-resolved.sh" "$pr_ref"

OPENSPEC_BUDDY_CACHE_REFRESH=1 buddy_pr_rest_bundle "$repo_nwo" "$pr_number" "$cache_dir"
pr_json_file="$(mktemp)"
trap 'rm -f "$pr_json_file"' EXIT
node -e '
const fs = require("node:fs");
const [prFile, commitsFile, commentsFile] = process.argv.slice(1);
const pr = JSON.parse(fs.readFileSync(prFile, "utf8"));
const commits = JSON.parse(fs.readFileSync(commitsFile, "utf8"));
const comments = JSON.parse(fs.readFileSync(commentsFile, "utf8"));
const output = {
  headRefOid: pr.head?.sha || pr.headRefOid || "",
  commits: Array.isArray(commits)
    ? commits.map((commit) => ({
        oid: commit.sha,
        committedDate: commit.commit?.committer?.date || commit.commit?.author?.date || "",
        authoredDate: commit.commit?.author?.date || "",
      }))
    : [],
  comments: Array.isArray(comments)
    ? comments.map((comment) => ({
        body: comment.body || "",
        createdAt: comment.created_at,
      }))
    : [],
};
process.stdout.write(JSON.stringify(output));
' "$BUDDY_PR_REST_FILE" "$BUDDY_COMMITS_FILE" "$BUDDY_ISSUE_COMMENTS_FILE" > "$pr_json_file"
request_state="$(
  node -e '
const fs = require("node:fs");
const [reviewRequest, prFile] = process.argv.slice(1);
let pr = {};
try {
  const raw = fs.readFileSync(prFile, "utf8").trim();
  pr = raw ? JSON.parse(raw) : {};
} catch {
  pr = {};
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.nodes)) return value.nodes;
  return [];
}

function entryTime(entry) {
  const value = entry?.createdAt || entry?.created_at || entry?.committedDate || entry?.committed_at || entry?.authoredDate || entry?.authored_at || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

const comments = list(pr.comments);
const commits = list(pr.commits);
const headOid = pr.headRefOid || pr.headOid || pr.head?.oid || "";
const headCommit = commits.find((commit) => commit?.oid === headOid || commit?.sha === headOid) || commits.at(-1);
const headTime = entryTime(headCommit);
const matchingRequests = comments.filter((comment) => String(comment?.body || "").includes(reviewRequest));

if (headTime === null) {
  process.stdout.write(matchingRequests.length > 0 ? "present-unknown-head" : "missing");
  process.exit(0);
}

const freshRequest = matchingRequests.some((comment) => {
  const createdAt = entryTime(comment);
  return createdAt !== null && createdAt >= headTime;
});

process.stdout.write(freshRequest ? "present-current-head" : "missing-current-head");
' "$review_request" "$pr_json_file"
)"

if [[ "$request_state" == "present-current-head" || "$request_state" == "present-unknown-head" ]]; then
  printf 'PR review request already present for %s (%s).\n' "$pr_ref" "$request_state"
  exit 0
fi

if [[ "$dry_run" == "1" ]]; then
  printf '[dry-run] add PR review request to %s: %s\n' "$pr_ref" "$review_request"
else
  run_with_timeout gh pr comment "$pr_ref" --body "$review_request" >/dev/null
  buddy_invalidate_cache "$(buddy_cache_path pr "$pr_number" "$cache_dir")"
  buddy_invalidate_pr_rest_bundle_cache "$cache_dir" "$pr_number"
  if [[ "${OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH:-0}" != "1" ]]; then
    buddy_signal_publish request-pr-review "pr:$pr_number"
  fi
  printf 'PR review request added to %s.\n' "$pr_ref"
fi
