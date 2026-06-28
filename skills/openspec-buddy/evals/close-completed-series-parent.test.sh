#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
tmp_dir="$(mktemp -d)"
project_root="$tmp_dir/project"
mkdir -p "$project_root"
trap 'rm -rf "$tmp_dir"' EXIT

(
  cd "$project_root"
  git init -q
  git remote add origin https://github.com/owner/repo.git
)

cat > "$tmp_dir/gh" <<'EOF'
#!/bin/bash
set -euo pipefail

printf '%s\n' "$*" >> "$GH_LOG_FILE"

if [[ "$1" == "repo" && "$2" == "view" ]]; then
  printf 'owner/repo\n'
  exit 0
fi

if [[ "$1" == "api" && "$2" == "rate_limit" ]]; then
  cat <<'JSON'
{"remaining":1000,"resetAt":"2026-06-12T00:30:00Z"}
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "view" ]]; then
  ref=""
  previous=""
  for arg in "$@"; do
    if [[ "$previous" == "-R" ]]; then
      previous=""
      continue
    fi
    if [[ "$arg" =~ ^[0-9]+$ ]]; then
      ref="$arg"
    fi
    previous="$arg"
  done
  if [[ "$*" == *"--json id"* && "$*" == *"--jq .id"* ]]; then
    printf 'ISSUE_%s\n' "$ref"
    exit 0
  fi
  if [[ "$*" == *"--json state"* && "$*" == *"labels"* ]]; then
    if [[ -f "$STATE_DIR/closed-$ref" ]]; then
      printf '%s\n' '{"state":"CLOSED","labels":[{"name":"status:archived"},{"name":"type:series-parent"}]}'
    else
      printf '%s\n' '{"state":"OPEN","labels":[{"name":"status:archived"},{"name":"type:series-parent"}]}'
    fi
    exit 0
  fi
  if [[ "$*" == *"--json state"* ]]; then
    if [[ -f "$STATE_DIR/closed-$ref" ]]; then
      printf 'CLOSED\n'
    else
      printf 'OPEN\n'
    fi
    exit 0
  fi
  if [[ "$*" == *"--json labels"* && "$*" != *"body"* ]]; then
    if [[ -f "$STATE_DIR/status-archived-$ref" ]]; then
      printf '%s\n' '{"labels":[{"name":"status:archived"},{"name":"type:series-parent"}]}'
    else
      printf '%s\n' '{"labels":[{"name":"status:tracking"},{"name":"type:series-parent"}]}'
    fi
    exit 0
  fi
  cat <<JSON
{"id":"ISSUE_$ref","number":$ref,"url":"https://github.com/owner/repo/issues/$ref","state":"OPEN","labels":[{"name":"status:tracking"},{"name":"type:series-parent"}],"projectItems":[{"id":"ITEM_$ref","title":"Major LTE","status":{"name":"Todo"}}]}
JSON
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "list" ]]; then
  cat <<'JSON'
[{"number":100,"title":"Parent","state":"OPEN","labels":[{"name":"type:series-parent"},{"name":"status:tracking"}]}]
JSON
  exit 0
fi

