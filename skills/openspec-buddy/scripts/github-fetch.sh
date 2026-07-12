#!/usr/bin/env bash

github_fetch_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! declare -F openspec_buddy_repo_root >/dev/null 2>&1; then
  # shellcheck source=./load-config.sh
  source "$github_fetch_script_dir/load-config.sh"
fi

buddy_graphql_batch_size="${OPENSPEC_BUDDY_GRAPHQL_BATCH_SIZE:-25}"
buddy_project_cache_ttl_seconds=86400
buddy_issue_cache_ttl_seconds=600
buddy_pr_cache_ttl_seconds=600
buddy_relationship_cache_ttl_seconds=120
buddy_ready_scan_cache_ttl_seconds=120

buddy_cache_tool() {
  node "$github_fetch_script_dir/buddy-cache.mjs" "$@"
}

buddy_metrics_event() {
  local cache_dir="$1"
  local kind="$2"
  local surface="$3"
  local outcome="$4"
  local context="${5:-}"
  local metrics_tool="$github_fetch_script_dir/cache-metrics.mjs"
  [[ -f "$metrics_tool" ]] || return 0
  node "$metrics_tool" event "$cache_dir" "$kind" "$surface" "$outcome" "$context" >/dev/null 2>&1 || true
}

buddy_cache_dir() {
  local fallback_dir="${1:-}"
  local cache_dir="${OPENSPEC_BUDDY_CACHE_DIR:-${OPENSPEC_BUDDY_GH_CACHE_DIR:-$fallback_dir}}"
  cache_dir="$(bash "$github_fetch_script_dir/ensure-cache-dir.sh" "$cache_dir")"
  export OPENSPEC_BUDDY_CACHE_DIR="$cache_dir"
  export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
  printf '%s\n' "$cache_dir"
}

buddy_cache_path() {
  local object_type="$1"
  local key="${2:-}"
  local cache_dir="${3:-}"
  buddy_cache_tool path "$(openspec_buddy_repo_root)" "$object_type" "$key" "$cache_dir"
}

buddy_cache_expected_repo() {
  local remote_nwo
  remote_nwo="$(buddy_repo_nwo_from_remote || true)"
  printf '%s\n' "${remote_nwo:-unknown}"
}

buddy_project_cache_key() {
  printf '%s\n' "${OPENSPEC_BUDDY_PROJECT_OWNER}:${OPENSPEC_BUDDY_PROJECT_NUMBER}:${OPENSPEC_BUDDY_PROJECT_STATUS_FIELD}:${OPENSPEC_BUDDY_PROJECT_START_FIELD}:${OPENSPEC_BUDDY_PROJECT_END_FIELD}"
}

buddy_cache_is_stale() {
  local file="$1"
  local ttl_seconds="$2"
  local object_type="${3:-}"
  local key="${4:-}"
  local repo_nwo="${5:-}"
  if [[ -z "$repo_nwo" ]]; then
    repo_nwo="$(buddy_cache_expected_repo)"
  fi
  [[ "$(buddy_cache_tool stale "$file" "$ttl_seconds" "$repo_nwo" "$object_type" "$key")" == "true" ]]
}

buddy_cache_refresh_call() {
  local had_refresh=0
  local previous_refresh=""
  if [[ "${OPENSPEC_BUDDY_CACHE_REFRESH+x}" == "x" ]]; then
    had_refresh=1
    previous_refresh="$OPENSPEC_BUDDY_CACHE_REFRESH"
  fi
  export OPENSPEC_BUDDY_CACHE_REFRESH=1
  local status
  if "$@"; then
    status=0
  else
    status=$?
  fi
  if [[ "$had_refresh" == "1" ]]; then
    export OPENSPEC_BUDDY_CACHE_REFRESH="$previous_refresh"
  else
    unset OPENSPEC_BUDDY_CACHE_REFRESH
  fi
  return "$status"
}

buddy_cache_data_to_file() {
  local cache_file="$1"
  local output_file="$2"
  local object_type="${3:-}"
  local key="${4:-}"
  local repo_nwo="${5:-}"
  if [[ -z "$repo_nwo" ]]; then
    repo_nwo="$(buddy_cache_expected_repo)"
  fi
  buddy_cache_tool data "$cache_file" "$repo_nwo" "$object_type" "$key" > "$output_file"
}

buddy_cache_set_from_file() {
  local cache_file="$1"
  local source_name="$2"
  local object_type="$3"
  local key="$4"
  local input_file="$5"
  local updated_at="${6:-}"
  local repo_nwo
  repo_nwo="$(buddy_repo_nwo_from_remote || true)"
  repo_nwo="${repo_nwo:-unknown}"
  buddy_cache_tool set "$cache_file" "$source_name" "$repo_nwo" "$object_type" "$key" "$updated_at" < "$input_file" >/dev/null
}

buddy_cache_merge_from_file() {
  local cache_file="$1"
  local source_name="$2"
  local object_type="$3"
  local key="$4"
  local input_file="$5"
  local updated_at="${6:-}"
  local repo_nwo
  repo_nwo="$(buddy_repo_nwo_from_remote || true)"
  repo_nwo="${repo_nwo:-unknown}"
  buddy_cache_tool merge "$cache_file" "$source_name" "$repo_nwo" "$object_type" "$key" "$updated_at" < "$input_file" >/dev/null
}

buddy_invalidate_cache() {
  local cache_file="$1"
  buddy_cache_tool invalidate "$cache_file"
}

