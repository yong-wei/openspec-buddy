#!/usr/bin/env bash
set -euo pipefail

issue_number="${1:-}"
if [[ "$issue_number" == "-h" || "$issue_number" == "--help" ]]; then
  echo "Usage: claim-issue.sh [issue-number]"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
source "$script_dir/claim-lock.sh"
source "$script_dir/worktree-identity.sh"
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
openspec_buddy_require_core_config
"$script_dir/verify-bound-worktree.sh" --phase pre-claim >/dev/null
"$script_dir/sync-base-branch.sh"

tmp_dir="$(mktemp -d)"
created_branch_lock=""
change_id=""
claim_branch=""
viewer=""
repo_nwo=""
claim_id=""
lease_until=""
claim_lock_written=0
claim_completed=0
viewer="$(gh api user --jq .login)"
repo_nwo="$(buddy_repo_nwo)"

buddy_claim_triage_gate() {
  local number="$1"
  local selected_change_id="$2"
  local selected_base_branch="$3"
  local selected_claim_branch="$4"
  local live_issue_file="$tmp_dir/triage-live-issue.json"
  local triage_file="openspec/changes/$selected_change_id/.buddy/triage.json"
  local expected_updated_at
  local expected_base_sha
  local validation_output
  local disposition
  local reason
  local series_parent_had_type=0
  local series_parent_type_added_by_tx=0
  local series_parent_original_status=""
  local mutation_owner_json

  if ! buddy_verify_active_claim_resume "$number" "$selected_change_id" "$selected_claim_branch" "$selected_base_branch" "$viewer" "$repo_nwo" "$tmp_dir/triage-owner-before-read" >/dev/null; then
    return 1
  fi
  # This read must occur after the minimal claim lock is verified. Its updatedAt
  # is the remote truth to which the agent-owned judgment is bound.
  if ! gh issue view "$number" --json id,number,title,labels,assignees,body,url,state,updatedAt > "$live_issue_file"; then return 1; fi
  if ! expected_updated_at="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!issue.updatedAt) process.exit(1); process.stdout.write(issue.updatedAt);' "$live_issue_file")"; then return 1; fi
  if ! git fetch origin "$selected_base_branch" >/dev/null; then return 1; fi
  if ! expected_base_sha="$(git rev-parse "origin/$selected_base_branch")"; then return 1; fi

  if [[ ! -f "$triage_file" ]]; then
    printf 'HANDOFF\nmode: claim\ntriage_disposition: pending\nrequired_action: Collect bounded evidence, record agent-owned judgment in %s, and rerun claim. The verified minimal claim lock remains active.\n' "$triage_file"
    return 10
  fi

  if ! validation_output="$(node "$script_dir/validate-triage.mjs" "$triage_file" --issue "$number" --change-id "$selected_change_id" --issue-updated-at "$expected_updated_at" --base-sha "$expected_base_sha")"; then
    return 1
  fi
  if ! disposition="$(node -e 'const value=JSON.parse(process.argv[1]); if (!value.disposition) process.exit(1); process.stdout.write(value.disposition);' "$validation_output")"; then return 1; fi
  [[ "$disposition" == "executable" ]] && return 0

  if ! reason="$(node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!value.readiness?.reason) process.exit(1); process.stdout.write(value.readiness.reason);' "$triage_file")"; then return 1; fi
  # Recheck the same remote version and active owner immediately before a
  # disposition writes status or closes the issue.
  if ! mutation_owner_json="$(buddy_verify_active_claim_resume "$number" "$selected_change_id" "$selected_claim_branch" "$selected_base_branch" "$viewer" "$repo_nwo" "$tmp_dir/triage-owner-before-mutation" "$expected_updated_at")"; then
    return 1
  fi
  # A failed disposition must release the verified active claim, including on
  # the claimed re-entry path where this process did not create the lock.
  if ! claim_id="$(node -e 'const value=JSON.parse(process.argv[1]); if (!value.claim_id) process.exit(1); process.stdout.write(value.claim_id);' "$mutation_owner_json")"; then return 1; fi
  if ! lease_until="$(node -e 'const value=JSON.parse(process.argv[1]); if (!value.lease_until) process.exit(1); process.stdout.write(value.lease_until);' "$mutation_owner_json")"; then return 1; fi
  claim_lock_written=1

  rollback_series_parent_disposition() {
    local rollback_failed=0
    local rollback_file="$tmp_dir/triage-series-parent-rollback.json"
    if ! "$script_dir/set-status-label.sh" "$number" "$series_parent_original_status"; then
      rollback_failed=1
    fi
    if [[ "$series_parent_type_added_by_tx" == "1" ]]; then
      if ! gh issue edit "$number" --remove-label "type:series-parent"; then
        rollback_failed=1
      fi
    fi
    if ! gh issue view "$number" --json state,labels > "$rollback_file"; then
      rollback_failed=1
    elif ! node -e '
const fs=require("fs");
const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const expectedStatus=process.argv[2];
const expectedType=process.argv[3] === "1";
const labels=(issue.labels || []).map((label) => label.name);
const statuses=labels.filter((name) => name.startsWith("status:"));
const hasType=labels.includes("type:series-parent");
if (String(issue.state).toUpperCase() !== "OPEN" || statuses.length !== 1 || statuses[0] !== expectedStatus || hasType !== expectedType) process.exit(1);
' "$rollback_file" "$series_parent_original_status" "$series_parent_had_type"; then
      rollback_failed=1
    fi
    if [[ "$rollback_failed" == "1" ]]; then
      echo "BLOCKED: series-parent rollback failed; inspect issue #$number and restore $series_parent_original_status plus the original type:series-parent presence before retrying." >&2
      return 1
    fi
    echo "Series-parent disposition failed and was rolled back to the verified pre-mutation labels." >&2
    return 0
  }

  case "$disposition" in
    series-parent)
      series_parent_original_status="$(node -e '
