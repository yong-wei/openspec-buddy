#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: find-issue-pr.sh <issue-number>"
  exit 0
fi

issue_number="${1:-}"
if [[ -z "$issue_number" ]]; then
  echo "Usage: find-issue-pr.sh <issue-number>" >&2
  exit 2
fi
if [[ ! "$issue_number" =~ ^[0-9]+$ ]]; then
  echo "Issue number must be numeric." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
source "$script_dir/claim-lock.sh"
openspec_buddy_require_core_config

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cache_dir="$(buddy_cache_dir "$tmp_dir/gh-cache")"
repo_nwo="$(buddy_repo_nwo)"
owner="${repo_nwo%%/*}"

issue_file="$tmp_dir/issue.json"
body_file="$tmp_dir/body.md"
metadata_file="$tmp_dir/metadata.json"
comments_file="$tmp_dir/comments.json"
active_file="$tmp_dir/active-claim.json"
branches_file="$tmp_dir/branches.txt"
prs_file="$tmp_dir/prs.json"

buddy_issue_json "$issue_number" "$cache_dir" "$issue_file"
node -e 'const fs=require("node:fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$body_file"

if node "$script_dir/parse-issue-metadata.mjs" "$body_file" > "$metadata_file" 2>/dev/null; then
  node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (data.claim_branch) console.log(data.claim_branch);' "$metadata_file" >> "$branches_file"
fi

buddy_claim_comments_rest "$repo_nwo" "$issue_number" "$comments_file" || true
buddy_claim_active_comment_to_file "$comments_file" "$active_file" || true
node -e '
const fs = require("node:fs");
const file = process.argv[1];
if (!fs.existsSync(file)) process.exit(0);
const active = JSON.parse(fs.readFileSync(file, "utf8"));
if (active?.branch) console.log(active.branch);
if (active?.change_id) console.log(active.change_id);
' "$active_file" >> "$branches_file"

mapfile -t branches < <(sort -u "$branches_file" 2>/dev/null | sed '/^$/d')
if [[ "${#branches[@]}" -eq 0 ]]; then
  printf '{"issue":%s,"pr":null,"reason":"no claim branch evidence"}\n' "$issue_number"
  exit 0
fi

printf '[]\n' > "$prs_file"
branch=""
for branch in "${branches[@]}"; do
  branch_key="$(printf '%s' "$branch" | node -e 'const fs=require("node:fs"); process.stdout.write(Buffer.from(fs.readFileSync(0)).toString("hex"));')"
  branch_prs="$tmp_dir/prs-$branch_key.json"
  gh api "repos/$repo_nwo/pulls?state=all&head=$owner:$branch&per_page=20" > "$branch_prs"
  node -e '
const fs = require("node:fs");
const [combinedFile, branchFile] = process.argv.slice(1);
const combined = JSON.parse(fs.readFileSync(combinedFile, "utf8"));
const next = JSON.parse(fs.readFileSync(branchFile, "utf8"));
fs.writeFileSync(combinedFile, `${JSON.stringify(combined.concat(next))}\n`);
' "$prs_file" "$branch_prs"
done

node -e '
const fs = require("node:fs");
const [prsFile, issueNumber] = process.argv.slice(1);
const issue = Number(issueNumber);
const prs = JSON.parse(fs.readFileSync(prsFile, "utf8"));

function bodyMatches(pr) {
  const body = String(pr.body || "");
  return new RegExp(`openspec-buddy-origin-issue:${issue}(?![0-9])`, "i").test(body)
    || new RegExp(`Origin issue:\\s*#${issue}(?![0-9])`, "i").test(body);
}

const exact = prs
  .filter((pr) => bodyMatches(pr))
  .sort((left, right) => Number(right.number || 0) - Number(left.number || 0))[0];

if (!exact) {
  process.stdout.write(`${JSON.stringify({ issue, pr: null, reason: "no exact issue-bound PR" })}\n`);
  process.exit(0);
}

const state = String(exact.state || "").toUpperCase();
const merged = Boolean(exact.merged || exact.merged_at);
if (state !== "OPEN") {
  process.stdout.write(`${JSON.stringify({
    issue,
    pr: merged ? (exact.number || null) : null,
    reason: merged ? `exact issue-bound PR #${exact.number} is already merged` : `exact issue-bound PR #${exact.number} is not open`,
    closedPr: exact.number || null,
    state,
    merged,
    head: exact.head?.sha || "",
    headRefName: exact.head?.ref || "",
    url: exact.html_url || "",
  })}\n`);
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({
  issue,
  pr: exact.number || null,
  head: exact.head?.sha || "",
  state,
  headRefName: exact.head?.ref || "",
  url: exact.html_url || "",
})}\n`);
' "$prs_file" "$issue_number"