buddy_signal_state_cache_file() {
  local cache_dir="$1"
  buddy_cache_path signal-state state "$cache_dir"
}

buddy_signal_payload_cache_file() {
  local cache_dir="$1"
  buddy_cache_path signal-payload payload "$cache_dir"
}

buddy_invalidate_issue_cache() {
  local cache_dir="$1"
  shift
  local issue_number
  for issue_number in "$@"; do
    [[ -n "$issue_number" ]] || continue
    buddy_invalidate_cache "$(buddy_cache_path issue "$issue_number" "$cache_dir")"
  done
}

buddy_invalidate_pr_cache() {
  local cache_dir="$1"
  shift
  local pr_number
  for pr_number in "$@"; do
    [[ -n "$pr_number" ]] || continue
    buddy_invalidate_cache "$(buddy_cache_path pr "$pr_number" "$cache_dir")"
  done
}

buddy_invalidate_pr_rest_bundle_cache() {
  local cache_dir="$1"
  shift
  local pr_number
  for pr_number in "$@"; do
    [[ -n "$pr_number" ]] || continue
    rm -f \
      "$cache_dir/pr-rest-${pr_number}.json" \
      "$cache_dir/reviews-${pr_number}.json" \
      "$cache_dir/commits-${pr_number}.json" \
      "$cache_dir/issue-comments-${pr_number}.json" \
      "$cache_dir/review-comments-${pr_number}.json"
  done
}

buddy_invalidate_issue_relationship_cache() {
  local cache_dir="$1"
  shift
  local issue_number
  for issue_number in "$@"; do
    [[ -n "$issue_number" ]] || continue
    buddy_invalidate_cache "$(buddy_cache_path relationship "issue-$issue_number" "$cache_dir")"
  done
}

buddy_invalidate_ready_scan_cache() {
  local cache_dir="$1"
  rm -f "$cache_dir"/relationships/ready-scan-limit-*.json
}

buddy_invalidate_project_cache() {
  local cache_dir="$1"
  buddy_invalidate_cache "$(buddy_cache_path project project "$cache_dir")"
}

buddy_invalidate_all_relationship_cache() {
  local cache_dir="$1"
  rm -f "$cache_dir"/relationships/issue-*.json
  buddy_invalidate_ready_scan_cache "$cache_dir"
}

buddy_subject_number_from_file() {
  local subject_file="$1"
  node -e 'const fs=require("node:fs"); const subject=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(subject.number || ""));' "$subject_file"
}

buddy_invalidate_subject_cache_from_file() {
  local subject_file="$1"
  local cache_dir="$2"
  local subject_number
  subject_number="$(buddy_subject_number_from_file "$subject_file")"
  [[ -n "$subject_number" ]] || return 0
  if node -e 'const fs=require("node:fs"); const subject=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(String(subject.url || "").includes("/pull/") ? 0 : 1);' "$subject_file"; then
    buddy_invalidate_cache "$(buddy_cache_path pr "$subject_number" "$cache_dir")"
  else
    buddy_invalidate_cache "$(buddy_cache_path issue "$subject_number" "$cache_dir")"
  fi
}

buddy_ref_cache_key() {
  local ref="$1"
  ref="${ref#https://github.com/}"
  ref="${ref#http://github.com/}"
  ref="${ref//\//-}"
  ref="${ref//#/}"
  printf '%s\n' "$ref"
}

buddy_repo_nwo_from_remote() {
  local remote_name
  remote_name="${OPENSPEC_BUDDY_CACHE_SIGNAL_REMOTE:-origin}"
  local repo_root
  repo_root="$(openspec_buddy_repo_root)"
  local remote_url
  remote_url="$(git -C "$repo_root" remote get-url "$remote_name" 2>/dev/null || true)"
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

buddy_relationship_neighbor_numbers() {
  if [[ "$#" -eq 0 ]]; then
    return 0
  fi
  node -e '
const fs = require("node:fs");
const seen = new Set();
for (const file of process.argv.slice(1)) {
  const relationship = JSON.parse(fs.readFileSync(file, "utf8")).data || {};
  const numbers = [
    relationship.number,
    relationship.parentNumber,
    ...(relationship.subIssueNumbers || []),
    ...(relationship.blockedByNumbers || []),
    ...(relationship.blockingNumbers || []),
  ];
  for (const value of numbers) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) {
      seen.add(number);
    }
  }
}
for (const number of [...seen].sort((left, right) => left - right)) {
  process.stdout.write(`${number}\n`);
}
' "$@"
}

buddy_repo_json() {
  local cache_dir="$1"
  local output_file="$2"
  local cache_file
  cache_file="$(buddy_cache_path repo repo "$cache_dir")"

  if buddy_cache_is_stale "$cache_file" "$buddy_project_cache_ttl_seconds" repo repo; then
    local raw_file
    raw_file="$(mktemp)"
    buddy_metrics_event "$cache_dir" github rest managed_request '{"surface":"repo"}'
    gh repo view --json nameWithOwner,defaultBranchRef > "$raw_file"
    local normalized_file
    normalized_file="$(mktemp)"
    node -e '
const fs = require("node:fs");
const repo = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const payload = {
  nameWithOwner: repo.nameWithOwner || "",
  defaultBranch: repo.defaultBranchRef?.name || "",
};
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
' "$raw_file" > "$normalized_file"
    buddy_cache_set_from_file "$cache_file" rest repo repo "$normalized_file"
    rm -f "$raw_file" "$normalized_file"
  fi

  buddy_cache_data_to_file "$cache_file" "$output_file" repo repo
}

