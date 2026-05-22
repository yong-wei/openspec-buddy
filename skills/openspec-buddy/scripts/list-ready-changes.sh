#!/usr/bin/env bash
set -euo pipefail

gh issue list \
  --state open \
  --label "status:ready" \
  --limit "${1:-50}" \
  --json number,title,labels,assignees,url
