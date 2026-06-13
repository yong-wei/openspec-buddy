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
# shellcheck source=./cache-signal.sh
source "$script_dir/cache-signal.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cache_dir="$(buddy_cache_dir)"

issue_file="$tmp_dir/issue.json"
parent_file="$tmp_dir/parent.json"
project_file="$tmp_dir/project.json"
repo_nwo="$(buddy_repo_nwo)"
buddy_signal_apply "$cache_dir" "$repo_nwo"

issue_id="$(gh issue view -R "$repo_nwo" "$issue_ref" --json id --jq '.id')"

buddy_graphql_api \
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

openspec_buddy_require_core_config
project_title="$OPENSPEC_BUDDY_PROJECT_TITLE"
done_option_name="$OPENSPEC_BUDDY_PROJECT_STATUS_DONE"
status_field_name="$OPENSPEC_BUDDY_PROJECT_STATUS_FIELD"
end_field_name="$OPENSPEC_BUDDY_PROJECT_END_FIELD"
buddy_project_metadata_json "$cache_dir" "$project_file"
project_id="$(node -e 'const fs=require("node:fs"); const project=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(project.id || "");' "$project_file")"

if [[ -z "$project_id" ]]; then
  echo "Could not resolve project id for \"$project_title\"." >&2
  exit 1
fi

buddy_graphql_api \
  -f id="$parent_id" \
  -f statusField="$status_field_name" \
  -f endField="$end_field_name" \
  -f query='
query($id: ID!, $statusField: String!, $endField: String!) {
  node(id: $id) {
    ... on Issue {
      id
      number
      title
      state
      url
      labels(first: 50) { nodes { name } }
      projectItems(first: 50) {
        nodes {
          id
          project { id title }
          status: fieldValueByName(name: $statusField) {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          end: fieldValueByName(name: $endField) {
            ... on ProjectV2ItemFieldDateValue { date }
          }
        }
      }
      subIssues(first: 100) {
        nodes {
          number
          title
          state
          url
          labels(first: 50) { nodes { name } }
          projectItems(first: 50) {
            nodes {
              id
              project { id title }
              status: fieldValueByName(name: $statusField) {
                ... on ProjectV2ItemFieldSingleSelectValue { name }
              }
              end: fieldValueByName(name: $endField) {
                ... on ProjectV2ItemFieldDateValue { date }
              }
            }
          }
        }
      }
    }
  }
}' > "$parent_file"

summary="$(node -e '
const fs = require("fs");
const parent = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).data.node;
const projectTitle = process.argv[2];
const doneOptionName = process.argv[3];
const projectId = process.argv[4];
const children = parent.subIssues?.nodes || [];
const parentLabels = (parent.labels?.nodes || []).map((entry) => entry.name);
function projectItem(issue) {
  return (issue.projectItems?.nodes || []).find((item) => item?.project?.id === projectId && item?.project?.title === projectTitle) || null;
}
function terminalState(issue) {
  const labels = (issue.labels?.nodes || []).map((entry) => entry.name);
  const item = projectItem(issue);
  const projectDone = item?.status?.name === doneOptionName;
  const hasEnd = Boolean(item?.end?.date);
  const archived = labels.includes("status:archived");
  const closed = issue.state === "CLOSED";
  return { labels, projectDone, hasEnd, archived, closed };
}
if (!parentLabels.includes("type:series-parent")) {
  console.error(`Issue #${parent.number} is not a series parent.`);
  process.exit(2);
}
if (children.length === 0) {
  console.log(JSON.stringify({ action: "skip", reason: `Series parent #${parent.number} has no child issues.` }));
  process.exit(0);
}
const childStates = children.map((child) => ({ child, terminal: terminalState(child) }));
const repairableDrift = childStates.filter(({ terminal }) => terminal.closed && terminal.projectDone && terminal.hasEnd && !terminal.archived);
if (repairableDrift.length > 0) {
  console.log(JSON.stringify({
    action: "drift",
    reason: `Series parent #${parent.number} has repairable terminal drift in child issue(s): ${repairableDrift.map(({ child }) => `#${child.number}`).join(", ")}. These child issues are closed with Project Done and End set, but are missing status:archived.`,
  }));
  process.exit(0);
}
const incomplete = childStates
  .filter(({ terminal }) => !terminal.closed || !terminal.archived || !terminal.projectDone || !terminal.hasEnd)
  .map(({ child }) => child);
if (incomplete.length > 0) {
  console.log(JSON.stringify({
    action: "skip",
    reason: `Series parent #${parent.number} still has unfinished child issues: ${incomplete.map((child) => `#${child.number}`).join(", ")}.`,
  }));
  process.exit(0);
}
const parentTerminal = terminalState(parent);
if (parent.state !== "OPEN" && parentTerminal.archived && parentTerminal.projectDone && parentTerminal.hasEnd) {
  console.log(JSON.stringify({ action: "skip", reason: `Series parent #${parent.number} is already finalized.` }));
  process.exit(0);
}
const childLines = children.map((child) => `- #${child.number} ${child.title}`);
console.log(JSON.stringify({
  action: "finalize",
  parentNumber: parent.number,
  parentUrl: parent.url,
  body: `OpenSpec series completed. All child changes are closed with \`status:archived\`, Project \`Done\`, and Project \`End\` set.\n\nArchived child changes:\n${childLines.join("\n")}`,
}));
' "$parent_file" "$project_title" "$done_option_name" "$project_id")"

action="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.action);' "$summary")"

if [[ "$action" == "skip" ]]; then
  node -e 'const data = JSON.parse(process.argv[1]); console.log(data.reason);' "$summary"
  exit 0
fi

if [[ "$action" == "drift" ]]; then
  node -e 'const data = JSON.parse(process.argv[1]); console.error(data.reason);' "$summary"
  exit 1
fi

parent_number="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(String(data.parentNumber));' "$summary")"
body="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.body);' "$summary")"

OPENSPEC_BUDDY_SKIP_SIGNAL_PUBLISH=1 "$script_dir/set-status-label.sh" "$parent_number" "status:archived"
"$script_dir/set-project-date.sh" "$parent_number" "End" "$(date +%F)"

state="$(gh issue view -R "$repo_nwo" "$parent_number" --json state --jq '.state')"
if [[ "$state" == "OPEN" ]]; then
  gh issue close -R "$repo_nwo" "$parent_number" --comment "$body"
else
  gh issue comment -R "$repo_nwo" "$parent_number" --body "$body"
fi

buddy_invalidate_issue_cache "$cache_dir" "$parent_number"
buddy_invalidate_ready_scan_cache "$cache_dir"
buddy_signal_publish close-series-parent "issue:$parent_number" "ready-scan" "project"
echo "Series parent #$parent_number finalized."