buddy_repo_nwo() {
  local remote_nwo
  if remote_nwo="$(buddy_repo_nwo_from_remote)"; then
    printf '%s\n' "$remote_nwo"
    return 0
  fi

  local cache_dir tmp_file
  cache_dir="$(buddy_cache_dir)"
  tmp_file="$(mktemp)"
  buddy_repo_json "$cache_dir" "$tmp_file"
  node -e 'const fs=require("node:fs"); const repo=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(repo.nameWithOwner || "");' "$tmp_file"
  rm -f "$tmp_file"
}

buddy_repo_default_branch() {
  local cache_dir="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  buddy_repo_json "$cache_dir" "$tmp_file"
  node -e 'const fs=require("node:fs"); const repo=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(repo.defaultBranch || "");' "$tmp_file"
  rm -f "$tmp_file"
}

buddy_issue_json() {
  local issue_ref="$1"
  local cache_dir="$2"
  local output_file="$3"
  local parsed_key
  parsed_key="${issue_ref##*/}"
  parsed_key="${parsed_key#\#}"
  if [[ ! "$parsed_key" =~ ^[0-9]+$ ]]; then
    parsed_key="$(buddy_ref_cache_key "$issue_ref")"
  fi

  local cache_file
  cache_file="$(buddy_cache_path issue "$parsed_key" "$cache_dir")"
  if buddy_cache_is_stale "$cache_file" "$buddy_issue_cache_ttl_seconds" issue "$parsed_key"; then
    local raw_file
    raw_file="$(mktemp)"
    buddy_metrics_event "$cache_dir" github rest managed_request "{\"surface\":\"issue\",\"key\":\"$parsed_key\"}"
    gh issue view "$issue_ref" --json id,number,title,url,state,body,labels,assignees,projectItems,updatedAt > "$raw_file"
    local number
    number="$(node -e 'const fs=require("node:fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(issue.number || ""));' "$raw_file")"
    if [[ -n "$number" && "$number" != "$parsed_key" ]]; then
      cache_file="$(buddy_cache_path issue "$number" "$cache_dir")"
    fi
    local updated_at
    updated_at="$(node -e 'const fs=require("node:fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.updatedAt || "");' "$raw_file")"
    buddy_cache_set_from_file "$cache_file" rest issue "${number:-$parsed_key}" "$raw_file" "$updated_at"
    rm -f "$raw_file"
  fi
  buddy_cache_data_to_file "$cache_file" "$output_file" issue "$parsed_key"
}

buddy_live_issue_json() {
  buddy_cache_refresh_call buddy_issue_json "$@"
}

buddy_pr_json() {
  local pr_ref="$1"
  local cache_dir="$2"
  local output_file="$3"
  local parsed_key
  parsed_key="${pr_ref##*/}"
  parsed_key="${parsed_key#\#}"
  if [[ ! "$parsed_key" =~ ^[0-9]+$ ]]; then
    parsed_key="$(buddy_ref_cache_key "$pr_ref")"
  fi

  local cache_file
  cache_file="$(buddy_cache_path pr "$parsed_key" "$cache_dir")"
  if buddy_cache_is_stale "$cache_file" "$buddy_pr_cache_ttl_seconds" pr "$parsed_key"; then
    local raw_file
    raw_file="$(mktemp)"
    buddy_metrics_event "$cache_dir" github rest managed_request "{\"surface\":\"pr\",\"key\":\"$parsed_key\"}"
    gh pr view "$pr_ref" --json id,number,url,body,baseRefName,labels,isDraft,assignees,projectItems,closingIssuesReferences,files,comments,headRefOid,updatedAt > "$raw_file"
    local number
    number="$(node -e 'const fs=require("node:fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(pr.number || ""));' "$raw_file")"
    if [[ -n "$number" && "$number" != "$parsed_key" ]]; then
      cache_file="$(buddy_cache_path pr "$number" "$cache_dir")"
    fi
    local updated_at
    updated_at="$(node -e 'const fs=require("node:fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(pr.updatedAt || "");' "$raw_file")"
    buddy_cache_set_from_file "$cache_file" rest pr "${number:-$parsed_key}" "$raw_file" "$updated_at"
    rm -f "$raw_file"
  fi
  buddy_cache_data_to_file "$cache_file" "$output_file" pr "$parsed_key"
}

buddy_live_pr_json() {
  buddy_cache_refresh_call buddy_pr_json "$@"
}

