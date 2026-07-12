#!/usr/bin/env bash
set -euo pipefail

issue_number=""
pr_ref=""
expected_branch=""
allow_coordination_branch=0
allow_detached=0
json_output=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -h|--help)
      echo "Usage: verify-claim-worktree.sh [--issue <number>] [--pr <number-or-url>] [--branch <name>] [--allow-coordination-branch] [--allow-detached] [--json]"
      exit 0
      ;;
    --issue)
      issue_number="${2:-}"
      shift 2
      ;;
    --pr)
      pr_ref="${2:-}"
      shift 2
      ;;
    --branch)
      expected_branch="${2:-}"
      shift 2
      ;;
    --allow-coordination-branch)
      allow_coordination_branch=1
      shift
      ;;
    --allow-detached)
      allow_detached=1
      shift
      ;;
    --json)
      json_output=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$issue_number" && -z "$pr_ref" && -z "$expected_branch" ]]; then
  echo "Usage: verify-claim-worktree.sh [--issue <number>] [--pr <number-or-url>] [--branch <name>] [--allow-coordination-branch] [--allow-detached] [--json]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
source "$script_dir/claim-lock.sh"
source "$script_dir/worktree-identity.sh"
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

cache_dir="$(buddy_cache_dir)"
repo_root="$(buddy_worktree_repo_root)"
current_branch="$(buddy_worktree_current_branch "$repo_root")"
repo_nwo="$(buddy_repo_nwo)"
bound_branch="$(buddy_worktree_bound_branch "$repo_root")"

if [[ -z "$current_branch" && "$allow_detached" != "1" ]]; then
  echo "Claim worktree guard failed: detached HEAD is not an executable Buddy state." >&2
  exit 41
fi

if [[ -n "$pr_ref" ]]; then
  pr_number="$(resolve_pr_number "$pr_ref")"
  pr_file="$tmp_dir/pr.json"
  gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"
  pr_branch="$(node -e '
const fs = require("node:fs");
const pr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(pr.head?.ref || "");
' "$pr_file")"
  if [[ -z "$pr_branch" ]]; then
    echo "Claim worktree guard failed: PR #$pr_number has no head branch." >&2
    exit 42
  fi
  if [[ -n "$expected_branch" && "$expected_branch" != "$pr_branch" ]]; then
    echo "Claim worktree guard failed: expected branch '$expected_branch' does not match PR head '$pr_branch'." >&2
    exit 43
  fi
  expected_branch="$pr_branch"
  if [[ -z "$issue_number" ]]; then
    issue_number="$(node -e '
const fs = require("node:fs");
const pr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const body = String(pr.body || "");
const marker = body.match(/openspec-buddy-origin-issue:([0-9]+)/);
const line = body.match(/Origin issue:\s*#([0-9]+)/i);
process.stdout.write(marker?.[1] || line?.[1] || "");
' "$pr_file")"
    if [[ -z "$issue_number" ]]; then
      echo "Claim worktree guard failed: PR #$pr_number does not record an OpenSpec Buddy origin issue." >&2
      exit 53
    fi
  fi
fi

if [[ -n "$expected_branch" ]]; then
  worktrees_file="$tmp_dir/worktrees.txt"
  git worktree list --porcelain > "$worktrees_file"
  node -e '
const fs = require("node:fs");
const [file, currentPath, expectedBranch, allowCoordination] = process.argv.slice(1);
const text = fs.readFileSync(file, "utf8");
let current = null;
const hits = [];
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("worktree ")) {
    current = line.slice("worktree ".length);
  } else if (line === `branch refs/heads/${expectedBranch}` && current) {
    hits.push(current);
  }
}
const foreign = hits.filter((path) => path !== currentPath);
if (foreign.length > 0) {
  process.stderr.write(`foreign-claim-detected: branch ${expectedBranch} is bound to another worktree: ${foreign.join(", ")}\n`);
  process.exit(45);
}
if (allowCoordination !== "1" && hits.length > 0 && !hits.includes(currentPath)) {
  process.stderr.write(`foreign-claim-detected: branch ${expectedBranch} is not bound to the current worktree.\n`);
  process.exit(46);
}
' "$worktrees_file" "$repo_root" "$expected_branch" "$allow_coordination_branch"
fi

