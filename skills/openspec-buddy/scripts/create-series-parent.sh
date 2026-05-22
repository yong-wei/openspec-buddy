#!/usr/bin/env bash
set -euo pipefail

series="${1:-}"
title="${2:-}"

if [[ -z "$series" ]]; then
  echo "Usage: create-series-parent.sh <series-name> [title]" >&2
  exit 2
fi

if [[ -z "$title" ]]; then
  title="OpenSpec series: $series"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  gh label create "$name" --color "$color" --description "$description" >/dev/null 2>&1 || true
}

ensure_label "type:series-parent" "6f42c1" "OpenSpec Buddy parent issue for a change series"
ensure_label "status:tracking" "bfdadc" "Tracking issue that should not be claimed"
ensure_label "series:$series" "c5def5" "OpenSpec Buddy series $series"

body="$(cat <<EOF
---
issue_role: series-parent
series: $series
---

## Series Scope

This parent issue tracks the OpenSpec change series \`$series\`.

## Child Changes

Child issues are linked through GitHub sub-issues. This parent issue is not an executable OpenSpec change and must not be claimed.
EOF
)"

issue_url="$(gh issue create \
  --title "$title" \
  --body "$body" \
  --label "type:series-parent" \
  --label "status:tracking" \
  --label "series:$series")"

"$script_dir/add-issue-to-project.sh" "$issue_url"
printf '%s\n' "$issue_url"
