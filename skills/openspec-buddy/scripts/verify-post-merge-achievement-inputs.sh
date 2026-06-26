#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: verify-post-merge-achievement-inputs.sh <issue-number> <archive-path> <pr-number-or-url>"
  exit 0
fi

issue_number="${1:-}"
archive_path="${2:-}"
pr_ref="${3:-}"
if [[ -z "$issue_number" || -z "$archive_path" || -z "$pr_ref" ]]; then
  echo "Usage: verify-post-merge-achievement-inputs.sh <issue-number> <archive-path> <pr-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
source "$script_dir/github-fetch.sh"
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

bound_base_ref() {
  git config --worktree --get buddy.boundBase 2>/dev/null || printf 'origin/%s\n' "$OPENSPEC_BUDDY_BASE_BRANCH"
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

verify_bound_helper="${OPENSPEC_BUDDY_VERIFY_BOUND_WORKTREE_HELPER:-$script_dir/verify-bound-worktree.sh}"
"$verify_bound_helper" --phase post-merge >/dev/null

pr_number="$(resolve_pr_number "$pr_ref")"
repo_nwo="$(buddy_repo_nwo)"
pr_file="$tmp_dir/pr.json"
issue_file="$tmp_dir/issue.json"
issue_body_file="$tmp_dir/issue-body.md"
metadata_file="$tmp_dir/metadata.json"
gh api "repos/$repo_nwo/pulls/$pr_number" > "$pr_file"

node -e '
const fs = require("node:fs");
const [file, issueNumber] = process.argv.slice(1);
const pr = JSON.parse(fs.readFileSync(file, "utf8"));
if (!pr.merged_at) {
  process.stderr.write(`PR #${pr.number || ""} is not merged.\n`);
  process.exit(1);
}
const body = String(pr.body || "");
const marker = body.match(/openspec-buddy-origin-issue:([0-9]+)/i);
const line = body.match(/Origin issue:\s*#([0-9]+)/i);
const origin = marker?.[1] || line?.[1] || "";
if (!origin) {
  process.stderr.write(`PR #${pr.number || ""} does not record an OpenSpec Buddy origin issue.\n`);
  process.exit(1);
}
if (origin !== String(issueNumber)) {
  process.stderr.write(`PR origin issue #${origin} does not match issue #${issueNumber}.\n`);
  process.exit(1);
}
' "$pr_file" "$issue_number"

bound_base="$(bound_base_ref)"
if ! git cat-file -e "$bound_base:$archive_path/tasks.md" 2>/dev/null; then
  echo "Archive tasks file does not exist on $bound_base: $archive_path/tasks.md" >&2
  exit 1
fi

if git show "$bound_base:$archive_path/tasks.md" | grep -E '^\s*-\s+\[\s\]' >/dev/null; then
  echo "Archived tasks.md still contains unchecked tasks: $archive_path/tasks.md" >&2
  exit 1
fi

buddy_issue_json "$issue_number" "$tmp_dir/gh-cache" "$issue_file"
node -e 'const fs=require("node:fs"); const issue=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(issue.body || "");' "$issue_file" > "$issue_body_file"
node "$script_dir/parse-issue-metadata.mjs" "$issue_body_file" > "$metadata_file"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const [metadataFile, archivePath] = process.argv.slice(1);
const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
const changeId = String(metadata.change_id || "");
const basename = path.basename(archivePath);
const escaped = changeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (!changeId) {
  process.stderr.write("Issue metadata is missing change_id; cannot verify archive path.\n");
  process.exit(1);
}
if (basename !== changeId && !new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`).test(basename)) {
  process.stderr.write(`Archive path ${archivePath} does not match issue change_id ${changeId}.\n`);
  process.exit(1);
}
' "$metadata_file" "$archive_path"

printf 'Post-merge achievement inputs verified for issue #%s and PR #%s.\n' "$issue_number" "$pr_number"