if [[ -n "$expected_branch" && "$allow_coordination_branch" != "1" && "$current_branch" != "$expected_branch" ]]; then
  echo "Claim worktree guard failed: current branch '$current_branch' does not match expected claim branch '$expected_branch'." >&2
  exit 44
fi

if [[ -n "$issue_number" ]]; then
  issue_file="$tmp_dir/issue.json"
  comments_file="$tmp_dir/comments.json"
  active_file="$tmp_dir/active-claim.json"
  identity_file="$tmp_dir/identity.json"
  buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
  buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"
  buddy_claim_active_comment_to_file "$comments_file" "$active_file"
  buddy_worktree_identity_json "$cache_dir" > "$identity_file"
  node -e '
const fs = require("node:fs");
const [issueFile, activeFile, identityFile, expectedBranch, boundBranch] = process.argv.slice(1);
const issue = JSON.parse(fs.readFileSync(issueFile, "utf8"));
const active = JSON.parse(fs.readFileSync(activeFile, "utf8"));
const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
const labels = (Array.isArray(issue.labels) ? issue.labels : issue.labels?.nodes || [])
  .map((label) => typeof label === "string" ? label : label?.name)
  .filter(Boolean)
  .map((name) => name.replace(/^status:\s+/, "status:"));
if (String(issue.state || "").toUpperCase() !== "OPEN") {
  process.stderr.write("Claim worktree guard failed: issue is not open.\n");
  process.exit(47);
}
if (!active) {
  process.stderr.write("Claim worktree guard failed: issue has no active claim comment.\n");
  process.exit(48);
}
if (expectedBranch && active.branch && active.branch !== expectedBranch) {
  process.stderr.write(`Claim worktree guard failed: active claim branch ${active.branch} does not match expected ${expectedBranch}.\n`);
  process.exit(49);
}
if (active.worktree_path_hash && active.worktree_path_hash !== identity.path_hash) {
  process.stderr.write("Claim worktree guard failed: active claim belongs to another worktree.\n");
  process.exit(50);
}
if (active.worktree_alias && active.worktree_alias !== identity.alias) {
  process.stderr.write("Claim worktree guard failed: active claim belongs to another worktree alias.\n");
  process.exit(51);
}
if (boundBranch && !active.coordination_branch) {
  process.stderr.write("Claim worktree guard failed: active claim is missing coordination_branch for a bound worktree.\n");
  process.exit(54);
}
if (boundBranch && active.coordination_branch !== boundBranch) {
  process.stderr.write(`Claim worktree guard failed: active claim coordination branch ${active.coordination_branch} does not match bound branch ${boundBranch}.\n`);
  process.exit(54);
}
' "$issue_file" "$active_file" "$identity_file" "$expected_branch" "$bound_branch"
fi

if [[ "$json_output" == "1" ]]; then
  if [[ -z "$issue_number" ]]; then
    echo "Claim worktree guard failed: --json requires an issue or PR with an origin issue." >&2
    exit 2
  fi
  live_claim_file="$tmp_dir/live-claim-truth.json"
  if ! "$script_dir/read-live-claim-truth.sh" "$issue_number" --json > "$live_claim_file"; then
    echo "Claim worktree guard failed: live claim truth is unavailable." >&2
    exit 55
  fi
  cat "$live_claim_file"
fi

printf 'Claim worktree verified'
if [[ -n "$issue_number" ]]; then
  printf ' for issue #%s' "$issue_number"
fi
if [[ -n "${pr_number:-}" ]]; then
  printf ' and PR #%s' "$pr_number"
fi
if [[ -n "$expected_branch" ]]; then
  printf ' on branch %s' "$expected_branch"
fi
printf '.\n'
