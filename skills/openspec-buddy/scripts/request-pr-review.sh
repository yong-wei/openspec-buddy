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
openspec_buddy_require_core_config

review_request="${OPENSPEC_BUDDY_PR_REVIEW_REQUEST:-}"
if [[ -z "$review_request" ]]; then
  echo "Missing OPENSPEC_BUDDY_PR_REVIEW_REQUEST; configure the explicit PR review request before entering review." >&2
  exit 2
fi

command_timeout="${OPENSPEC_BUDDY_REVIEW_COMMAND_TIMEOUT_SECONDS:-60}"
verify_helper="${OPENSPEC_BUDDY_VERIFY_REVIEW_CLEAR_HELPER:-$script_dir/verify-review-clear.sh}"

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

is_waitable_review_failure() {
  local output="$1"
  if grep -E 'unresolved review thread|contains P[0-2]|requested changes|Latest COMMENTED review .*not an explicit' <<<"$output" >/dev/null; then
    return 1
  fi
  if grep -E 'No review found|no .*review request comment after the current head|top-level clear comment exists|targets .*,? not current head' <<<"$output" >/dev/null; then
    return 0
  fi
  return 1
}

run_review_request_gate() {
  local output_file
  output_file="$(mktemp)"
  local status
  if run_with_timeout "$verify_helper" "$pr_ref" > "$output_file" 2>&1; then
    cat "$output_file"
    rm -f "$output_file"
    return 0
  fi
  status="$?"

  local output
  output="$(cat "$output_file")"
  rm -f "$output_file"
  if [[ "$status" -eq 124 ]]; then
    echo "Review request gate timed out after ${command_timeout}s while checking existing review state." >&2
    return 2
  fi
  if is_waitable_review_failure "$output"; then
    return 1
  fi

  printf '%s\n' "$output" >&2
  return 2
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

resolve_repo_nwo() {
  local remote_url
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "$remote_url" == git@github.com:* ]]; then
    remote_url="${remote_url#git@github.com:}"
    printf '%s\n' "${remote_url%.git}"
    return 0
  fi
  if [[ "$remote_url" == https://github.com/* ]]; then
    remote_url="${remote_url#https://github.com/}"
    printf '%s\n' "${remote_url%.git}"
    return 0
  fi
  return 1
}

load_pr_json() {
  local parsed_pr_number
  local repo_nwo
  if parsed_pr_number="$(resolve_pr_number "$pr_ref")" && repo_nwo="$(resolve_repo_nwo)"; then
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    run_with_timeout gh api "repos/$repo_nwo/pulls/$parsed_pr_number" > "$tmp_dir/pr.json"
    run_with_timeout gh api "repos/$repo_nwo/pulls/$parsed_pr_number/commits?per_page=100" > "$tmp_dir/commits.json"
    run_with_timeout gh api "repos/$repo_nwo/issues/$parsed_pr_number/comments?per_page=100" > "$tmp_dir/comments.json"
    node -e '
const fs = require("node:fs");
const [prFile, commitsFile, commentsFile] = process.argv.slice(1);
const pr = JSON.parse(fs.readFileSync(prFile, "utf8"));
const commits = JSON.parse(fs.readFileSync(commitsFile, "utf8"));
const comments = JSON.parse(fs.readFileSync(commentsFile, "utf8"));
const output = {
  headRefOid: pr.head?.sha || "",
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
' "$tmp_dir/pr.json" "$tmp_dir/commits.json" "$tmp_dir/comments.json"
    rm -rf "$tmp_dir"
    return 0
  fi

  run_with_timeout gh pr view "$pr_ref" --json comments,commits,headRefOid 2>/dev/null || true
}

set +e
run_review_request_gate
gate_status="$?"
set -e
if [[ "$gate_status" -eq 0 ]]; then
  printf 'PR review already clear for %s; no review request added.\n' "$pr_ref"
  exit 0
fi
if [[ "$gate_status" -eq 2 ]]; then
  exit 1
fi

pr_json="$(load_pr_json)"
pr_json_file="$(mktemp)"
trap 'rm -f "$pr_json_file"' EXIT
printf '%s\n' "$pr_json" > "$pr_json_file"
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
  printf 'PR review request added to %s.\n' "$pr_ref"
fi
