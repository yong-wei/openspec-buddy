#!/usr/bin/env bash
set -euo pipefail

issue_ref="${1:-}"
if [[ -z "$issue_ref" ]]; then
  echo "Usage: close-completed-series-parent.sh <child-or-parent-issue-number-or-url>" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/load-config.sh"
# shellcheck source=./github-fetch.sh
source "$script_dir/github-fetch.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

issue_file="$tmp_dir/issue.json"
parent_file="$tmp_dir/parent.json"
repo_nwo="$(buddy_repo_nwo)"

issue_id="$(gh issue view -R "$repo_nwo" "$issue_ref" --json id --jq '.id')"

gh api graphql \
  -f id="$issue_id" \
  -f query='
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      id
      number
      title
      state
      url
      labels(first: 50) { nodes { name } }
      parent {
        id
        number
        title
        state
        url
        labels(first: 50) { nodes { name } }
      }
    }
  }
}' > "$issue_file"

parent_id="$(node -e '
const fs = require("fs");
const issue = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).data.node;
const labels = (issue.labels?.nodes || []).map((entry) => entry.name);
if (labels.includes("type:series-parent")) {
  process.stdout.write(issue.id);
  process.exit(0);
}
const parent = issue.parent;
const parentLabels = (parent?.labels?.nodes || []).map((entry) => entry.name);
if (parent && parentLabels.includes("type:series-parent")) {
  process.stdout.write(parent.id);
}
' "$issue_file")"

if [[ -z "$parent_id" ]]; then
  echo "No series parent found for $issue_ref."
  exit 0
fi

gh api graphql \
  -f id="$parent_id" \
  -f query='
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      id
      number
      title
      state
      url
      labels(first: 50) { nodes { name } }
      subIssues(first: 100) {
        nodes {
          number
          title
          state
          url
          labels(first: 50) { nodes { name } }
        }
      }
    }
  }
}' > "$parent_file"

summary="$(node -e '
const fs = require("fs");
const parent = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).data.node;
const children = parent.subIssues?.nodes || [];
const parentLabels = (parent.labels?.nodes || []).map((entry) => entry.name);
if (!parentLabels.includes("type:series-parent")) {
  console.error(`Issue #${parent.number} is not a series parent.`);
  process.exit(2);
}
if (children.length === 0) {
  console.log(JSON.stringify({ action: "skip", reason: `Series parent #${parent.number} has no child issues.` }));
  process.exit(0);
}
const incomplete = children.filter((child) => {
  const labels = (child.labels?.nodes || []).map((entry) => entry.name);
  return child.state !== "CLOSED" || !labels.includes("status:archived");
});
if (incomplete.length > 0) {
  console.log(JSON.stringify({
    action: "skip",
    reason: `Series parent #${parent.number} still has unfinished child issues: ${incomplete.map((child) => `#${child.number}`).join(", ")}.`,
  }));
  process.exit(0);
}
if (parent.state !== "OPEN" && parentLabels.includes("status:archived")) {
  console.log(JSON.stringify({ action: "skip", reason: `Series parent #${parent.number} is already finalized.` }));
  process.exit(0);
}
const childLines = children.map((child) => `- #${child.number} ${child.title}`);
console.log(JSON.stringify({
  action: "finalize",
  parentNumber: parent.number,
  parentUrl: parent.url,
  body: `OpenSpec series completed. All child changes are closed with \`status:archived\`.\n\nArchived child changes:\n${childLines.join("\n")}`,
}));
' "$parent_file")"

action="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.action);' "$summary")"

if [[ "$action" == "skip" ]]; then
  node -e 'const data = JSON.parse(process.argv[1]); console.log(data.reason);' "$summary"
  exit 0
fi

parent_number="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(String(data.parentNumber));' "$summary")"
body="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.body);' "$summary")"

"$script_dir/set-status-label.sh" "$parent_number" "status:archived"
"$script_dir/set-project-date.sh" "$parent_number" "End" "$(date +%F)"

state="$(gh issue view -R "$repo_nwo" "$parent_number" --json state --jq '.state')"
if [[ "$state" == "OPEN" ]]; then
  gh issue close -R "$repo_nwo" "$parent_number" --comment "$body"
else
  gh issue comment -R "$repo_nwo" "$parent_number" --body "$body"
fi

echo "Series parent #$parent_number finalized."