const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const labels=(issue.labels || []).map((label) => label.name);
const statuses=labels.filter((name) => name.startsWith("status:"));
if (statuses.length !== 1) process.exit(1);
process.stdout.write(statuses[0]);
' "$live_issue_file")" || return 1
      if node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit((issue.labels || []).some((label) => label.name === "type:series-parent") ? 0 : 1);' "$live_issue_file"; then
        series_parent_had_type=1
      fi
      if [[ "$series_parent_had_type" != "1" ]] && ! gh issue edit "$number" --add-label "type:series-parent"; then
        rollback_series_parent_disposition || true
        return 1
      fi
      if [[ "$series_parent_had_type" != "1" ]]; then
        series_parent_type_added_by_tx=1
      fi
      if ! "$script_dir/set-status-label.sh" "$number" "status:tracking"; then
        rollback_series_parent_disposition || true
        return 1
      fi
      ;;
    needs-human)
      if ! "$script_dir/set-status-label.sh" "$number" "status:needs-human"; then return 1; fi
      ;;
    blocked)
      if ! "$script_dir/set-status-label.sh" "$number" "status:blocked"; then return 1; fi
      ;;
    close)
      if ! gh issue close "$number" --comment "OpenSpec Buddy triage close: $reason"; then return 1; fi
      ;;
    *)
      echo "Unsupported triage disposition: $disposition" >&2
      return 1
      ;;
  esac
  case "$disposition" in
    series-parent) expected_state="OPEN"; expected_status="status:tracking"; expected_type="type:series-parent" ;;
    needs-human) expected_state="OPEN"; expected_status="status:needs-human"; expected_type="" ;;
    blocked) expected_state="OPEN"; expected_status="status:blocked"; expected_type="" ;;
    close) expected_state="CLOSED"; expected_status=""; expected_type="" ;;
  esac
  if ! gh issue view "$number" --json state,labels > "$tmp_dir/triage-post-mutation.json"; then
    if [[ "$disposition" == "series-parent" ]]; then rollback_series_parent_disposition || true; fi
    return 1
  fi
  if ! node -e '
const fs=require("fs");
const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const expectedState=process.argv[2];
const expectedStatus=process.argv[3];
const expectedType=process.argv[4];
const labels=(issue.labels || []).map((label) => label.name);
const statuses=labels.filter((name) => name.startsWith("status:"));
if (String(issue.state).toUpperCase() !== expectedState || (expectedStatus && (statuses.length !== 1 || statuses[0] !== expectedStatus)) || (expectedType && !labels.includes(expectedType))) {
  process.stderr.write(`Triage disposition verification failed: state=${issue.state}, statuses=${statuses.join(",")}, labels=${labels.join(",")}\n`);
  process.exit(1);
}
' "$tmp_dir/triage-post-mutation.json" "$expected_state" "$expected_status" "$expected_type"; then
    if [[ "$disposition" == "series-parent" ]]; then
      rollback_series_parent_disposition || true
    fi
    return 1
  fi
  printf 'HANDOFF\nmode: claim\ntriage_disposition: %s\nrequired_action: %s\n' "$disposition" "$reason"
  return 10
}

