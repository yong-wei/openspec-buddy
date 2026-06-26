#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: reply-review-thread.sh <pr-number-or-url> <review-thread-node-id> --head <sha> --body-file <file>"
  exit 0
fi

pr_ref="${1:-}"
thread_id="${2:-}"
shift 2 2>/dev/null || true

head_sha=""
body_file=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --head)
      head_sha="${2:-}"
      shift 2
      ;;
    --body-file)
      body_file="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$pr_ref" || -z "$thread_id" || -z "$head_sha" || -z "$body_file" ]]; then
  echo "Usage: reply-review-thread.sh <pr-number-or-url> <review-thread-node-id> --head <sha> --body-file <file>" >&2
  exit 2
fi
if [[ ! -s "$body_file" ]]; then
  echo "Reply body file is missing or empty: $body_file" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

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

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
owner="${repo_nwo%%/*}"
repo="${repo_nwo#*/}"
cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"
pr_file="$tmp_dir/pr.json"
gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"

current_head="$(node -e 'const fs=require("node:fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(pr.head?.sha || "");' "$pr_file")"
if [[ -z "$current_head" || "$current_head" != "$head_sha" ]]; then
  echo "Reply head $head_sha does not match current PR head ${current_head:-unknown}." >&2
  exit 1
fi

threads_file="$(buddy_review_threads_graphql "$owner" "$repo" "$pr_number" "$cache_dir")"
node -e '
const fs = require("node:fs");
const [threadsFile, threadId, head, bodyFile] = process.argv.slice(1);
const input = JSON.parse(fs.readFileSync(threadsFile, "utf8"));
const body = fs.readFileSync(bodyFile, "utf8");
const threads = input?.data?.repository?.pullRequest?.reviewThreads?.nodes || input?.reviewThreads?.nodes || input?.reviewThreads || [];
if (!threads.some((thread) => thread.id === threadId)) {
  process.stderr.write(`Review thread ${threadId} was not found on the current PR.\n`);
  process.exit(1);
}
const lower = body.toLowerCase();
const mentionsHead = lower.includes(head.toLowerCase()) || lower.includes(head.slice(0, 7).toLowerCase());
const rationale = /\b(rationale|reason|not actionable|non-actionable)\b/i.test(body) || /(理由|不是行动项|非行动项|无需修改)/.test(body);
const evidence = /\b(verified|verification|test|tests|passed|evidence|validated|validation)\b/i.test(body) || /(验证|证据|测试通过|校验通过)/.test(body);
if (!(mentionsHead || rationale) || !evidence) {
  process.stderr.write("Reply body must mention the current head or include a non-actionable rationale, and include verification evidence.\n");
  process.exit(1);
}
' "$threads_file" "$thread_id" "$head_sha" "$body_file"

mutation_file="$tmp_dir/reply.json"
buddy_graphql_api \
  -f query='
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      id
      url
    }
  }
}' \
  -f threadId="$thread_id" \
  -f body="$(<"$body_file")" > "$mutation_file"

node -e '
const fs = require("node:fs");
const [file, expectedThread] = process.argv.slice(1);
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const comment = data?.data?.addPullRequestReviewThreadReply?.comment;
if (!comment?.id) {
  process.stderr.write("Could not verify review thread reply mutation result.\n");
  process.exit(1);
}
process.stdout.write(`${comment.url || comment.id}\n`);
' "$mutation_file" "$thread_id"
