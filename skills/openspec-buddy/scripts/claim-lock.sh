#!/usr/bin/env bash

claim_lock_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F buddy_worktree_identity_json >/dev/null 2>&1; then
  # shellcheck source=./worktree-identity.sh
  source "$claim_lock_script_dir/worktree-identity.sh"
fi
if ! declare -F buddy_cache_dir >/dev/null 2>&1; then
  # shellcheck source=./github-fetch.sh
  source "$claim_lock_script_dir/github-fetch.sh"
fi

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
  active.set(fields.claim_id, {
    ...fields,
    created_at: comment.created_at || comment.createdAt || "",
    comment_user_login: comment.user?.login || comment.author?.login || "",
  });
}
const latest = [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1) || null;
process.stdout.write(JSON.stringify(latest));
' "$comments_file" > "$output_file"
}

buddy_verify_active_claim_resume() {
  local issue_number="$1" change_id="$2" claim_branch="$3" base_branch="$4"
  local viewer="$5" repo_nwo="$6" tmp_dir="$7" expected_updated_at="${8:-}"
  mkdir -p "$tmp_dir"
  local issue_file="$tmp_dir/issue.json" comments_file="$tmp_dir/comments.json"
  local active_file="$tmp_dir/active.json" identity_file="$tmp_dir/identity.json" current_base_sha
  buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
  buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"
  buddy_claim_active_comment_to_file "$comments_file" "$active_file"
  buddy_worktree_identity_json "$(buddy_cache_dir)" > "$identity_file"
  git fetch origin "$base_branch" >/dev/null
  current_base_sha="$(git rev-parse "origin/$base_branch")"
  node -e '
const fs = require("node:fs");
const [issueFile, activeFile, identityFile, changeId, branch, viewer, baseSha, expectedUpdatedAt, baseBranch] = process.argv.slice(1);
const issue = JSON.parse(fs.readFileSync(issueFile, "utf8"));
const active = JSON.parse(fs.readFileSync(activeFile, "utf8"));
const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
const labels = (Array.isArray(issue.labels) ? issue.labels : issue.labels?.nodes || []).map((label) => typeof label === "string" ? label : label?.name).filter(Boolean).map((name) => name.replace(/^status:\s+/, "status:"));
const assignees = (Array.isArray(issue.assignees) ? issue.assignees : issue.assignees?.nodes || []).map((entry) => typeof entry === "string" ? entry : entry?.login).filter(Boolean);
const updatedAt = issue.updated_at || issue.updatedAt || "";
const now = process.env.OPENSPEC_BUDDY_NOW ? Date.parse(process.env.OPENSPEC_BUDDY_NOW) : Date.now();
const fail = (message) => { process.stderr.write(`Active claim resume rejected: ${message}\n`); process.exit(1); };
if (String(issue.state || "").toUpperCase() !== "OPEN") fail("issue is not open");
if (labels.filter((label) => label.startsWith("status:")).length !== 1 || !labels.includes("status:claimed")) fail("issue is not exactly status:claimed");
if (!assignees.includes(viewer)) fail("current viewer is not the assignee");
if (!active) fail("no active claim exists");
if (String(active.agent || "").replace(/^@/, "") !== viewer) fail("active claim belongs to another agent");
if (active.change_id !== changeId || active.branch !== branch) fail("active claim change or branch does not match");
if (!active.claim_id || !active.lease_until || !active.base_branch || !active.base_sha) fail("active claim evidence is incomplete");
if (active.comment_user_login !== viewer) fail("claim comment was not authored by the current claiming actor");
if (active.base_branch !== baseBranch) fail("active claim base_branch does not match");
if (!Number.isFinite(Date.parse(active.lease_until)) || Date.parse(active.lease_until) <= now) fail("active claim lease has expired; use stale recovery and reacquire");
if (active.base_sha !== baseSha) fail("active claim base_sha is stale; use stale recovery and reacquire");
if (!active.worktree_path_hash || !active.worktree_alias || !active.coordination_branch) fail("active claim worktree identity is incomplete; use stale recovery and reacquire");
if (active.worktree_path_hash !== identity.path_hash) fail("active claim belongs to another worktree");
if (active.worktree_alias !== identity.alias) fail("active claim belongs to another worktree alias");
if (active.coordination_branch !== identity.coordination_branch) fail("active claim coordination branch does not match");
if (expectedUpdatedAt && updatedAt !== expectedUpdatedAt) fail("issue updatedAt changed before mutation");
process.stdout.write(JSON.stringify(active));
' "$issue_file" "$active_file" "$identity_file" "$change_id" "$claim_branch" "$viewer" "$current_base_sha" "$expected_updated_at" "$base_branch"
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
    active.set(fields.claim_id, {
      ...fields,
      created_at: comment.created_at || comment.createdAt || "",
      comment_user_login: comment.user?.login || comment.author?.login || "",
    });
  }
  return [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1);
}
const labels = labelsOf(issue.labels);
const statusLabels = labels.filter((label) => label.startsWith("status:"));
const status = statusLabels[0] || "";
const state = String(issue.state || "").toUpperCase();
if (state !== "OPEN") {
  process.stderr.write(`Issue is not open: ${issue.state || "unknown"}\n`);
  process.exit(10);
}
if (mode === "preflight") {
  if (labels.includes("type:series-parent") || statusLabels.includes("status:tracking")) {
    process.stderr.write("Issue is a series parent and cannot be claimed.\n");
    process.exit(11);
  }
  if (statusLabels.length > 1) {
    process.stderr.write(`Issue has multiple status labels: ${statusLabels.join(", ")}\n`);
    process.exit(17);
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

buddy_resolve_coupling_group() {
  local metadata_file="$1"
  local issue_file="$2"
  node -e '
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const issue = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const normalize = (value) => {
  const normalized = String(value || "").trim();
  return normalized && normalized.toLowerCase() !== "none" ? normalized : "";
};
const metadataGroup = normalize(metadata.coupling_group);
const couplingGroups = [...new Set((issue.labels || [])
  .map((label) => label?.name || "")
  .map((name) => name.replace(/^coupling:\s+/, "coupling:"))
  .filter((name) => name.startsWith("coupling:"))
  .map((name) => normalize(name.slice("coupling:".length)))
  .filter(Boolean))];
if (couplingGroups.length > 1 || (metadataGroup && couplingGroups.length === 1 && couplingGroups[0] !== metadataGroup)) {
  process.stderr.write(metadataGroup && couplingGroups.length === 1
    ? `Issue coupling metadata and labels disagree: metadata=${metadataGroup}, label=${couplingGroups[0]}\n`
    : `Issue has multiple coupling labels: ${couplingGroups.join(", ")}\n`);
  process.exit(1);
}
process.stdout.write(metadataGroup || couplingGroups[0] || "none");
' "$metadata_file" "$issue_file"
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

  local adopted_line=""
  if [[ "$adopted_from_open_issue" == "true" ]]; then
    adopted_line="adopted_from_open_issue: true"
  fi
  local identity_file
  identity_file="$(mktemp)"
  local cache_dir
  cache_dir="$(buddy_cache_dir)"
  buddy_worktree_identity_json "$cache_dir" > "$identity_file"
  local worktree_alias
  local worktree_path_hash
  local coordination_branch
  local run_id
  worktree_alias="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.alias || "");' "$identity_file")"
  worktree_path_hash="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.path_hash || "");' "$identity_file")"
  coordination_branch="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.coordination_branch || "");' "$identity_file")"
  run_id="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.run_id || "");' "$identity_file")"
  rm -f "$identity_file"

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
worktree_alias: $worktree_alias
worktree_path_hash: $worktree_path_hash
coordination_branch: $coordination_branch
run_id: $run_id
$adopted_line
EOF
)"
  buddy_claim_set_status_label_direct "$issue_number" "$issue_file" "status:claimed"
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
    active.set(fields.claim_id, {
      ...fields,
      created_at: comment.created_at || comment.createdAt || "",
      comment_user_login: comment.user?.login || comment.author?.login || "",
    });
  }
  return [...active.values()].sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || ""))).at(-1);
}
const state = String(issue.state || "").toUpperCase();
const labels = labelsOf(issue.labels);
const statusLabels = labels.filter((name) => /^status:/.test(name));
const assignees = Array.isArray(issue.assignees) ? issue.assignees : issue.assignees?.nodes || [];
const assigneeLogins = assignees
  .map((assignee) => typeof assignee === "string" ? assignee : assignee?.login)
  .filter(Boolean);
if (state !== "OPEN") {
  process.stderr.write(`Claim verification failed: issue is not open (${issue.state || "unknown"}).\n`);
  process.exit(20);
}
if (statusLabels.length !== 1 || statusLabels[0] !== "status:claimed") {
  process.stderr.write(`Claim verification failed: expected exactly status:claimed, observed ${statusLabels.join(",") || "<none>"}.\n`);
  process.exit(21);
}
if (!assigneeLogins.includes(viewer)) {
  process.stderr.write(`Claim verification failed: assignee ${viewer} is missing.\n`);
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
