#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: read-live-claim-truth.sh <issue-number> [--json]"
  exit 0
fi
if [[ -z "$issue_number" || ( "${2:-}" != "" && "${2:-}" != "--json" ) ]]; then
  echo "Usage: read-live-claim-truth.sh <issue-number> [--json]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
source "$script_dir/claim-lock.sh"
source "$script_dir/worktree-identity.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cache_dir="$(buddy_cache_dir)"
repo_nwo="$(buddy_repo_nwo)"
repo_root="$(buddy_worktree_repo_root)"
bound_branch="$(buddy_worktree_bound_branch "$repo_root")"
issue_file="$tmp_dir/issue.json"
comments_file="$tmp_dir/comments.json"
active_file="$tmp_dir/active-claim.json"
identity_file="$tmp_dir/identity.json"
remote_branch_file="$tmp_dir/remote-branch.txt"

if ! buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"; then
  echo "Live claim truth unavailable: could not read issue #$issue_number from GitHub." >&2
  exit 2
fi
if ! buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"; then
  echo "Live claim truth unavailable: could not read comments for issue #$issue_number from GitHub." >&2
  exit 2
fi
if ! buddy_claim_active_comment_to_file "$comments_file" "$active_file"; then
  echo "Live claim truth unavailable: could not parse claim comments for issue #$issue_number." >&2
  exit 2
fi
if ! buddy_worktree_identity_json "$cache_dir" > "$identity_file"; then
  echo "Live claim truth unavailable: could not determine current worktree identity." >&2
  exit 2
fi

claim_change_id="$(node -e 'const fs=require("node:fs"); const active=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(active?.change_id || "");' "$active_file")"
if [[ -n "$claim_change_id" ]]; then
  if ! git ls-remote --heads origin "$claim_change_id" > "$remote_branch_file"; then
    echo "Live claim truth unavailable: could not verify origin/$claim_change_id." >&2
    exit 2
  fi
else
  : > "$remote_branch_file"
fi

viewer="$(gh api user --jq .login 2>/dev/null || true)"
if [[ -z "$viewer" ]]; then
  echo "Live claim truth unavailable: could not determine the current GitHub viewer." >&2
  exit 2
fi

node - "$issue_file" "$active_file" "$identity_file" "$remote_branch_file" "$issue_number" "$viewer" "$bound_branch" <<'NODE'
const fs = require('node:fs');

const [issueFile, activeFile, identityFile, remoteBranchFile, issueNumber, viewer, boundBranch] = process.argv.slice(2);
const issue = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
const remoteBranch = fs.readFileSync(remoteBranchFile, 'utf8');
const nowValue = process.env.OPENSPEC_BUDDY_NOW || '';
const now = nowValue ? Date.parse(nowValue) : Date.now();
const checkedAt = new Date().toISOString();

function labelsOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter(Boolean)
    .map((name) => name.replace(/^status:\s+/, 'status:'));
}

function assigneesOf(value) {
  const list = Array.isArray(value) ? value : value?.nodes || [];
  return list
    .map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login)
    .filter(Boolean);
}

const result = {
  issue: String(issue.number || issueNumber),
  issueState: String(issue.state || '').toUpperCase(),
  status: 'missing',
  claimId: '',
  agent: '',
  changeId: '',
  branch: '',
  baseSha: '',
  leaseUntil: '',
  worktreeAlias: '',
  worktreePathHash: '',
  coordinationBranch: '',
  source: 'github-rest',
  checkedAt,
};

if (result.issueState !== 'OPEN') {
  result.status = 'invalid';
  result.reason = `issue-${result.issueState.toLowerCase() || 'state-unknown'}`;
} else if (active && typeof active === 'object') {
  result.claimId = String(active.claim_id || '');
  result.agent = String(active.agent || '');
  result.changeId = String(active.change_id || '');
  result.branch = String(active.branch || '');
  result.baseSha = String(active.base_sha || '');
  result.leaseUntil = String(active.lease_until || '');
  result.worktreeAlias = String(active.worktree_alias || '');
  result.worktreePathHash = String(active.worktree_path_hash || '');
  result.coordinationBranch = String(active.coordination_branch || '');

  const lease = Date.parse(result.leaseUntil);
  if (!result.claimId || !result.leaseUntil || !Number.isFinite(lease)) {
    result.status = 'invalid';
    result.reason = 'claim-missing-or-invalid-lease';
  } else if (!Number.isFinite(now)) {
    result.status = 'invalid';
    result.reason = 'invalid-clock';
  } else if (lease <= now) {
    result.status = 'expired';
  } else {
    const statusLabels = labelsOf(issue.labels).filter((name) => name.startsWith('status:'));
    const activeStatus = new Set(['status:claimed', 'status:in-progress', 'status:in-review']);
    const claimStatus = statusLabels[0] || '';
    const claimAgent = result.agent.replace(/^@/, '');
    const assigneeLogins = assigneesOf(issue.assignees);
    const remoteBranchExists = remoteBranch
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .some((fields) => fields[1] === `refs/heads/${result.changeId}`);
    if (!result.changeId || !result.branch || !result.baseSha || result.branch !== result.changeId) {
      result.status = 'invalid';
      result.reason = 'claim-branch-proof-incomplete';
    } else if (!remoteBranchExists) {
      result.status = 'invalid';
      result.reason = 'claim-branch-lock-missing';
    } else if (statusLabels.length !== 1 || !activeStatus.has(claimStatus)) {
      result.status = 'invalid';
      result.reason = statusLabels.length === 1
        ? `issue-status-not-active:${claimStatus || 'missing'}`
        : 'issue-status-label-invalid';
    } else if (!assigneeLogins.includes(claimAgent)) {
      result.status = 'invalid';
      result.reason = 'claim-assignee-missing';
    } else if (assigneeLogins.some((login) => login !== claimAgent)) {
      result.status = 'foreign';
      result.reason = `claim-assignee-mismatch:${assigneeLogins.filter((login) => login !== claimAgent).join(',')}`;
    } else if (boundBranch && !result.coordinationBranch) {
      result.status = 'invalid';
      result.reason = 'claim-missing-coordination-branch';
    } else {
      const mismatches = [];
      if (claimAgent !== viewer) mismatches.push('agent');
      if (result.worktreeAlias && result.worktreeAlias !== String(identity.alias || '')) mismatches.push('worktree_alias');
      if (result.worktreePathHash && result.worktreePathHash !== String(identity.path_hash || '')) mismatches.push('worktree_path_hash');
      if (boundBranch && result.coordinationBranch !== boundBranch) mismatches.push('coordination_branch');
      if (mismatches.length > 0) {
        result.status = 'foreign';
        result.reason = `claim-identity-mismatch:${mismatches.join(',')}`;
      } else {
        result.status = 'owned';
      }
    }
  }
}

process.stdout.write(`${JSON.stringify(result)}\n`);
NODE
