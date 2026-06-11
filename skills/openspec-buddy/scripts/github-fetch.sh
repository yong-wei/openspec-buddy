#!/usr/bin/env bash

if ! declare -F openspec_buddy_repo_root >/dev/null 2>&1; then
  github_fetch_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=./load-config.sh
  source "$github_fetch_script_dir/load-config.sh"
fi

buddy_graphql_batch_size="${OPENSPEC_BUDDY_GRAPHQL_BATCH_SIZE:-25}"

buddy_repo_nwo() {
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
  gh repo view --json nameWithOwner --jq '.nameWithOwner'
}

buddy_cache_dir() {
  local fallback_dir="${1:-}"
  local cache_dir="${OPENSPEC_BUDDY_GH_CACHE_DIR:-}"
  if [[ -z "$cache_dir" ]]; then
    cache_dir="$fallback_dir"
  fi
  if [[ -z "$cache_dir" ]]; then
    cache_dir="$(mktemp -d)"
  fi
  mkdir -p "$cache_dir"
  export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
  printf '%s\n' "$cache_dir"
}

buddy_open_issues_rest() {
  local limit="${1:-100}"
  unset OPENSPEC_BUDDY_OPEN_ISSUES_NEEDS_BODY
  if gh issue list --state open --limit "$limit" --json number,title,url,state,labels,body; then
    return 0
  fi

  export OPENSPEC_BUDDY_OPEN_ISSUES_NEEDS_BODY=1
  gh issue list --state open --limit "$limit" --json number,title,url,state,labels
}

buddy_issue_body_rest() {
  local issue_number="$1"
  gh issue view "$issue_number" --json body --jq '.body'
}

buddy_graphql_failure_is_retryable() {
  local stderr_file="$1"
  grep -E 'rate limit|secondary rate|EOF|timeout|502|503|504' "$stderr_file" >/dev/null 2>&1
}

buddy_graphql_log_rate_limit() {
  local stderr_file="$1"
  {
    echo "GraphQL request failed; checking GitHub rate limit."
    gh api rate_limit --jq '.resources.graphql'
  } >> "$stderr_file" 2>/dev/null || true
}