if [[ "$1" == "api" && "$2" == "graphql" ]]; then
  id=""
  previous=""
  for arg in "$@"; do
    if [[ "$previous" == "-f" && "$arg" == id=* ]]; then
      id="${arg#id=}"
    fi
    previous="$arg"
  done
  if [[ "$id" == ITEM_* ]]; then
    date_value="$(cat "$STATE_DIR/date-$id" 2>/dev/null || true)"
    status_option="$(cat "$STATE_DIR/status-$id" 2>/dev/null || true)"
    case "$status_option" in
      OPT_TODO) status_name="Todo" ;;
      OPT_PROGRESS) status_name="In Progress" ;;
      OPT_DONE) status_name="Done" ;;
      *) status_name="" ;;
    esac
    cat <<JSON
{"data":{"node":{"id":"$id","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"$status_name"},"date":{"date":"$date_value"}}}}
JSON
    exit 0
  fi
  if [[ "$id" == "ISSUE_101" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ISSUE_101","number":101,"title":"Child 101","state":"CLOSED","url":"https://github.com/owner/repo/issues/101","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"parent":{"id":"ISSUE_100","number":100,"title":"Parent","state":"OPEN","url":"https://github.com/owner/repo/issues/100","labels":{"nodes":[{"name":"type:series-parent"},{"name":"status:tracking"}]}}}}}
JSON
    exit 0
  fi
  if [[ "$id" == "ISSUE_100" && "${SERIES_SCENARIO:-complete}" == "drift" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ISSUE_100","number":100,"title":"Parent","state":"OPEN","url":"https://github.com/owner/repo/issues/100","labels":{"nodes":[{"name":"type:series-parent"},{"name":"status:tracking"}]},"projectItems":{"nodes":[{"id":"ITEM_100","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Todo"},"end":null}]},"subIssues":{"nodes":[{"number":101,"title":"Child 101","state":"CLOSED","url":"https://github.com/owner/repo/issues/101","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"projectItems":{"nodes":[{"id":"ITEM_101","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}}]}},{"number":102,"title":"Child 102","state":"CLOSED","url":"https://github.com/owner/repo/issues/102","labels":{"nodes":[{"name":"type:change"}]},"projectItems":{"nodes":[{"id":"ITEM_102","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}}]}}]}}}}
JSON
    exit 0
  fi
  if [[ "$id" == "ISSUE_100" && "${SERIES_SCENARIO:-complete}" == "project-incomplete" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ISSUE_100","number":100,"title":"Parent","state":"OPEN","url":"https://github.com/owner/repo/issues/100","labels":{"nodes":[{"name":"type:series-parent"},{"name":"status:tracking"}]},"projectItems":{"nodes":[{"id":"ITEM_100","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Todo"},"end":null}]},"subIssues":{"nodes":[{"number":101,"title":"Child 101","state":"CLOSED","url":"https://github.com/owner/repo/issues/101","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"projectItems":{"nodes":[{"id":"ITEM_101","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}}]}},{"number":102,"title":"Child 102","state":"CLOSED","url":"https://github.com/owner/repo/issues/102","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"projectItems":{"nodes":[{"id":"ITEM_102","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Todo"},"end":null}]}}]}}}}
JSON
    exit 0
  fi
  if [[ "$id" == "ISSUE_100" ]]; then
    cat <<'JSON'
{"data":{"node":{"id":"ISSUE_100","number":100,"title":"Parent","state":"OPEN","url":"https://github.com/owner/repo/issues/100","labels":{"nodes":[{"name":"type:series-parent"},{"name":"status:tracking"}]},"projectItems":{"nodes":[{"id":"ITEM_WRONG_PARENT","project":{"id":"PROJECT_OTHER","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}},{"id":"ITEM_100","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Todo"},"end":null}]},"subIssues":{"nodes":[{"number":101,"title":"Child 101","state":"CLOSED","url":"https://github.com/owner/repo/issues/101","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"projectItems":{"nodes":[{"id":"ITEM_WRONG_101","project":{"id":"PROJECT_OTHER","title":"Major LTE"},"status":{"name":"Todo"},"end":null},{"id":"ITEM_101","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}}]}},{"number":102,"title":"Child 102","state":"CLOSED","url":"https://github.com/owner/repo/issues/102","labels":{"nodes":[{"name":"type:change"},{"name":"status:archived"}]},"projectItems":{"nodes":[{"id":"ITEM_WRONG_102","project":{"id":"PROJECT_OTHER","title":"Major LTE"},"status":{"name":"Todo"},"end":null},{"id":"ITEM_102","project":{"id":"PROJECT_1","title":"Major LTE"},"status":{"name":"Done"},"end":{"date":"2026-06-13"}}]}}]}}}}
JSON
    exit 0
  fi
  echo "unexpected graphql id: $id" >&2
  exit 1
fi

if [[ "$1" == "project" && "$2" == "view" ]]; then
  printf '%s\n' '{"id":"PROJECT_1","title":"Major LTE"}'
  exit 0
fi

if [[ "$1" == "project" && "$2" == "field-list" ]]; then
  cat <<'JSON'
{"fields":[{"id":"FIELD_STATUS","name":"Status","options":[{"id":"OPT_TODO","name":"Todo"},{"id":"OPT_PROGRESS","name":"In Progress"},{"id":"OPT_DONE","name":"Done"}]},{"id":"FIELD_START","name":"Start","type":"ProjectV2Field"},{"id":"FIELD_END","name":"End","type":"ProjectV2Field"}]}
JSON
  exit 0
fi

if [[ "$1" == "project" && "$2" == "item-edit" ]]; then
  item_id=""
  status_option=""
  date_value=""
  previous=""
  for arg in "$@"; do
    if [[ "$previous" == "--id" ]]; then item_id="$arg"; fi
    if [[ "$previous" == "--single-select-option-id" ]]; then status_option="$arg"; fi
    if [[ "$previous" == "--date" ]]; then date_value="$arg"; fi
    previous="$arg"
  done
  if [[ -n "$item_id" ]]; then
    mkdir -p "$STATE_DIR"
    [[ -n "$status_option" ]] && printf '%s\n' "$status_option" > "$STATE_DIR/status-$item_id"
    [[ -n "$date_value" ]] && printf '%s\n' "$date_value" > "$STATE_DIR/date-$item_id"
  fi
  printf '"ITEM_100"\n'
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "edit" ]]; then
  touch "$STATE_DIR/status-archived-100"
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "close" ]]; then
  if [[ "${CLOSE_VERIFY_MODE:-ok}" != "stale" ]]; then
    close_ref=""
    previous=""
    for arg in "$@"; do
      if [[ "$previous" == "-R" ]]; then
        previous=""
        continue
      fi
      if [[ "$arg" =~ ^[0-9]+$ ]]; then
        close_ref="$arg"
      fi
      previous="$arg"
    done
    touch "$STATE_DIR/closed-$close_ref"
  fi
  exit 0
fi

if [[ "$1" == "issue" && "$2" == "comment" ]]; then
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
EOF
chmod +x "$tmp_dir/gh"

export PATH="$tmp_dir:$PATH"
export GH_LOG_FILE="$tmp_dir/gh.log"
export STATE_DIR="$tmp_dir/state"
mkdir -p "$STATE_DIR"
export OPENSPEC_BUDDY_REPO_ROOT="$project_root"
export OPENSPEC_BUDDY_BASE_BRANCH=integration
export OPENSPEC_BUDDY_RELEASE_BRANCH=main
export OPENSPEC_BUDDY_PROJECT_OWNER=owner
export OPENSPEC_BUDDY_PROJECT_NUMBER=1
export OPENSPEC_BUDDY_PROJECT_TITLE="Major LTE"
export OPENSPEC_BUDDY_PROJECT_STATUS_FIELD=Status
export OPENSPEC_BUDDY_PROJECT_STATUS_TODO=Todo
export OPENSPEC_BUDDY_PROJECT_STATUS_IN_PROGRESS="In Progress"
export OPENSPEC_BUDDY_PROJECT_STATUS_DONE=Done
export OPENSPEC_BUDDY_PROJECT_START_FIELD=Start
export OPENSPEC_BUDDY_PROJECT_END_FIELD=End
export OPENSPEC_BUDDY_DISABLE_SIGNAL=1

set +e
SERIES_SCENARIO=drift "$repo_root/skills/openspec-buddy/scripts/close-completed-series-parent.sh" 101 >"$tmp_dir/drift.out" 2>"$tmp_dir/drift.err"
drift_status="$?"
set -e
if [[ "$drift_status" -ne 0 ]]; then
  echo "close-completed-series-parent.sh should not fail child closeout because a sibling has terminal drift" >&2
  cat "$tmp_dir/drift.out" "$tmp_dir/drift.err" >&2
  exit 1
fi
if ! grep -F 'sibling terminal drift outside current issue: #102' "$tmp_dir/drift.out" >/dev/null; then
  echo "expected sibling drift skip diagnostic" >&2
  cat "$tmp_dir/drift.out" "$tmp_dir/drift.err" >&2
  exit 1
fi
if grep -F 'issue close' "$GH_LOG_FILE" >/dev/null; then
  echo "series parent should not be closed while child drift remains" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
set +e
SERIES_SCENARIO=drift "$repo_root/skills/openspec-buddy/scripts/close-completed-series-parent.sh" 100 >"$tmp_dir/parent-drift.out" 2>"$tmp_dir/parent-drift.err"
parent_drift_status="$?"
set -e
if [[ "$parent_drift_status" -eq 0 ]]; then
  echo "close-completed-series-parent.sh should fail parent reconciliation on repairable child terminal drift" >&2
  exit 1
fi
if ! grep -F 'repairable terminal drift' "$tmp_dir/parent-drift.err" >/dev/null; then
  echo "expected parent reconciliation drift diagnostic" >&2
  cat "$tmp_dir/parent-drift.out" "$tmp_dir/parent-drift.err" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
SERIES_SCENARIO=project-incomplete "$repo_root/skills/openspec-buddy/scripts/close-completed-series-parent.sh" 101 >"$tmp_dir/project-incomplete.out"
if ! grep -F 'still has unfinished child issues: #102' "$tmp_dir/project-incomplete.out" >/dev/null; then
  echo "expected project-incomplete child to keep parent open" >&2
  cat "$tmp_dir/project-incomplete.out" >&2
  exit 1
fi
if grep -F 'issue close' "$GH_LOG_FILE" >/dev/null; then
  echo "series parent should not be closed while child Project Done/End is incomplete" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
rm -f "$STATE_DIR/closed-100" "$STATE_DIR/status-archived-100"
set +e
CLOSE_VERIFY_MODE=stale "$repo_root/skills/openspec-buddy/scripts/close-completed-series-parent.sh" 101 >"$tmp_dir/stale-close.out" 2>"$tmp_dir/stale-close.err"
stale_close_status="$?"
set -e
if [[ "$stale_close_status" -eq 0 ]]; then
  echo "close-completed-series-parent.sh should fail when close verification still observes an open parent" >&2
  exit 1
fi
if ! grep -F 'Issue close verification failed' "$tmp_dir/stale-close.err" >/dev/null; then
  echo "expected close verification diagnostic" >&2
  cat "$tmp_dir/stale-close.out" "$tmp_dir/stale-close.err" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
rm -f "$STATE_DIR/closed-100" "$STATE_DIR/status-archived-100"
"$repo_root/skills/openspec-buddy/scripts/close-completed-series-parent.sh" 101 >"$tmp_dir/complete.out"
if ! grep -F 'Series parent #100 finalized.' "$tmp_dir/complete.out" >/dev/null; then
  echo "expected completed parent finalization" >&2
  cat "$tmp_dir/complete.out" >&2
  exit 1
fi
if ! grep -F 'issue close -R owner/repo 100' "$GH_LOG_FILE" >/dev/null; then
  echo "expected parent issue close" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

: > "$GH_LOG_FILE"
"$repo_root/skills/openspec-buddy/scripts/reconcile-completed-series-parents.sh" >"$tmp_dir/reconcile.out"
if ! grep -F 'Series parent #100 finalized.' "$tmp_dir/reconcile.out" >/dev/null; then
  echo "expected reconcile to finalize completed parent" >&2
  cat "$tmp_dir/reconcile.out" >&2
  exit 1
fi
if ! grep -F 'issue list -R owner/repo --state open --label type:series-parent' "$GH_LOG_FILE" >/dev/null; then
  echo "expected reconcile to scan open series parents" >&2
  cat "$GH_LOG_FILE" >&2
  exit 1
fi

echo "close completed series parent tests passed"
