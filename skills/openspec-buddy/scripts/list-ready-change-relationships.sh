#!/usr/bin/env bash
set -euo pipefail

limit="${1:-100}"
repo="$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')"
owner="${repo%%/*}"
name="${repo#*/}"

gh api graphql \
  -f query='
query($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: $limit, states: OPEN, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        id
        number
        title
        url
        state
        body
        labels(first: 40) { nodes { name } }
        parent { number title url state labels(first: 40) { nodes { name } } }
        blockedBy(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
        blocking(first: 40) { nodes { number title url state labels(first: 40) { nodes { name } } } }
      }
    }
  }
}' \
  -f owner="$owner" \
  -f name="$name" \
  -F limit="$limit" \
  --jq '{issues: .data.repository.issues.nodes}'
