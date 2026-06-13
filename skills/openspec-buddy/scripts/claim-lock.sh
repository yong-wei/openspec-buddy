#!/usr/bin/env bash

buddy_claim_issue_rest() {
  local repo_nwo="$1"
  local issue_number="$2"
  local output_file="$3"
  gh api "repos/$repo_nwo/issues/$issue_number" > "$output_file"
}

buddy_claim_comments_rest() {
  local repo_nwo="$1"
  local issue_number="$2"
  local output_file="$3"
  local paged_file="$output_file.pages"
  gh api --paginate --slurp "repos/$repo_nwo/issues/$issue_number/comments?per_page=100" > "$paged_file"
  node -e '
const fs = require("node:fs");
const pages = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(JSON.stringify(pages.flat()));
' "$paged_file" > "$output_file"
}

buddy_claim_open_prs_rest() {
  local repo_nwo="$1"
  local claim_branch="$2"
  local output_file="$3"
  local owner="${repo_nwo%%/*}"
  gh api "repos/$repo_nwo/pulls?head=$owner:$claim_branch&state=open&per_page=1" > "$output_file"
}

buddy_claim_development_link_exists() {
  local issue_number="$1"
  local claim_branch="$2"
  local linked_branches
  linked_branches="$(gh issue develop --list "$issue_number" 2>/dev/null || true)"
  [[ "$linked_branches" == *"$claim_branch"* ]]
}

buddy_claim_active_comment_to_file() {
  local comments_file="$1"
  local output_file="$2"
  node -e '
const fs = require("node:fs");
const comments = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
function claimFields(body) {
  const fields = {};
  for (const line of String(body || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}
const active = new Map();
const ordered = [...(Array.isArray(comments) ? comments : [])]
  .filter((comment) => /OpenSpec Buddy Claim/.test(comment?.body || ""))
  .sort((left, right) => String(left.created_at || left.createdAt || "").localeCompare(String(right.created_at || right.createdAt || "")));
for (const comment of ordered) {
  const fields = claimFields(comment.body);
  if (!fields.claim_id) continue;
  const state = String(fields.state || "active").toLowerCase();
  if (/OpenSpec Buddy Claim Release/.test(comment.body || "") || ["released", "abandoned", "lost"].includes(state)) {
    active.delete(fields.claim_id);
    continue;
  }
  active.set(fields.claim_id, { ...fields, created_at: comment.created_at || comment.createdAt || "" });
}
const latest = [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1) || null;
process.stdout.write(JSON.stringify(latest));
' "$comments_file" > "$output_file"
}

buddy_claim_branch_head_sha() {
  local claim_branch="$1"
  git ls-remote --heads origin "$claim_branch" | awk '{print $1}'
}

buddy_claim_branch_exists() {
  local claim_branch="$1"
  git ls-remote --exit-code --heads origin "$claim_branch" >/dev/null 2>&1
}

buddy_stale_claim_recoverable() {
  local issue_number="$1"
  local change_id="$2"
  local claim_branch="$3"
  local repo_nwo="$4"
  local tmp_dir="$5"
  mkdir -p "$tmp_dir"

  local issue_file="$tmp_dir/issue.json"
  local comments_file="$tmp_dir/comments.json"
  local active_file="$tmp_dir/active-claim.json"
  local prs_file="$tmp_dir/open-prs.json"

  buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
  buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"
  buddy_claim_active_comment_to_file "$comments_file" "$active_file"

  node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const active = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expectedChange = process.argv[3];
const expectedBranch = process.argv[4];
const now = process.env.OPENSPEC_BUDDY_NOW ? Date.parse(process.env.OPENSPEC_BUDDY_NOW) : Date.now();
function labelsOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list
    .map((label) => typeof label === "string" ? label : label?.name)
    .filter(Boolean)
    .map((name) => name.replace(/^status:\s+/, "status:"));
}
function assigneesOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list.map((assignee) => typeof assignee === "string" ? assignee : assignee?.login).filter(Boolean);
}
if (String(issue.state || "").toUpperCase() !== "OPEN") {
  process.stderr.write("Stale claim recovery rejected: issue is not open.\n");
  process.exit(30);
}
if (!labelsOf(issue.labels).includes("status:claimed")) {
  process.stderr.write("Stale claim recovery rejected: issue is not status:claimed.\n");
  process.exit(31);
}
if (!active || active.change_id !== expectedChange || active.branch !== expectedBranch || !active.lease_until || !active.base_sha) {
  process.stderr.write("Stale claim recovery rejected: active claim evidence is incomplete or mismatched.\n");
  process.exit(32);
}
if (!(Date.parse(active.lease_until) < now)) {
  process.stderr.write("Stale claim recovery rejected: lease has not expired.\n");
  process.exit(33);
}
const activeAgent = String(active.agent || "").replace(/^@/, "");
const otherAssignees = assigneesOf(issue.assignees).filter((login) => login && login !== activeAgent);
if (otherAssignees.length > 0) {
  process.stderr.write(`Stale claim recovery rejected: issue has newer assignee(s): ${otherAssignees.join(", ")}\n`);
  process.exit(34);
}
' "$issue_file" "$active_file" "$change_id" "$claim_branch" || return $?

  buddy_claim_open_prs_rest "$repo_nwo" "$claim_branch" "$prs_file"
  if node -e 'const fs=require("node:fs"); const prs=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(Array.isArray(prs) && prs.length > 0 ? 0 : 1);' "$prs_file"; then
    printf 'Stale claim recovery rejected: open PR already exists for branch %s.\n' "$claim_branch" >&2
    return 1
  fi

  local branch_sha
  branch_sha="$(buddy_claim_branch_head_sha "$claim_branch")"
  if [[ -n "$branch_sha" ]]; then
    local base_sha
    base_sha="$(node -e 'const fs=require("node:fs"); const active=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(active?.base_sha || "");' "$active_file")"
    if [[ "$branch_sha" != "$base_sha" ]]; then
      printf 'Stale claim recovery rejected: branch %s has commits beyond recorded base_sha.\n' "$claim_branch" >&2
      return 1
    fi
  fi
}