run_claim_triage_gate() {
  local gate_status
  set +e
  buddy_claim_triage_gate "$@"
  gate_status=$?
  set -e
  if [[ "$gate_status" == "10" ]]; then
    claim_completed=1
    exit 0
  fi
  return "$gate_status"
}

cleanup() {
  if [[ -n "$created_branch_lock" && -n "$issue_number" && -n "$change_id" && -n "$claim_branch" && -n "$viewer" && -n "$claim_id" && -n "$lease_until" && -n "$repo_nwo" ]]; then
    buddy_delete_claim_branch_if_owned "$issue_number" "$change_id" "$claim_branch" "$viewer" "$claim_id" "$lease_until" "$repo_nwo" "$tmp_dir/cleanup" || true
  fi
  if [[ "$claim_lock_written" == "1" && "$claim_completed" != "1" && -n "$issue_number" && -n "$change_id" && -n "$claim_branch" && -n "$viewer" && -n "$claim_id" && -n "$lease_until" ]]; then
    buddy_release_claim_lock "$issue_number" "$change_id" "$claim_branch" "$viewer" "$claim_id" "$lease_until" "claim did not complete" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

cache_dir="$(buddy_cache_dir)"
export OPENSPEC_BUDDY_CACHE_DIR="$cache_dir"
export OPENSPEC_BUDDY_GH_CACHE_DIR="$cache_dir"
buddy_signal_apply "$cache_dir"

if [[ -z "$issue_number" ]]; then
  buddy_open_issues_rest "${OPENSPEC_BUDDY_CLAIM_ISSUE_LIMIT:-200}" > "$tmp_dir/issues.json"

  node -e '
const fs = require("fs");
const issues = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(JSON.stringify({ viewer: process.argv[2], issues }));
' "$tmp_dir/issues.json" "$viewer" | node "$script_dir/select-claim-issue.mjs" > "$tmp_dir/selection.json"
  issue_number="$(
    node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(data.selected?.number ? String(data.selected.number) : "");
' "$tmp_dir/selection.json"
  )"

  if [[ -z "$issue_number" ]]; then
    cat "$tmp_dir/selection.json" >&2
    exit 1
  fi
fi

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"

gh issue view "$issue_number" --json id,number,title,labels,assignees,body,url,state > "$issue_file"
issue_number="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(issue.number));' "$issue_file")"
node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"

if node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file" 2> "$tmp_dir/parse-error.txt"; then
  change_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.change_id);' "$metadata_file")"
  claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
  base_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.base_branch);' "$metadata_file")"
  issue_status="$(node -e 'const fs=require("fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write((issue.labels || []).map((label) => label.name).find((name) => name.replace(/^status:\\s+/, "status:") === "status:claimed") ? "claimed" : "other");' "$issue_file")"
  if [[ "$issue_status" == "claimed" ]]; then
    if ! run_claim_triage_gate "$issue_number" "$change_id" "$base_branch" "$claim_branch"; then
      exit 1
    fi
    exec "$script_dir/claim-change.sh" "$issue_number" --resume-active
  fi
  exec "$script_dir/claim-change.sh" "$issue_number"
  exit 0
fi

if node -e '
const fs = require("fs");
const body = fs.readFileSync(process.argv[1], "utf8");
process.exit(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body) || /<!--\s*openspec-buddy\s*\r?\n/.test(body) ? 0 : 1);
' "$body_file"; then
  echo "Issue #$issue_number already contains OpenSpec Buddy metadata, but it is invalid:" >&2
  cat "$tmp_dir/parse-error.txt" >&2
  exit 1
fi

node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(JSON.stringify({ viewer: process.argv[2], issues: [issue] }));
' "$issue_file" "$viewer" | node "$script_dir/select-claim-issue.mjs" > "$tmp_dir/single-selection.json"

