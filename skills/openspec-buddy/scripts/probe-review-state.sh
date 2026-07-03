#!/usr/bin/env bash
set -euo pipefail

pr_ref="${1:-}"
if [[ "$pr_ref" == "-h" || "$pr_ref" == "--help" ]]; then
  echo "Usage: probe-review-state.sh <pr-number-or-url> [--force-request-state]"
  exit 0
fi
if [[ -z "$pr_ref" ]]; then
  echo "Usage: probe-review-state.sh <pr-number-or-url> [--force-request-state]" >&2
  exit 2
fi

force_request_state=0
shift
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --force-request-state)
      force_request_state=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_auto_config

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
if [[ "${OPENSPEC_BUDDY_PROBE_SKIP_WORKTREE_GUARD:-0}" != "1" ]]; then
  "$script_dir/verify-claim-worktree.sh" --pr "$pr_number" >/dev/null
fi

repo_nwo="$(buddy_repo_nwo)"
cache_dir="$(buddy_cache_dir)"
signature_file="$(buddy_pr_signature_rest "$repo_nwo" "$pr_number" "$cache_dir")"
signature="$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))));' "$signature_file")"

last_signature="${OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE:-}"
if [[ -z "$last_signature" && -n "${OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE_FILE:-}" && -f "${OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE_FILE:-}" ]]; then
  last_signature="$(<"$OPENSPEC_BUDDY_REVIEW_LAST_SIGNATURE_FILE")"
fi

head_sha="$(node -e 'const s=JSON.parse(process.argv[1]); process.stdout.write(s.head || "");' "$signature")"
last_head_sha="${OPENSPEC_BUDDY_REVIEW_LAST_HEAD:-}"
previous_request_state="${OPENSPEC_BUDDY_REVIEW_PREVIOUS_REQUEST_STATE:-}"
request_state="$previous_request_state"
clear_candidate='{"hasCandidate":false}'

if [[ "$force_request_state" == "1" || "$signature" != "$last_signature" || -z "$request_state" ]]; then
  pr_file="$cache_dir/probe-pr-${pr_number}.json"
  commits_file="$cache_dir/probe-commits-${pr_number}.json"
  comments_file="$cache_dir/probe-issue-comments-${pr_number}.json"
  reviews_file="$cache_dir/probe-reviews-${pr_number}.json"
  node -e '
const fs = require("node:fs");
const signature = JSON.parse(process.argv[1]);
process.stdout.write(`${JSON.stringify({ head: { sha: signature.head || "" } })}\n`);
' "$signature" > "$pr_file"
  buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/commits?per_page=100" > "$commits_file"
  buddy_gh_api_paginated_array "repos/$repo_nwo/issues/$pr_number/comments?per_page=100" > "$comments_file"
  buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/reviews?per_page=100" > "$reviews_file"
  request_state="$(node "$script_dir/review-request-state.mjs" "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$pr_file" "$commits_file" "$comments_file")"
  clear_candidate="$(node "$script_dir/current-head-clear-comment-candidate.mjs" "$OPENSPEC_BUDDY_PR_REVIEW_REQUEST" "$pr_file" "$commits_file" "$comments_file" "$reviews_file" "${OPENSPEC_BUDDY_PR_REVIEW_AUTHOR:-chatgpt-codex-connector}")"
fi

requested_at="${OPENSPEC_BUDDY_REVIEW_REQUESTED_AT:-}"
retry_after="${OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS:-900}"
retry_count="${OPENSPEC_BUDDY_REVIEW_RETRY_COUNT:-0}"
if ! [[ "$retry_after" =~ ^[0-9]+$ && "$retry_count" =~ ^[0-9]+$ ]]; then
  echo "OPENSPEC_BUDDY_REVIEW_RETRY_SECONDS and OPENSPEC_BUDDY_REVIEW_RETRY_COUNT must be non-negative integers." >&2
  exit 2
fi

node -e '
const signature = JSON.parse(process.argv[1]);
const lastSignature = process.argv[2] || "";
const requestState = process.argv[3] || "";
const requestedAt = process.argv[4] || "";
const retryAfter = Number(process.argv[5] || 900);
const retryCount = Number(process.argv[6] || 0);
const lastHead = process.argv[7] || "";
const pr = process.argv[8] || "";
let clearCandidate = {};
try {
  clearCandidate = JSON.parse(process.argv[9] || "{}");
} catch {}
const head = signature.head || "";
let requestAgeSeconds = 0;
const requestedTime = Date.parse(requestedAt);
if (Number.isFinite(requestedTime)) {
  requestAgeSeconds = Math.max(0, Math.floor((Date.now() - requestedTime) / 1000));
}
let state = "waiting";
if (lastHead && head && lastHead !== head) {
  state = "head_changed";
} else if (requestState !== "present-current-head") {
  state = "request_missing";
} else if (lastSignature && JSON.stringify(signature) !== lastSignature) {
  state = "changed";
}
process.stdout.write(`${JSON.stringify({
  pr,
  head,
  signature: JSON.stringify(signature),
  requestState,
  state,
  requestAgeSeconds,
  retryDue: requestAgeSeconds >= retryAfter && retryCount === 0,
  retryExpired: requestAgeSeconds >= retryAfter && retryCount > 0,
  clearCandidate: Boolean(clearCandidate.hasCandidate),
  clearCandidateSource: clearCandidate.source || "",
})}\n`);
' "$signature" "$last_signature" "$request_state" "$requested_at" "$retry_after" "$retry_count" "$last_head_sha" "$pr_number" "$clear_candidate"