buddy_subject_json() {
  local ref="$1"
  local cache_dir="$2"
  local output_file="$3"
  if [[ "$ref" == http://*"/pull/"* || "$ref" == https://*"/pull/"* ]]; then
    buddy_pr_json "$ref" "$cache_dir" "$output_file"
  else
    buddy_issue_json "$ref" "$cache_dir" "$output_file"
  fi
}

buddy_live_subject_json() {
  local ref="$1"
  shift
  if [[ "$ref" == http://*"/pull/"* || "$ref" == https://*"/pull/"* ]]; then
    buddy_live_pr_json "$ref" "$@"
  else
    buddy_live_issue_json "$ref" "$@"
  fi
}

buddy_project_metadata_json() {
  local cache_dir="$1"
  local output_file="$2"
  local cache_file
  local project_cache_key
  project_cache_key="$(buddy_project_cache_key)"
  cache_file="$(buddy_cache_path project project "$cache_dir")"

  if buddy_cache_is_stale "$cache_file" "$buddy_project_cache_ttl_seconds" project "$project_cache_key"; then
    local project_owner="$OPENSPEC_BUDDY_PROJECT_OWNER"
    local project_number="$OPENSPEC_BUDDY_PROJECT_NUMBER"
    local project_file fields_file normalized_file
    project_file="$(mktemp)"
    fields_file="$(mktemp)"
    normalized_file="$(mktemp)"

    buddy_metrics_event "$cache_dir" github rest managed_request '{"surface":"project-metadata"}'
    gh project view "$project_number" \
      --owner "$project_owner" \
      --format json > "$project_file"

    gh project field-list "$project_number" \
      --owner "$project_owner" \
      --format json \
      --limit 100 > "$fields_file"

    node -e '
const fs = require("node:fs");
const [projectFile, fieldsFile, projectNumber, projectOwner] = process.argv.slice(1);
const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
const fields = JSON.parse(fs.readFileSync(fieldsFile, "utf8")).fields || [];
const result = {
  id: project.id || "",
  number: Number(projectNumber),
  owner: projectOwner,
  title: project.title || "",
  statusField: null,
  dateFields: {},
};
for (const field of fields) {
  if (field.name === process.env.OPENSPEC_BUDDY_PROJECT_STATUS_FIELD) {
    result.statusField = {
      id: field.id || "",
      name: field.name || "",
      options: Array.isArray(field.options) ? field.options.map((option) => ({ id: option.id || "", name: option.name || "" })) : [],
    };
    continue;
  }
  if (field.type === "ProjectV2Field" && (field.name === process.env.OPENSPEC_BUDDY_PROJECT_START_FIELD || field.name === process.env.OPENSPEC_BUDDY_PROJECT_END_FIELD)) {
    result.dateFields[field.name] = { id: field.id || "", name: field.name || "" };
  }
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
' "$project_file" "$fields_file" "$project_number" "$project_owner" > "$normalized_file"

    buddy_cache_set_from_file "$cache_file" gh-project project "$project_cache_key" "$normalized_file"
    rm -f "$project_file" "$fields_file" "$normalized_file"
  fi

  buddy_cache_data_to_file "$cache_file" "$output_file" project "$project_cache_key"
}

buddy_live_project_metadata_json() {
  buddy_cache_refresh_call buddy_project_metadata_json "$@"
}

buddy_project_item_id_from_subject_file() {
  local subject_file="$1"
  local project_title="$2"
  local project_id="${3:-}"
  node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const title = process.argv[2];
const projectId = process.argv[3] || "";
const items = Array.isArray(data.projectItems) ? data.projectItems : [];
const titleMatches = items.filter((item) => {
  const value = item?.title || item?.project?.title || item?.projectTitle || "";
  return value === title;
});
if (titleMatches.length === 0) {
  process.exit(0);
}
const exactMatches = projectId
  ? titleMatches.filter((item) => (item?.project?.id || item?.projectId || "") === projectId)
  : titleMatches;
let matches = titleMatches;
if (projectId) {
  if (exactMatches.length > 0) {
    matches = exactMatches;
  } else if (titleMatches.length === 1) {
    const onlyMatch = titleMatches[0];
    const matchProjectId = onlyMatch?.project?.id || onlyMatch?.projectId || "";
    matches = matchProjectId ? [] : [onlyMatch];
  } else {
    matches = [];
  }
}
if (matches.length !== 1) {
  process.exit(0);
}
const match = matches[0];
process.stdout.write(match?.id || match?.itemId || match?.projectItem?.id || match?.nodeId || "");
' "$subject_file" "$project_title" "$project_id"
}

buddy_project_item_present_in_subject_file() {
  local subject_file="$1"
  local project_title="$2"
  node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const title = process.argv[2];
const items = Array.isArray(data.projectItems) ? data.projectItems : [];
const match = items.some((item) => (item?.title || item?.project?.title || item?.projectTitle || "") === title);
process.stdout.write(match ? "1" : "0");
' "$subject_file" "$project_title"
}

buddy_project_item_id_for_subject_file() {
  local subject_file="$1"
  local project_title="$2"
  local project_id="${3:-}"
  local item_id
  item_id="$(buddy_project_item_id_from_subject_file "$subject_file" "$project_title" "$project_id")"
  if [[ -n "$item_id" ]]; then
    printf '%s\n' "$item_id"
    return 0
  fi

  local item_present subject_id
  item_present="$(buddy_project_item_present_in_subject_file "$subject_file" "$project_title")"
  if [[ "$item_present" != "1" ]]; then
    return 0
  fi
  subject_id="$(node -e 'const fs=require("node:fs"); const subject=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(subject.id || "");' "$subject_file")"
  if [[ -z "$subject_id" ]]; then
    return 0
  fi

  buddy_graphql_api \
    -f id="$subject_id" \
    -f query='
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      projectItems(first: 50) { nodes { id project { id title } } }
    }
    ... on PullRequest {
      projectItems(first: 50) { nodes { id project { id title } } }
    }
  }
}' | node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const title = process.argv[1];
const projectId = process.argv[2] || "";
const items = data.data?.node?.projectItems?.nodes || [];
const titleMatches = items.filter((item) => item?.project?.title === title);
const exactMatches = projectId ? titleMatches.filter((item) => item?.project?.id === projectId) : titleMatches;
const matches = projectId ? exactMatches : titleMatches;
if (matches.length === 1 && matches[0]?.id) process.stdout.write(matches[0].id);
' "$project_title" "$project_id"
}

buddy_open_issues_rest() {
  local limit="${1:-100}"
  if [[ "$limit" != "all" && ! "$limit" =~ ^[0-9]+$ ]]; then
    echo "Issue scan limit must be a non-negative integer or all." >&2
    return 2
  fi
  local repo
  repo="$(buddy_repo_nwo)"
  buddy_metrics_event "$(buddy_cache_dir)" github rest managed_request '{"surface":"open-issues"}'
  unset OPENSPEC_BUDDY_OPEN_ISSUES_NEEDS_BODY
  if [[ "$limit" == "all" ]]; then
    gh api --paginate --slurp "repos/$repo/issues?state=open&per_page=100" | node -e '
const fs = require("node:fs");
const pages = JSON.parse(fs.readFileSync(0, "utf8"));
const issues = (Array.isArray(pages) ? pages.flat() : [])
  .filter((issue) => !issue.pull_request)
  .map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url || issue.url || "",
    state: issue.state,
    labels: issue.labels || [],
    assignees: issue.assignees || [],
    body: issue.body || "",
  }));
