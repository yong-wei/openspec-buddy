#!/usr/bin/env bash
set -euo pipefail

thread_id="${1:-}"
if [[ -z "$thread_id" ]]; then
  echo "Usage: resolve-review-thread.sh <review-thread-node-id>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

query_thread() {
  buddy_graphql_api \
    -f query='
query($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      id
      isResolved
      isOutdated
      path
      line
      startLine
      originalLine
    }
  }
}' \
    -f threadId="$thread_id"
}

thread_resolved() {
  node -e '
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const thread = input?.data?.node || input?.data?.resolveReviewThread?.thread;
if (!thread || thread.id !== process.argv[2]) {
  process.stderr.write(`Could not verify review thread ${process.argv[2]}.\n`);
  process.exit(3);
}
process.stdout.write(thread.isResolved ? "true" : "false");
' "$1" "$thread_id"
}

thread_label() {
  node -e '
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const thread = input?.data?.node || input?.data?.resolveReviewThread?.thread || {};
const line = thread.line || thread.startLine || thread.originalLine || "";
const label = thread.path ? `${thread.path}${line ? `:${line}` : ""}` : process.argv[2];
const suffix = thread.isOutdated ? " (outdated)" : "";
process.stdout.write(`${label}${suffix}`);
' "$1" "$thread_id"
}

before_file="$tmp_dir/thread-before.json"
query_thread > "$before_file"

before_resolved="$(thread_resolved "$before_file")"
before_label="$(thread_label "$before_file")"

if [[ "$before_resolved" == "true" ]]; then
  printf 'Review thread %s already resolved and verified.\n' "$before_label"
  exit 0
fi

mutation_file="$tmp_dir/resolve-mutation.json"
buddy_graphql_api \
  -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}' \
  -f threadId="$thread_id" > "$mutation_file"

mutation_resolved="$(thread_resolved "$mutation_file")"
if [[ "$mutation_resolved" != "true" ]]; then
  echo "Review thread $before_label resolve mutation did not return isResolved=true." >&2
  exit 1
fi

after_file="$tmp_dir/thread-after.json"
query_thread > "$after_file"

after_resolved="$(thread_resolved "$after_file")"
after_label="$(thread_label "$after_file")"

if [[ "$after_resolved" != "true" ]]; then
  echo "Review thread $after_label is still unresolved after resolve mutation." >&2
  exit 1
fi

printf 'Review thread %s resolved and verified.\n' "$after_label"