if ! node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(data.selected ? 0 : 1);
' "$tmp_dir/single-selection.json"; then
  cat "$tmp_dir/single-selection.json" >&2
  exit 1
fi

if ! gh issue develop --help >/dev/null 2>&1; then
  echo "gh issue develop is required to create the linked Development branch. Update GitHub CLI before claiming Buddy issues." >&2
  exit 1
fi

node "$script_dir/build-open-issue-metadata.mjs" "$issue_file" > "$tmp_dir/adoption.json"
node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(data.updatedBody);
' "$tmp_dir/adoption.json" > "$tmp_dir/adopted-body.md"
node "$script_dir/parse-issue-metadata.mjs" "$tmp_dir/adopted-body.md" > "$metadata_file"

change_id="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.change_id);' "$metadata_file")"
claim_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.claim_branch);' "$metadata_file")"
coupling_group="$(buddy_resolve_coupling_group "$metadata_file" "$issue_file")"
base_branch="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.base_branch);' "$metadata_file")"

owner="${repo_nwo%%/*}"
repo_name="${repo_nwo#*/}"
viewer="$(gh api user --jq .login)"

"$script_dir/verify-claim-worktree.sh" --branch "$claim_branch" --allow-coordination-branch >/dev/null
git fetch origin "$base_branch" >/dev/null
base_sha="$(git rev-parse "origin/$base_branch")"
claim_id="$(uuidgen 2>/dev/null || node -e 'console.log(crypto.randomUUID())')"
lease_until="$(node -e 'const hours=Number(process.env.OPENSPEC_BUDDY_CLAIM_TTL_HOURS); console.log(new Date(Date.now()+hours*3600*1000).toISOString())')"

buddy_preflight_claim_truth_check "$issue_number" "$change_id" "$claim_branch" "$viewer" "$repo_nwo" "$tmp_dir/preflight-before-lock"
claim_lock_written=1
buddy_write_minimal_claim_lock "$issue_number" "$change_id" "$claim_branch" "$base_branch" "$base_sha" "$viewer" "$claim_id" "$lease_until" "$issue_file" "$tmp_dir/adopted-body.md" true
buddy_verify_claim_lock_rest "$issue_number" "$change_id" "$viewer" "$claim_id" "$lease_until" "$repo_nwo" "$tmp_dir/verify-lock" "$claim_branch"
"$script_dir/verify-claim-worktree.sh" --issue "$issue_number" --allow-coordination-branch >/dev/null
buddy_worktree_record_claim "$cache_dir" "$issue_number" "$change_id" "$claim_branch" "$claim_id" "$base_branch"

if ! run_claim_triage_gate "$issue_number" "$change_id" "$base_branch" "$claim_branch"; then
  exit 1
fi
claim_completed=1
exec "$script_dir/claim-change.sh" "$issue_number" --resume-active

buddy_invalidate_issue_cache "$cache_dir" "$issue_number"
buddy_invalidate_ready_scan_cache "$cache_dir"

gh issue develop "$issue_number" --name "$claim_branch" --base "$base_branch" >/dev/null
created_branch_lock="$claim_branch"
if ! git ls-remote --exit-code --heads origin "$claim_branch" >/dev/null 2>&1; then
  echo "gh issue develop did not create remote branch: $claim_branch" >&2
  exit 1
fi
linked_branches="$(gh issue develop --list "$issue_number" 2>/dev/null || true)"
if [[ "$linked_branches" != *"$claim_branch"* ]]; then
  echo "gh issue develop created $claim_branch, but the issue Development branch list did not show it." >&2
  exit 1
fi

buddy_verify_claim_lock_rest "$issue_number" "$change_id" "$viewer" "$claim_id" "$lease_until" "$repo_nwo" "$tmp_dir/verify-after-development-link" "$claim_branch"
"$script_dir/verify-claim-worktree.sh" --issue "$issue_number" --allow-coordination-branch >/dev/null

created_branch_lock=""
"$script_dir/set-project-status.sh" "$issue_number" "status:claimed"
"$script_dir/set-project-date.sh" "$issue_number" "Start" "$(date +%F)"
claim_completed=1
buddy_signal_publish claim "issue:$issue_number" "ready-scan" "project"
printf 'Claimed open issue #%s for change %s on branch %s with claim %s\n' "$issue_number" "$change_id" "$claim_branch" "$claim_id"
