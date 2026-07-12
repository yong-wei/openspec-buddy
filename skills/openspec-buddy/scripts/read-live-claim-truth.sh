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
issue_file="$tmp_dir/issue.json"
comments_file="$tmp_dir/comments.json"
active_file="$tmp_dir/active-claim.json"
identity_file="$tmp_dir/identity.json"

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

viewer="$(gh api user --jq .login 2>/dev/null || true)"
if [[ -z "$viewer" ]]; then
  echo "Live claim truth unavailable: could not determine the current GitHub viewer." >&2
  exit 2
fi

node - "$issue_file" "$active_file" "$identity_file" "$issue_number" "$viewer" <<'NODE'
const fs = require('node:fs');

const [issueFile, activeFile, identityFile, issueNumber, viewer] = process.argv.slice(2);
const issue = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
const identity = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
const nowValue = process.env.OPENSPEC_BUDDY_NOW || '';
const now = nowValue ? Date.parse(nowValue) : Date.now();
const checkedAt = new Date().toISOString();

const result = {
  issue: String(issue.number || issueNumber),
  issueState: String(issue.state || '').toUpperCase(),
  status: 'missing',
  claimId: '',
  agent: '',
  changeId: '',
  branch: '',
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
    const mismatches = [];
    const claimAgent = result.agent.replace(/^@/, '');
    if (claimAgent !== viewer) mismatches.push('agent');
    if (result.worktreeAlias && result.worktreeAlias !== String(identity.alias || '')) mismatches.push('worktree_alias');
    if (result.worktreePathHash && result.worktreePathHash !== String(identity.path_hash || '')) mismatches.push('worktree_path_hash');
    if (result.coordinationBranch && result.coordinationBranch !== String(identity.coordination_branch || '')) mismatches.push('coordination_branch');
    if (mismatches.length > 0) {
      result.status = 'foreign';
      result.reason = `claim-identity-mismatch:${mismatches.join(',')}`;
    } else {
      result.status = 'owned';
    }
  }
}

process.stdout.write(`${JSON.stringify(result)}\n`);
NODE