buddy_claim_check_issue_snapshot() {
  local issue_file="$1"
  local comments_file="$2"
  local viewer="$3"
  local mode="$4"

  node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const comments = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const viewer = process.argv[3];
const mode = process.argv[4];
const activeStatuses = new Set([
  "status:claimed",
  "status:in-progress",
  "status:in-review",
  "status:blocked",
  "status:needs-human",
  "status:failed",
  "status:archived",
  "status:merged",
  "status:tracking",
  "status:stale-claim",
]);
const claimableStatuses = new Set(["", "status:backlog", "status:ready"]);
function labelsOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list
    .map((label) => typeof label === "string" ? label : label?.name)
    .filter(Boolean)
    .map((name) => name.replace(/^(status|type|area|series|risk|mode):\s+/, "$1:"));
}
function assigneesOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list.map((assignee) => typeof assignee === "string" ? assignee : assignee?.login).filter(Boolean);
}
function claimFields(body) {
  const fields = {};
  for (const line of String(body || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}
function latestActiveClaim(comments) {
  const active = new Map();
  const ordered = [...(Array.isArray(comments) ? comments : [])]
    .filter((comment) => /OpenSpec Buddy Claim/.test(comment?.body || ""))
    .sort((left, right) => String(left.created_at || left.createdAt || "").localeCompare(String(right.created_at || right.createdAt || "")));
  for (const comment of ordered) {
    const fields = claimFields(comment.body);
    if (!fields.claim_id) continue;
    const state = String(fields.state || "active").toLowerCase();
    if (/OpenSpec Buddy Claim Release/.test(comment.body || "") || ["released", "abandoned", "lost"].includes(state)) {
      active.delete(fields.claim_id);
      continue;
    }
    active.set(fields.claim_id, { ...fields, created_at: comment.created_at || comment.createdAt || "" });
  }
  return [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1);
}
const labels = labelsOf(issue.labels);
const status = labels.find((label) => label.startsWith("status:")) || "";
const state = String(issue.state || "").toUpperCase();
if (state !== "OPEN") {
  process.stderr.write(`Issue is not open: ${issue.state || "unknown"}\n`);
  process.exit(10);
}
if (mode === "preflight") {
  if (labels.includes("type:series-parent") || status === "status:tracking") {
    process.stderr.write("Issue is a series parent and cannot be claimed.\n");
    process.exit(11);
  }
  if (status === "status:claimed") {
    process.stderr.write("Issue is already status:claimed; skipped until stale-claim fallback.\n");
    process.exit(12);
  }
  if (activeStatuses.has(status)) {
    process.stderr.write(`Issue has non-claimable active status: ${status}\n`);
    process.exit(13);
  }
  if (!claimableStatuses.has(status)) {
    process.stderr.write(`Issue status is not claimable: ${status}\n`);
    process.exit(14);
  }
  const assignees = assigneesOf(issue.assignees);
  const otherAssignees = assignees.filter((login) => login !== viewer);
  if (otherAssignees.length > 0) {
    process.stderr.write(`Issue is already assigned to another user: ${otherAssignees.join(", ")}\n`);
    process.exit(15);
  }
  if (latestActiveClaim(comments)) {
    process.stderr.write("Issue already has an active claim comment; treat as partial claim or stale-claim recovery.\n");
    process.exit(16);
  }
}
' "$issue_file" "$comments_file" "$viewer" "$mode"
}

buddy_preflight_claim_truth_check() {
  local issue_number="$1"
  local change_id="$2"
  local claim_branch="$3"
  local viewer="$4"
  local repo_nwo="$5"
  local tmp_dir="$6"
  mkdir -p "$tmp_dir"

  local issue_file="$tmp_dir/issue.json"
  local comments_file="$tmp_dir/comments.json"
  local prs_file="$tmp_dir/open-prs.json"

  buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
  buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"
  buddy_claim_check_issue_snapshot "$issue_file" "$comments_file" "$viewer" preflight || return $?

  if git ls-remote --exit-code --heads origin "$claim_branch" >/dev/null 2>&1; then
    printf 'Issue #%s is status:ready but remote claim branch already exists for %s: %s\n' "$issue_number" "$change_id" "$claim_branch" >&2
    return 1
  fi

  buddy_claim_open_prs_rest "$repo_nwo" "$claim_branch" "$prs_file"
  if node -e 'const fs=require("node:fs"); const prs=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(Array.isArray(prs) && prs.length > 0 ? 0 : 1);' "$prs_file"; then
    printf 'Issue #%s is status:ready but an open PR already exists for branch %s.\n' "$issue_number" "$claim_branch" >&2
    return 1
  fi

  if buddy_claim_development_link_exists "$issue_number" "$claim_branch"; then
    printf 'Issue #%s is status:ready but already has a Development link for %s.\n' "$issue_number" "$claim_branch" >&2
    return 1
  fi
}

buddy_claim_status_labels_from_file() {
  local issue_file="$1"
  node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const labels = Array.isArray(issue.labels) ? issue.labels : issue.labels?.nodes || [];
process.stdout.write(labels
  .map((label) => typeof label === "string" ? label : label?.name)
  .filter((name) => /^status:\s*/.test(name || ""))
  .join(","));
' "$issue_file"
}

buddy_claim_set_status_label_direct() {
  local issue_number="$1"
  local issue_file="$2"
  local target_status="$3"
  local existing_statuses
  existing_statuses="$(buddy_claim_status_labels_from_file "$issue_file")"
  local args=(issue edit "$issue_number")
  if [[ -n "$existing_statuses" ]]; then
    args+=(--remove-label "$existing_statuses")
  fi
  args+=(--add-label "$target_status")
  gh "${args[@]}"
}

buddy_write_minimal_claim_lock() {
  local issue_number="$1"
  local change_id="$2"
  local claim_branch="$3"
  local base_branch="$4"
  local base_sha="$5"
  local viewer="$6"
  local claim_id="$7"
  local lease_until="$8"
  local issue_file="$9"
  local adopted_body_file="${10:-}"
  local adopted_from_open_issue="${11:-false}"

  if [[ -n "$adopted_body_file" ]]; then
    gh issue edit "$issue_number" --body-file "$adopted_body_file"
  fi
  gh issue edit "$issue_number" --add-assignee "$viewer"
  buddy_claim_set_status_label_direct "$issue_number" "$issue_file" "status:claimed"

  local adopted_line=""
  if [[ "$adopted_from_open_issue" == "true" ]]; then
    adopted_line="adopted_from_open_issue: true"
  fi

gh issue comment "$issue_number" --body "$(cat <<EOF
OpenSpec Buddy Claim

claim_id: $claim_id
state: active
agent: @$viewer
change_id: $change_id
branch: $claim_branch
base_branch: $base_branch
base_sha: $base_sha
lease_until: $lease_until
$adopted_line
EOF
)"
}

