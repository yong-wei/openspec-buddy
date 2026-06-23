#!/usr/bin/env bash

buddy_worktree_repo_root() {
  if declare -F openspec_buddy_repo_root >/dev/null 2>&1; then
    openspec_buddy_repo_root
    return 0
  fi
  git rev-parse --show-toplevel
}

buddy_worktree_current_branch() {
  local repo_root="$1"
  git -C "$repo_root" branch --show-current
}

buddy_worktree_alias() {
  local repo_root="$1"
  if [[ -n "${OPENSPEC_BUDDY_WORKTREE_ALIAS:-}" ]]; then
    printf '%s\n' "$OPENSPEC_BUDDY_WORKTREE_ALIAS"
    return 0
  fi
  basename "$(dirname "$repo_root")"
}

buddy_worktree_path_hash() {
  local repo_root="$1"
  node -e '
const crypto = require("node:crypto");
process.stdout.write(crypto.createHash("sha256").update(process.argv[1]).digest("hex"));
' "$repo_root"
}

buddy_worktree_run_id() {
  local cache_dir="$1"
  local file="$cache_dir/worktree-run-id"
  mkdir -p "$cache_dir"
  if [[ ! -s "$file" ]]; then
    (uuidgen 2>/dev/null || node -e 'console.log(crypto.randomUUID())') > "$file"
  fi
  tr -d '\r\n' < "$file"
}

buddy_worktree_identity_json() {
  local cache_dir="$1"
  local repo_root
  repo_root="$(buddy_worktree_repo_root)"
  local current_branch
  current_branch="$(buddy_worktree_current_branch "$repo_root")"
  local alias
  alias="$(buddy_worktree_alias "$repo_root")"
  local path_hash
  path_hash="$(buddy_worktree_path_hash "$repo_root")"
  local run_id
  run_id="$(buddy_worktree_run_id "$cache_dir")"
  node -e '
const [alias, path, pathHash, coordinationBranch, runId] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  alias,
  path,
  path_hash: pathHash,
  coordination_branch: coordinationBranch,
  run_id: runId,
}));
' "$alias" "$repo_root" "$path_hash" "$current_branch" "$run_id"
}

buddy_worktree_record_claim() {
  local cache_dir="$1"
  local issue_number="$2"
  local change_id="$3"
  local claim_branch="$4"
  local claim_id="$5"
  local coordination_branch="$6"
  local repo_root
  repo_root="$(buddy_worktree_repo_root)"
  local alias
  alias="$(buddy_worktree_alias "$repo_root")"
  local path_hash
  path_hash="$(buddy_worktree_path_hash "$repo_root")"
  local run_id
  run_id="$(buddy_worktree_run_id "$cache_dir")"
  local ledger="$cache_dir/worktrees.json"
  mkdir -p "$cache_dir"
  node -e '
const fs = require("node:fs");
const [file, alias, path, pathHash, runId, issueNumber, changeId, claimBranch, claimId, coordinationBranch] = process.argv.slice(1);
let data = { worktrees: {} };
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  data = { worktrees: {} };
}
if (!data || typeof data !== "object") data = { worktrees: {} };
if (!data.worktrees || typeof data.worktrees !== "object") data.worktrees = {};
data.worktrees[pathHash] = {
  alias,
  path,
  path_hash: pathHash,
  run_id: runId,
  current_issue: Number(issueNumber),
  change_id: changeId,
  claim_branch: claimBranch,
  claim_id: claimId,
  coordination_branch: coordinationBranch,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$ledger" "$alias" "$repo_root" "$path_hash" "$run_id" "$issue_number" "$change_id" "$claim_branch" "$claim_id" "$coordination_branch"
}