process.stdout.write(`${JSON.stringify(issues)}\n`);
'
    return 0
  fi

  if (( limit == 0 )); then
    printf '[]\n'
    return 0
  fi

  local page_size=100
  if (( limit < page_size )); then
    page_size="$limit"
  fi
  local pages_dir
  pages_dir="$(mktemp -d)"
  local page=1
  while :; do
    local page_file="$pages_dir/$page.json"
    gh api "repos/$repo/issues?state=open&per_page=$page_size&page=$page" > "$page_file"
    local raw_count
    raw_count="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(Array.isArray(data) ? data.length : 0));' "$page_file")"
    local issue_count
    issue_count="$(node -e '
const fs = require("node:fs");
const dir = process.argv[1];
const files = fs.readdirSync(dir).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
const issues = files.flatMap((file) => JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8")))
  .filter((issue) => !issue.pull_request);
process.stdout.write(String(issues.length));
' "$pages_dir")"
    if (( issue_count >= limit || raw_count < page_size )); then
      break
    fi
    page=$((page + 1))
  done

  node -e '
const fs = require("node:fs");
const dir = process.argv[1];
const limit = Number(process.argv[2]);
const files = fs.readdirSync(dir).sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
const issues = files.flatMap((file) => JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8")))
  .filter((issue) => !issue.pull_request)
  .map((issue) => ({
    number: issue.number,
    title: issue.title,
    url: issue.html_url || issue.url || "",
    state: issue.state,
    labels: issue.labels || [],
    assignees: issue.assignees || [],
    body: issue.body || "",
  }));
process.stdout.write(`${JSON.stringify(issues.slice(0, limit))}\n`);
' "$pages_dir" "$limit"
  rm -rf "$pages_dir"
}

buddy_issue_body_rest() {
  local issue_number="$1"
  gh issue view "$issue_number" --json body --jq '.body'
}

buddy_graphql_guard() {
  local threshold="${OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING:-300}"
  if ! [[ "$threshold" =~ ^[0-9]+$ ]]; then
    echo "OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING must be a non-negative integer." >&2
    return 2
  fi

  local budget_file
  budget_file="$(mktemp)"
  gh api rate_limit --jq '.resources.graphql' > "$budget_file"

  set +e
  node -e '
const fs = require("node:fs");
const [file, threshold] = process.argv.slice(1);
const graphql = JSON.parse(fs.readFileSync(file, "utf8"));
const remaining = Number(graphql.remaining ?? -1);
const minRemaining = Number(threshold);
if (!Number.isFinite(remaining) || remaining < minRemaining) {
  const resetAt = graphql.resetAt || graphql.reset || "unknown";
  process.stderr.write(`GraphQL remaining quota ${remaining} is below threshold ${minRemaining}. Reset at ${resetAt}.\n`);
  process.exit(1);
}
' "$budget_file" "$threshold"
  local status="$?"
  set -e
  rm -f "$budget_file"
  return "$status"
}

buddy_graphql_guard_for_calls() {
  local call_count="${1:-1}"
  local threshold="${OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING:-300}"
  if ! [[ "$call_count" =~ ^[0-9]+$ && "$call_count" -ge 1 ]]; then
    echo "GraphQL call count must be a positive integer." >&2
    return 2
  fi
  if ! [[ "$threshold" =~ ^[0-9]+$ ]]; then
    echo "OPENSPEC_BUDDY_GRAPHQL_MIN_REMAINING must be a non-negative integer." >&2
    return 2
  fi

  local required_remaining=$((threshold + call_count - 1))
  local budget_file
  budget_file="$(mktemp)"
  gh api rate_limit --jq '.resources.graphql' > "$budget_file"
  set +e
  node -e '
const fs = require("node:fs");
const [file, required] = process.argv.slice(1);
const graphql = JSON.parse(fs.readFileSync(file, "utf8"));
const remaining = Number(graphql.remaining ?? -1);
const minimum = Number(required);
if (!Number.isFinite(remaining) || remaining < minimum) {
  const resetAt = graphql.resetAt || graphql.reset || "unknown";
  process.stderr.write(`GraphQL remaining quota ${remaining} is below required minimum ${minimum}. Reset at ${resetAt}.\n`);
  process.exit(1);
}
' "$budget_file" "$required_remaining"
  local status="$?"
  set -e
  rm -f "$budget_file"
  return "$status"
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

buddy_graphql_api() {
  if ! buddy_graphql_guard; then
    return 1
  fi
  buddy_metrics_event "$(buddy_cache_dir)" github graphql managed_request '{"surface":"graphql"}'
  gh api graphql "$@"
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
        updatedAt
        labels(first: 40) { nodes { name } }
        parent { number title url state updatedAt labels(first: 40) { nodes { name } } }
        subIssues(first: 100) { nodes { number title url state updatedAt labels(first: 40) { nodes { name } } } }
        blockedBy(first: 40) { nodes { number title url state updatedAt labels(first: 40) { nodes { name } } } }
        blocking(first: 40) { nodes { number title url state updatedAt labels(first: 40) { nodes { name } } } }
'
  local query='query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {'
  local index
  for index in "${!numbers[@]}"; do
    query+=" issue${index}: issue(number: ${numbers[$index]}) { ${issue_fields} }"
  done
  query+=' } }'

  buddy_graphql_api \
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

  local cache_dir
  cache_dir="$(buddy_cache_dir)"
  local tmp_dir=""
  local pending_numbers=()
  local number cache_file
  for number in "${numbers[@]}"; do
    cache_file="$(buddy_cache_path relationship "issue-$number" "$cache_dir")"
    if buddy_cache_is_stale "$cache_file" "$buddy_relationship_cache_ttl_seconds" relationship "issue-$number"; then
      pending_numbers+=("$number")
    fi
  done

  if [[ "${#pending_numbers[@]}" -gt 0 ]]; then
    local pending_call_count=$(( (${#pending_numbers[@]} + buddy_graphql_batch_size - 1) / buddy_graphql_batch_size ))
    buddy_graphql_guard_for_calls "$pending_call_count"
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' RETURN
    local files=()
    local start=0
    local batch_index=0
    local chunk=()
    local output_file stderr_file

    while [[ "$start" -lt "${#pending_numbers[@]}" ]]; do
      chunk=("${pending_numbers[@]:$start:$buddy_graphql_batch_size}")
      output_file="$tmp_dir/batch-${batch_index}.json"
      stderr_file="$tmp_dir/batch-${batch_index}.err"
      buddy_issue_relationships_fetch_batch "$owner" "$repo" "$output_file" "$stderr_file" "${chunk[@]}"
      files+=("$output_file")
      start=$((start + buddy_graphql_batch_size))
      batch_index=$((batch_index + 1))
    done

    local combined_file
    combined_file="$tmp_dir/combined.json"
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
' "${files[@]}" > "$combined_file"

    local missing_numbers_file
    missing_numbers_file="$tmp_dir/missing-numbers.txt"
    node -e '
const fs = require("node:fs");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const present = new Set(
  (Array.isArray(issues) ? issues : [])
    .map((issue) => Number(issue?.number || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
);
for (const raw of process.argv.slice(2)) {
  const number = Number(raw);
  if (Number.isFinite(number) && number > 0 && !present.has(number)) {
    process.stdout.write(`${number}\n`);
  }
}
' "$combined_file" "${pending_numbers[@]}" > "$missing_numbers_file"
    local missing_numbers=()
    if [[ -s "$missing_numbers_file" ]]; then
      mapfile -t missing_numbers < "$missing_numbers_file"
      if [[ "${#missing_numbers[@]}" -gt 0 ]]; then
        buddy_invalidate_issue_relationship_cache "$cache_dir" "${missing_numbers[@]}"
        buddy_invalidate_issue_cache "$cache_dir" "${missing_numbers[@]}"
      fi
    fi

    local repo_nwo
    repo_nwo="$(buddy_cache_expected_repo)"

    node -e '
const fs = require("node:fs");
const path = require("node:path");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const issueTemplate = process.argv[2];
const relationshipTemplate = process.argv[3];
const repo = process.argv[4];
const issuePayloads = new Map();

function writeJsonFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempFile, file);
}

function mergeData(baseValue, patchValue) {
  if (Array.isArray(baseValue) && Array.isArray(patchValue)) return patchValue;
  if (
    baseValue &&
    typeof baseValue === "object" &&
    !Array.isArray(baseValue) &&
    patchValue &&
    typeof patchValue === "object" &&
    !Array.isArray(patchValue)
  ) {
    const merged = { ...baseValue };
    for (const [key, value] of Object.entries(patchValue)) {
      merged[key] = key in baseValue ? mergeData(baseValue[key], value) : value;
    }
    return merged;
  }
  return patchValue;
}

function setIssueNode(node) {
  if (!node || !node.number) return;
  const current = issuePayloads.get(node.number) || { number: node.number };
  issuePayloads.set(node.number, {
    ...current,
    ...Object.fromEntries(
      Object.entries({
        id: node.id,
        number: node.number,
        title: node.title,
        url: node.url,
        state: node.state,
        body: node.body,
        updatedAt: node.updatedAt,
        labels: node.labels,
      }).filter(([, value]) => value !== undefined)
    ),
  });
}

function nodeNumbers(list) {
  return (Array.isArray(list) ? list : [])
    .map((node) => Number(node?.number || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
}

for (const issue of issues) {
  if (!issue?.number) continue;
  setIssueNode(issue);
  setIssueNode(issue.parent);
  for (const field of ["subIssues", "blockedBy", "blocking"]) {
    for (const node of issue[field]?.nodes || []) {
      setIssueNode(node);
    }
  }

  const relationship = {
    number: issue.number,
    updatedAt: issue.updatedAt || "",
    parentNumber: issue.parent?.number || null,
    subIssueNumbers: nodeNumbers(issue.subIssues?.nodes),
    blockedByNumbers: nodeNumbers(issue.blockedBy?.nodes),
    blockingNumbers: nodeNumbers(issue.blocking?.nodes),
  };
  const relationshipFile = relationshipTemplate.replace("__NUMBER__", String(issue.number));
  writeJsonFileAtomic(relationshipFile, {
    fetchedAt: new Date().toISOString(),
    source: "graphql",
    repo,
    objectType: "relationship",
    key: `issue-${issue.number}`,
    ...(relationship.updatedAt ? { updatedAt: relationship.updatedAt } : {}),
    data: relationship,
  });
}

for (const [number, payload] of issuePayloads.entries()) {
  const issueFile = issueTemplate.replace("__NUMBER__", String(number));
  let existing = {};
  if (fs.existsSync(issueFile)) {
    existing = JSON.parse(fs.readFileSync(issueFile, "utf8")).data || {};
  }
  const merged = mergeData(existing, payload);
  writeJsonFileAtomic(issueFile, {
    fetchedAt: new Date().toISOString(),
    source: "graphql",
    repo,
    objectType: "issue",
    key: String(number),
    ...(merged.updatedAt || payload.updatedAt ? { updatedAt: merged.updatedAt || payload.updatedAt } : {}),
    data: merged,
  });
}
' "$combined_file" "$(buddy_cache_path issue '__NUMBER__' "$cache_dir")" "$(buddy_cache_path relationship 'issue-__NUMBER__' "$cache_dir")" "$repo_nwo"
  fi

  local relationship_files=()
  for number in "${numbers[@]}"; do
    local relationship_file
    relationship_file="$(buddy_cache_path relationship "issue-$number" "$cache_dir")"
    if [[ -f "$relationship_file" ]]; then
      relationship_files+=("$relationship_file")
    fi
  done
  local hydrate_issue_numbers=()
  if [[ "${#relationship_files[@]}" -gt 0 ]]; then
    while IFS= read -r number; do
      [[ -n "$number" ]] || continue
      hydrate_issue_numbers+=("$number")
    done < <(buddy_relationship_neighbor_numbers "${relationship_files[@]}")
  fi
  if [[ "${#hydrate_issue_numbers[@]}" -gt 0 ]]; then
    local hydrate_tmp_dir=""
    hydrate_tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir" "$hydrate_tmp_dir"' RETURN
    for number in "${hydrate_issue_numbers[@]}"; do
      buddy_issue_json "$number" "$cache_dir" "$hydrate_tmp_dir/$number.json" >/dev/null
    done
  fi
  if [[ "${#relationship_files[@]}" -eq 0 ]]; then
    printf '[]\n'
    return 0
  fi
  node -e '
const fs = require("node:fs");
const relationshipFiles = process.argv.slice(1);
const issueCache = new Map();

function loadEntry(file) {
  return JSON.parse(fs.readFileSync(file, "utf8")).data || {};
}

function issuePath(number) {
  return fileTemplate.replace("__NUMBER__", String(number));
}

function loadIssue(number) {
  if (!number) return null;
  if (issueCache.has(number)) return issueCache.get(number);
  const file = issuePath(number);
  if (!fs.existsSync(file)) {
    const minimal = { number };
    issueCache.set(number, minimal);
    return minimal;
  }
  const issue = loadEntry(file);
  issueCache.set(number, issue);
  return issue;
}

function wrapNodes(numbers) {
  return { nodes: numbers.map((number) => loadIssue(number)).filter(Boolean) };
}

const fileTemplate = process.argv[process.argv.length - 1];
const files = relationshipFiles.slice(0, -1);
const issues = files.map((file) => {
  const relationship = loadEntry(file);
  const self = loadIssue(relationship.number) || { number: relationship.number };
  return {
    ...self,
    parent: relationship.parentNumber ? loadIssue(relationship.parentNumber) : null,
    subIssues: wrapNodes(relationship.subIssueNumbers || []),
    blockedBy: wrapNodes(relationship.blockedByNumbers || []),
    blocking: wrapNodes(relationship.blockingNumbers || []),
  };
});
process.stdout.write(`${JSON.stringify(issues, null, 2)}\n`);
' "${relationship_files[@]}" "$(buddy_cache_path issue '__NUMBER__' "$cache_dir")"
}

buddy_open_ready_scan_cache_file() {
  local cache_dir="$1"
  local limit="$2"
  buddy_cache_path relationship "ready-scan-limit-$limit" "$cache_dir"
}

buddy_gh_api_paginated_array() {
  local endpoint="$1"
  buddy_metrics_event "$(buddy_cache_dir)" github rest managed_request '{"surface":"paginated-rest"}'
  gh api --paginate --slurp "$endpoint" | node -e '
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const pages = Array.isArray(input) ? input : [];
const flattened = pages.flatMap((page) => Array.isArray(page) ? page : []);
process.stdout.write(`${JSON.stringify(flattened)}\n`);
'
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

  buddy_metrics_event "$cache_dir" github rest managed_request "{\"surface\":\"pr-rest-bundle\",\"key\":\"$pr_number\"}"
  [[ -f "$BUDDY_PR_REST_FILE" && "${OPENSPEC_BUDDY_CACHE_REFRESH:-}" != "1" ]] || gh api "repos/$repo_nwo/pulls/$pr_number" > "$BUDDY_PR_REST_FILE"
  [[ -f "$BUDDY_REVIEWS_FILE" && "${OPENSPEC_BUDDY_CACHE_REFRESH:-}" != "1" ]] || buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/reviews?per_page=100" > "$BUDDY_REVIEWS_FILE"
  [[ -f "$BUDDY_COMMITS_FILE" && "${OPENSPEC_BUDDY_CACHE_REFRESH:-}" != "1" ]] || buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/commits?per_page=100" > "$BUDDY_COMMITS_FILE"
  [[ -f "$BUDDY_ISSUE_COMMENTS_FILE" && "${OPENSPEC_BUDDY_CACHE_REFRESH:-}" != "1" ]] || buddy_gh_api_paginated_array "repos/$repo_nwo/issues/$pr_number/comments?per_page=100" > "$BUDDY_ISSUE_COMMENTS_FILE"
  [[ -f "$BUDDY_REVIEW_COMMENTS_FILE" && "${OPENSPEC_BUDDY_CACHE_REFRESH:-}" != "1" ]] || buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/comments?per_page=100" > "$BUDDY_REVIEW_COMMENTS_FILE"
}

buddy_pr_signature_rest() {
  local repo_nwo="$1"
  local pr_number="$2"
  local cache_dir="$3"
  mkdir -p "$cache_dir"
  export BUDDY_PR_SIGNATURE_FILE="$cache_dir/pr-signature-${pr_number}.json"
  local pr_file="$cache_dir/pr-signature-pr-${pr_number}.json"
  local reviews_file="$cache_dir/pr-signature-reviews-${pr_number}.json"

  gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"
  buddy_gh_api_paginated_array "repos/$repo_nwo/pulls/$pr_number/reviews?per_page=100" > "$reviews_file"
  node -e '
const fs = require("node:fs");
const pr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
let reviews = [];
try {
  const parsed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  reviews = Array.isArray(parsed) ? parsed : [];
} catch {}
const latestReviewSubmittedAt = reviews
  .map((review) => review.submitted_at || review.submittedAt || "")
  .filter(Boolean)
  .sort()
  .at(-1) || "";
const signature = {
  number: pr.number,
  state: pr.state || "",
  merged: Boolean(pr.merged || pr.merged_at),
  head: pr.head?.sha || "",
  headRefName: pr.head?.ref || "",
  updatedAt: pr.updated_at || "",
  comments: pr.comments ?? 0,
  reviewComments: pr.review_comments ?? 0,
  commits: pr.commits ?? 0,
  reviews: reviews.length,
  latestReviewSubmittedAt,
};
process.stdout.write(`${JSON.stringify(signature)}\n`);
' "$pr_file" "$reviews_file" > "$BUDDY_PR_SIGNATURE_FILE"
  printf '%s\n' "$BUDDY_PR_SIGNATURE_FILE"
}

buddy_issue_status_rest() {
  local repo_nwo="$1"
  local issue_number="$2"
  local cache_dir="$3"
  mkdir -p "$cache_dir"
  export BUDDY_ISSUE_STATUS_FILE="$cache_dir/issue-status-${issue_number}.json"

  buddy_metrics_event "$cache_dir" github rest managed_request "{\"surface\":\"issue-status\",\"key\":\"$issue_number\"}"
  gh api "repos/$repo_nwo/issues/$issue_number" | node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(0, "utf8"));
const labels = (issue.labels || []).map((label) => label.name || label).filter(Boolean);
const status = {
  number: issue.number,
  state: String(issue.state || "").toUpperCase(),
  labels,
  updatedAt: issue.updated_at || "",
};
process.stdout.write(`${JSON.stringify(status)}\n`);
' > "$BUDDY_ISSUE_STATUS_FILE"
  printf '%s\n' "$BUDDY_ISSUE_STATUS_FILE"
}

buddy_review_threads_graphql() {
  local owner="$1"
  local repo="$2"
  local pr_number="$3"
  local cache_dir="$4"
  mkdir -p "$cache_dir"
  export BUDDY_REVIEW_THREADS_FILE="$cache_dir/review-threads-${pr_number}.json"

  if ! buddy_graphql_api \
    -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        pageInfo {
          hasNextPage
        }
        nodes {
          id
          isResolved
          path
          line
          startLine
          originalLine
          comments(first: 50) {
            pageInfo {
              hasNextPage
            }
            nodes {
              author { login }
              body
              url
              createdAt
            }
          }
        }
      }
    }
  }
}' \
    -f owner="$owner" \
    -f repo="$repo" \
    -F number="$pr_number" > "$BUDDY_REVIEW_THREADS_FILE"; then
    return 1
  fi

  printf '%s\n' "$BUDDY_REVIEW_THREADS_FILE"
}

buddy_review_threads_status_graphql() {
  local owner="$1"
  local repo="$2"
  local pr_number="$3"
  local cache_dir="$4"
  mkdir -p "$cache_dir"
  export BUDDY_REVIEW_THREADS_STATUS_FILE="$cache_dir/review-threads-status-${pr_number}.json"

  if ! buddy_graphql_api \
    -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
        }
      }
    }
  }
}' \
    -f owner="$owner" \
    -f repo="$repo" \
    -F number="$pr_number" > "$BUDDY_REVIEW_THREADS_STATUS_FILE"; then
    return 1
  fi

  printf '%s\n' "$BUDDY_REVIEW_THREADS_STATUS_FILE"
}