buddy_release_claim_lock() {
  local issue_number="$1"
  local change_id="$2"
  local claim_branch="$3"
  local viewer="$4"
  local claim_id="$5"
  local lease_until="$6"
  local reason="${7:-claim did not complete}"

  [[ -n "$claim_id" ]] || return 0

  gh issue comment "$issue_number" --body "$(cat <<EOF
OpenSpec Buddy Claim Release

claim_id: $claim_id
state: released
agent: @$viewer
change_id: $change_id
branch: $claim_branch
lease_until: $lease_until
reason: $reason
EOF
)"
}

buddy_verify_claim_lock_rest() {
  local issue_number="$1"
  local change_id="$2"
  local viewer="$3"
  local claim_id="$4"
  local lease_until="$5"
  local repo_nwo="$6"
  local tmp_dir="$7"
  mkdir -p "$tmp_dir"

  local issue_file="$tmp_dir/issue.json"
  local comments_file="$tmp_dir/comments.json"
  buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
  buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"

  node -e '
const fs = require("node:fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const comments = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const changeId = process.argv[3];
const viewer = process.argv[4];
const claimId = process.argv[5];
const leaseUntil = process.argv[6];
function labelsOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list
    .map((label) => typeof label === "string" ? label : label?.name)
    .filter(Boolean)
    .map((name) => name.replace(/^status:\s+/, "status:"));
}
function claimFields(body) {
  const fields = {};
  for (const line of String(body || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].trim();
  }
  return fields;
}
function latestActiveClaim(comments) {
  const active = new Map();
  const ordered = [...(Array.isArray(comments) ? comments : [])]
    .filter((comment) => /OpenSpec Buddy Claim/.test(comment?.body || ""))
    .sort((left, right) => String(left.created_at || left.createdAt || "").localeCompare(String(right.created_at || right.createdAt || "")));
  for (const comment of ordered) {
    const fields = claimFields(comment.body);
    if (!fields.claim_id) continue;
    const state = String(fields.state || "active").toLowerCase();
    if (/OpenSpec Buddy Claim Release/.test(comment.body || "") || ["released", "abandoned", "lost"].includes(state)) {
      active.delete(fields.claim_id);
      continue;
    }
    active.set(fields.claim_id, { ...fields, created_at: comment.created_at || comment.createdAt || "" });
  }
  return [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1);
}
const state = String(issue.state || "").toUpperCase();
const labels = labelsOf(issue.labels);
if (state !== "OPEN") {
  process.stderr.write(`Claim verification failed: issue is not open (${issue.state || "unknown"}).\n`);
  process.exit(20);
}
if (!labels.includes("status:claimed")) {
  process.stderr.write("Claim verification failed: issue is not status:claimed.\n");
  process.exit(21);
}
const latest = latestActiveClaim(comments);
if (!latest) {
  process.stderr.write("Claim verification failed: no active claim comment found.\n");
  process.exit(22);
}
const expectedAgent = `@${viewer}`;
if (latest.claim_id !== claimId || latest.agent !== expectedAgent || latest.change_id !== changeId || latest.lease_until !== leaseUntil) {
  process.stderr.write("Claim verification failed: latest active claim comment does not belong to this claim.\n");
  process.exit(23);
}
if ((latest.branch || "") && latest.branch !== process.argv[7]) {
  process.stderr.write("Claim verification failed: latest active claim branch does not match.\n");
  process.exit(23);
}
' "$issue_file" "$comments_file" "$change_id" "$viewer" "$claim_id" "$lease_until" "${8:-}" || return $?
}

buddy_delete_claim_branch_if_owned() {
  local issue_number="$1"
  local change_id="$2"
  local claim_branch="$3"
  local viewer="$4"
  local claim_id="$5"
  local lease_until="$6"
  local repo_nwo="$7"
  local tmp_dir="$8"

  if buddy_verify_claim_lock_rest "$issue_number" "$change_id" "$viewer" "$claim_id" "$lease_until" "$repo_nwo" "$tmp_dir/delete-branch-owner-check" >/dev/null 2>&1; then
    git push origin ":refs/heads/$claim_branch" >/dev/null 2>&1 || true
  fi
}
