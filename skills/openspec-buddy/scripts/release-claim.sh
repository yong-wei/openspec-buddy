#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: release-claim.sh <issue-number> [--reason TEXT] [--delete-branch] [--clear-lane] [--force]

Releases the latest active OpenSpec Buddy claim for an issue, restores status:ready,
and optionally deletes the claim branch only when it still equals the recorded base_sha.
By default, the active claim must belong to the current worktree identity.
EOF
}

issue_number="${1:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  usage
  exit 0
fi
if [[ -z "$issue_number" ]]; then
  usage >&2
  exit 2
fi
shift || true
if [[ ! "$issue_number" =~ ^[0-9]+$ ]]; then
  echo "Issue number must be numeric." >&2
  exit 2
fi

reason="manual release"
delete_branch=0
clear_lane=0
force_release=0
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --reason)
      reason="${2:-}"
      shift 2
      ;;
    --delete-branch)
      delete_branch=1
      shift
      ;;
    --clear-lane)
      clear_lane=1
      shift
      ;;
    --force)
      force_release=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
source "$script_dir/claim-lock.sh"
source "$script_dir/cache-signal.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

repo_nwo="$(buddy_repo_nwo)"
viewer="$(gh api user --jq .login)"
comments_file="$tmp_dir/comments.json"
active_file="$tmp_dir/active.json"
issue_file="$tmp_dir/issue.json"
open_prs_file="$tmp_dir/open-prs.json"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
current_alias="$(buddy_worktree_alias "$repo_root")"
current_path_hash="$(buddy_worktree_path_hash "$repo_root")"

issue_is_open() {
  node -e 'const fs=require("node:fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(String(issue.state || "").toLowerCase() === "open" ? 0 : 1);' "$issue_file"
}

issue_has_status_claimed() {
  node -e '
const fs=require("node:fs");
const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const labels=Array.isArray(issue.labels) ? issue.labels : [];
const names=labels.map((label)=>typeof label==="string" ? label : label?.name).filter(Boolean);
process.exit(names.includes("status:claimed") ? 0 : 1);
' "$issue_file"
}

restore_ready_status() {
  existing_statuses="$(
    gh issue view "$issue_number" --json labels \
      --jq '[.labels[].name | select(test("^status:\\s*"))] | join(",")'
  )"
  label_args=(issue edit "$issue_number")
  if [[ -n "$existing_statuses" ]]; then
    label_args+=(--remove-label "$existing_statuses")
  fi
  label_args+=(--add-label "status:ready")
  gh "${label_args[@]}"

  cache_dir="$(buddy_cache_dir)"
  buddy_invalidate_issue_cache "$cache_dir" "$issue_number"
  buddy_invalidate_ready_scan_cache "$cache_dir"
}

clear_current_lane() {
  local branch="${1:-}"
  if [[ "$clear_lane" != "1" ]]; then
    return 0
  fi
  local lane_dir="${OPENSPEC_BUDDY_AUTO_LANE_STATE_DIR:-}"
  if [[ -z "$lane_dir" ]]; then
    lane_dir="$repo_root/openspec/.buddy-cache/auto-lanes"
  fi
  if [[ ! -d "$lane_dir" ]]; then
    return 0
  fi
  local state_alias
  state_alias="$(git -C "$repo_root" config --worktree --get buddy.worktreeAlias 2>/dev/null || true)"
  local lane_file
  lane_file="$(
    node -e '
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [dir, repoRoot, alias] = process.argv.slice(1);
const root = fs.realpathSync(repoRoot);
const hash = crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
const key = String(alias || hash || root).replace(/[^A-Za-z0-9_.-]/g, "-");
process.stdout.write(path.join(dir, `${key}.json`));
' "$lane_dir" "$repo_root" "$state_alias"
  )"
  if [[ ! -f "$lane_file" ]]; then
    return 0
  fi
  node -e '
const fs = require("node:fs");
const [file, issue, branch] = process.argv.slice(1);
let data;
try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { process.exit(0); }
if (!Array.isArray(data.lanes)) process.exit(0);
const before = data.lanes.length;
data.lanes = data.lanes.filter((lane) => String(lane.issue || "") !== issue && (!branch || String(lane.branch || "") !== branch));
if (data.lanes.length !== before) fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
' "$lane_file" "$issue_number" "$branch"
}

buddy_claim_issue_rest "$repo_nwo" "$issue_number" "$issue_file"
buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file"
buddy_claim_active_comment_to_file "$comments_file" "$active_file"

if ! node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(data && data.claim_id ? 0 : 1);' "$active_file"; then
  if issue_is_open && issue_has_status_claimed; then
    restore_ready_status
    clear_current_lane ""
    printf 'Issue #%s has no active OpenSpec Buddy claim; reconciled status:ready.\n' "$issue_number"
    exit 0
  fi
  clear_current_lane ""
  printf 'Issue #%s has no active OpenSpec Buddy claim; nothing to release.\n' "$issue_number"
  exit 0
fi

change_id="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.change_id || "");' "$active_file")"
claim_branch="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.branch || "");' "$active_file")"
claim_id="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_id || "");' "$active_file")"
lease_until="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.lease_until || "");' "$active_file")"
base_sha="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.base_sha || "");' "$active_file")"
claim_alias="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.worktree_alias || "");' "$active_file")"
claim_path_hash="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.worktree_path_hash || "");' "$active_file")"

if [[ "$force_release" != "1" ]]; then
  if [[ -z "$claim_alias" || -z "$claim_path_hash" ]]; then
    echo "Refusing to release claim without worktree identity; rerun with --force only after manual ownership verification." >&2
    exit 1
  fi
  if [[ "$claim_alias" != "$current_alias" || "$claim_path_hash" != "$current_path_hash" ]]; then
    echo "Refusing to release foreign claim: active claim belongs to $claim_alias/$claim_path_hash, current worktree is $current_alias/$current_path_hash." >&2
    exit 1
  fi
fi

if ! issue_is_open; then
  echo "Refusing to release claim for a non-open issue." >&2
  exit 1
fi

if [[ -n "$claim_branch" ]]; then
  buddy_claim_open_prs_rest "$repo_nwo" "$claim_branch" "$open_prs_file"
  if node -e 'const fs=require("node:fs"); const prs=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(Array.isArray(prs) && prs.length > 0 ? 0 : 1);' "$open_prs_file"; then
    echo "Refusing to release claim while an open PR exists for the claim branch." >&2
    exit 1
  fi
fi

buddy_release_claim_lock "$issue_number" "$change_id" "$claim_branch" "$viewer" "$claim_id" "$lease_until" "$reason"

restore_ready_status
clear_current_lane "$claim_branch"

if [[ "$delete_branch" == "1" && -n "$claim_branch" && -n "$base_sha" ]]; then
  branch_sha="$(buddy_claim_branch_head_sha "$claim_branch" || true)"
  if [[ -n "$branch_sha" && "$branch_sha" == "$base_sha" ]]; then
    git push origin ":refs/heads/$claim_branch" >/dev/null
    printf 'Deleted empty claim branch origin/%s.\n' "$claim_branch"
  elif [[ -n "$branch_sha" ]]; then
    printf 'Skipped branch deletion: origin/%s has commits beyond recorded base_sha.\n' "$claim_branch" >&2
  fi
fi

printf 'Released OpenSpec Buddy claim %s for issue #%s.\n' "$claim_id" "$issue_number"