buddy_issue_relationships_query() {
  local owner="$1"
  local repo="$2"
  shift 2
  local numbers=("$@")
  local issue_fields='
        id
        number
        title
        url
        state
        body
        labels(first: 40) { nodes { name } }
        parent { number title url state labels(first: 40) { nodes { name } } }
        subIssues(first: 100) { nodes { number title url state labels(first: 40) { nodes { name } } } }
        blockedBy(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
        blocking(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
'
  local query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {'
  local index
  for index in "${!numbers[@]}"; do
    query+=" issue${index}: issue(number: ${numbers[$index]}) { ${issue_fields} }"
  done
  query+=' } }'

  gh api graphql \
    -f query="$query" \
    -f owner="$owner" \
    -f name="$repo"
}

buddy_issue_relationships_fetch_batch() {
  local owner="$1"
  local repo="$2"
  local output_file="$3"
  local stderr_file="$4"
  shift 4
  local numbers=("$@")

  if buddy_issue_relationships_query "$owner" "$repo" "${numbers[@]}" >"$output_file" 2>"$stderr_file"; then
    return 0
  fi

  if [[ "${#numbers[@]}" -gt 1 ]] && buddy_graphql_failure_is_retryable "$stderr_file"; then
    buddy_graphql_log_rate_limit "$stderr_file"
    local midpoint=$(( ${#numbers[@]} / 2 ))
    if [[ "$midpoint" -lt 1 ]]; then
      midpoint=1
    fi
    local left=("${numbers[@]:0:$midpoint}")
    local right=("${numbers[@]:$midpoint}")
    local left_file="${output_file}.left"
    local right_file="${output_file}.right"
    local left_err="${stderr_file}.left"
    local right_err="${stderr_file}.right"

    buddy_issue_relationships_fetch_batch "$owner" "$repo" "$left_file" "$left_err" "${left[@]}"
    buddy_issue_relationships_fetch_batch "$owner" "$repo" "$right_file" "$right_err" "${right[@]}"

    node -e '
const fs = require("node:fs");
const readIssues = (file) => {
  const response = JSON.parse(fs.readFileSync(file, "utf8"));
  const repository = response.data?.repository || {};
  return Object.values(repository).filter(Boolean);
};
const [leftFile, rightFile, outputFile] = process.argv.slice(1);
const issues = [...readIssues(leftFile), ...readIssues(rightFile)];
process.stdout.write(`${JSON.stringify({ issues }, null, 2)}\n`);
' "$left_file" "$right_file" > "$output_file"
    return 0
  fi

  cat "$stderr_file" >&2
  return 1
}

buddy_issue_relationships_graphql() {
  local owner="$1"
  local repo="$2"
  shift 2
  local numbers=("$@")
  if [[ "${#numbers[@]}" -eq 0 ]]; then
    printf '[]\n'
    return 0
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  local files=()
  local start=0
  local batch_index=0
  local chunk=()
  local output_file
  local stderr_file

  while [[ "$start" -lt "${#numbers[@]}" ]]; do
    chunk=("${numbers[@]:$start:$buddy_graphql_batch_size}")
    output_file="$tmp_dir/batch-${batch_index}.json"
    stderr_file="$tmp_dir/batch-${batch_index}.err"
    buddy_issue_relationships_fetch_batch "$owner" "$repo" "$output_file" "$stderr_file" "${chunk[@]}"
    files+=("$output_file")
    start=$((start + buddy_graphql_batch_size))
    batch_index=$((batch_index + 1))
  done

  node -e '
const fs = require("node:fs");
const files = process.argv.slice(1);
const issues = [];
for (const file of files) {
  const response = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(response.issues)) {
    issues.push(...response.issues);
    continue;
  }
  const repository = response.data?.repository || {};
  issues.push(...Object.values(repository).filter(Boolean));
}
process.stdout.write(`${JSON.stringify(issues, null, 2)}\n`);
' "${files[@]}"
}

buddy_pr_rest_bundle() {
  local repo_nwo="$1"
  local pr_number="$2"
  local cache_dir="$3"
  mkdir -p "$cache_dir"

  export BUDDY_PR_REST_FILE="$cache_dir/pr-rest-${pr_number}.json"
  export BUDDY_REVIEWS_FILE="$cache_dir/reviews-${pr_number}.json"
  export BUDDY_COMMITS_FILE="$cache_dir/commits-${pr_number}.json"
  export BUDDY_ISSUE_COMMENTS_FILE="$cache_dir/issue-comments-${pr_number}.json"
  export BUDDY_REVIEW_COMMENTS_FILE="$cache_dir/review-comments-${pr_number}.json"

  [[ -f "$BUDDY_PR_REST_FILE" ]] || gh api "repos/$repo_nwo/pulls/$pr_number" > "$BUDDY_PR_REST_FILE"
  [[ -f "$BUDDY_REVIEWS_FILE" ]] || gh api "repos/$repo_nwo/pulls/$pr_number/reviews?per_page=100" > "$BUDDY_REVIEWS_FILE"
  [[ -f "$BUDDY_COMMITS_FILE" ]] || gh api "repos/$repo_nwo/pulls/$pr_number/commits?per_page=100" > "$BUDDY_COMMITS_FILE"
  [[ -f "$BUDDY_ISSUE_COMMENTS_FILE" ]] || gh api "repos/$repo_nwo/issues/$pr_number/comments?per_page=100" > "$BUDDY_ISSUE_COMMENTS_FILE"
  [[ -f "$BUDDY_REVIEW_COMMENTS_FILE" ]] || gh api "repos/$repo_nwo/pulls/$pr_number/comments" --paginate > "$BUDDY_REVIEW_COMMENTS_FILE"
}

buddy_review_threads_graphql() {
  local owner="$1"
  local repo="$2"
  local pr_number="$3"
  local cache_dir="$4"
  mkdir -p "$cache_dir"
  export BUDDY_REVIEW_THREADS_FILE="$cache_dir/review-threads-${pr_number}.json"

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
    -F number="$pr_number" > "$BUDDY_REVIEW_THREADS_FILE"

  printf '%s\n' "$BUDDY_REVIEW_THREADS_FILE"
}
