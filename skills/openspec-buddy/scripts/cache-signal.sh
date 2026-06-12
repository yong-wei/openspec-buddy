#!/usr/bin/env bash

cache_signal_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! declare -F buddy_cache_dir >/dev/null 2>&1; then
  # shellcheck source=./github-fetch.sh
  source "$cache_signal_script_dir/github-fetch.sh"
fi

buddy_signal_disabled() {
  [[ "${OPENSPEC_BUDDY_DISABLE_SIGNAL:-0}" == "1" || -z "${OPENSPEC_BUDDY_CACHE_SIGNAL_REF:-}" ]]
}

buddy_signal_short_ref() {
  printf '%s\n' "${OPENSPEC_BUDDY_CACHE_SIGNAL_REF#refs/}"
}

buddy_signal_ref_update_retryable() {
  local stderr_file="$1"
  grep -E '422|409|already exists|Reference update failed|fast[- ]forward|expected.*sha|not a fast forward' "$stderr_file" >/dev/null 2>&1
}

buddy_signal_lock_mtime() {
  local path="$1"
  node -e 'const fs=require("node:fs"); const value=fs.statSync(process.argv[1]).mtimeMs; process.stdout.write(String(Math.floor(value / 1000)));' "$path"
}

buddy_signal_acquire_publish_lock() {
  local lock_dir="$1"
  local ttl_seconds="${OPENSPEC_BUDDY_SIGNAL_LOCK_TTL_SECONDS:-120}"
  if ! [[ "$ttl_seconds" =~ ^[0-9]+$ ]]; then
    echo "OPENSPEC_BUDDY_SIGNAL_LOCK_TTL_SECONDS must be a non-negative integer." >&2
    return 2
  fi

  local started_at now mtime
  started_at="$(date +%s)"
  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [[ -d "$lock_dir" ]]; then
      mtime="$(buddy_signal_lock_mtime "$lock_dir" 2>/dev/null || printf '0\n')"
      now="$(date +%s)"
      if [[ "$mtime" =~ ^[0-9]+$ ]] && (( now - mtime >= ttl_seconds )); then
        rm -rf "$lock_dir"
        continue
      fi
      if (( ttl_seconds > 0 && now - started_at >= ttl_seconds )); then
        echo "Timed out waiting for cache signal publish lock: $lock_dir" >&2
        return 1
      fi
    fi
    sleep 1
  done
}

buddy_signal_ref_exists() {
  local repo_nwo="$1"
  gh api "repos/$repo_nwo/git/ref/$(buddy_signal_short_ref)" >/dev/null 2>&1
}

buddy_signal_fetch_tip_sha() {
  local repo_nwo="$1"
  gh api "repos/$repo_nwo/git/ref/$(buddy_signal_short_ref)" --jq '.object.sha'
}

buddy_signal_fetch_payload_for_tip() {
  local repo_nwo="$1"
  local tip_sha="$2"
  local output_file="$3"
  local commit_file tree_file blob_sha blob_file
  commit_file="$(mktemp)"
  tree_file="$(mktemp)"
  blob_file="$(mktemp)"

  gh api "repos/$repo_nwo/git/commits/$tip_sha" > "$commit_file"
  local tree_sha
  tree_sha="$(node -e 'const fs=require("node:fs"); const commit=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(commit.tree?.sha || "");' "$commit_file")"
  if [[ -z "$tree_sha" ]]; then
    rm -f "$commit_file" "$tree_file" "$blob_file"
    echo "Signal commit is missing tree SHA." >&2
    return 1
  fi
  gh api "repos/$repo_nwo/git/trees/$tree_sha" > "$tree_file"
  blob_sha="$(node -e '
const fs = require("node:fs");
const tree = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const entry = (tree.tree || []).find((item) => item.path === "signal.json");
process.stdout.write(entry?.sha || "");
' "$tree_file")"
  if [[ -z "$blob_sha" ]]; then
    rm -f "$commit_file" "$tree_file" "$blob_file"
    echo "Signal commit does not contain signal.json." >&2
    return 1
  fi
  gh api "repos/$repo_nwo/git/blobs/$blob_sha" > "$blob_file"
  node -e '
const fs = require("node:fs");
const blob = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const content = Buffer.from(String(blob.content || "").replace(/\n/g, ""), "base64").toString("utf8");
process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
' "$blob_file" > "$output_file"
  rm -f "$commit_file" "$tree_file" "$blob_file"
}

buddy_signal_apply_scopes_file() {
  local cache_dir="$1"
  local scopes_file="$2"
  while IFS= read -r scope; do
    [[ -n "$scope" ]] || continue
    case "$scope" in
      issue:*)
        buddy_invalidate_issue_cache "$cache_dir" "${scope#issue:}"
        ;;
      pr:*)
        buddy_invalidate_pr_cache "$cache_dir" "${scope#pr:}"
        ;;
      relationship:issue:*)
        buddy_invalidate_issue_relationship_cache "$cache_dir" "${scope#relationship:issue:}"
        ;;
      ready-scan)
        buddy_invalidate_ready_scan_cache "$cache_dir"
        ;;
      project)
        buddy_invalidate_project_cache "$cache_dir"
        ;;
    esac
  done < "$scopes_file"
}

buddy_signal_apply() {
  if buddy_signal_disabled; then
    return 0
  fi
  local cache_dir="${1:-}"
  cache_dir="$(buddy_cache_dir "$cache_dir")"
  local repo_nwo="${2:-}"
  repo_nwo="${repo_nwo:-$(buddy_repo_nwo)}"
  local state_file payload_cache_file
  state_file="$(buddy_signal_state_cache_file "$cache_dir")"
  payload_cache_file="$(buddy_signal_payload_cache_file "$cache_dir")"

  if ! buddy_signal_ref_exists "$repo_nwo"; then
    return 0
  fi

  local current_tip latest_tip
  current_tip="$(node -e 'const fs=require("node:fs"); if (!fs.existsSync(process.argv[1])) process.exit(0); const entry=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(entry.data?.tipSha || "");' "$state_file" 2>/dev/null || true)"
  latest_tip="$(buddy_signal_fetch_tip_sha "$repo_nwo")"
  if [[ -n "$current_tip" && "$current_tip" == "$latest_tip" ]]; then
    return 0
  fi

  local tmp_dir payload_file delta_file state_data_file scopes_file
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN
  payload_file="$tmp_dir/payload.json"
  delta_file="$tmp_dir/delta.json"
  state_data_file="$tmp_dir/state.json"
  scopes_file="$tmp_dir/scopes.txt"

  buddy_signal_fetch_payload_for_tip "$repo_nwo" "$latest_tip" "$payload_file"
  node "$cache_signal_script_dir/cache-signal-read.mjs" scopes "$state_file" "$payload_file" > "$delta_file"
  node -e 'const fs=require("node:fs"); const delta=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for (const scope of delta.scopes || []) process.stdout.write(`${scope}\n`);' "$delta_file" > "$scopes_file"
  buddy_signal_apply_scopes_file "$cache_dir" "$scopes_file"
  node "$cache_signal_script_dir/cache-signal-read.mjs" state "$repo_nwo" "$OPENSPEC_BUDDY_CACHE_SIGNAL_REF" "$latest_tip" "$payload_file" > "$state_data_file"
  buddy_cache_set_from_file "$state_file" signal signal-state state "$state_data_file"
  buddy_cache_set_from_file "$payload_cache_file" signal signal-payload payload "$payload_file"
}

buddy_signal_publish() {
  if buddy_signal_disabled; then
    return 0
  fi
  local kind="$1"
  shift
  local scopes=("$@")
  local cache_dir repo_nwo lock_dir tmp_dir previous_payload_file scopes_file payload_file
  cache_dir="$(buddy_cache_dir)"
  repo_nwo="$(buddy_repo_nwo)"
  lock_dir="$cache_dir/locks/signal-publish.lock.d"
  buddy_signal_acquire_publish_lock "$lock_dir"

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"; rmdir "$lock_dir" 2>/dev/null || true' RETURN
  previous_payload_file="$tmp_dir/previous.json"
  scopes_file="$tmp_dir/scopes.json"
  payload_file="$tmp_dir/payload.json"

  printf '%s\n' "${scopes[@]}" | node -e '
const fs = require("node:fs");
const scopes = fs.readFileSync(0, "utf8").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
process.stdout.write(`${JSON.stringify(scopes, null, 2)}\n`);
' > "$scopes_file"

  local viewer
  viewer="$(gh api user --jq .login 2>/dev/null || printf 'unknown\n')"
  local state_file payload_cache_file
  state_file="$(buddy_signal_state_cache_file "$cache_dir")"
  payload_cache_file="$(buddy_signal_payload_cache_file "$cache_dir")"
  local attempt
  for attempt in 1 2 3; do
    local parent_sha ref_exists
    ref_exists=0
    if buddy_signal_ref_exists "$repo_nwo"; then
      ref_exists=1
      parent_sha="$(buddy_signal_fetch_tip_sha "$repo_nwo")"
      buddy_signal_fetch_payload_for_tip "$repo_nwo" "$parent_sha" "$previous_payload_file"
    else
      local default_branch
      default_branch="$(buddy_repo_default_branch "$cache_dir")"
      if [[ -z "$default_branch" ]]; then
        echo "Cannot determine default branch for initial signal publish." >&2
        return 1
      fi
      parent_sha="$(gh api "repos/$repo_nwo/git/ref/heads/$default_branch" --jq '.object.sha')"
      printf '{}\n' > "$previous_payload_file"
    fi

    OPENSPEC_BUDDY_SIGNAL_WORKTREE="$(basename "$(openspec_buddy_repo_root)")" \
      node "$cache_signal_script_dir/cache-signal-commit.mjs" next "$repo_nwo" "$kind" "$scopes_file" "$previous_payload_file" "$viewer" > "$payload_file"

    local blob_request tree_request commit_request blob_sha tree_sha commit_sha sequence state_data_file ref_err_file
    blob_request="$tmp_dir/blob.json"
    tree_request="$tmp_dir/tree.json"
    commit_request="$tmp_dir/commit.json"
    state_data_file="$tmp_dir/state.json"
    ref_err_file="$tmp_dir/ref-update.err"
    sequence="$(node -e 'const fs=require("node:fs"); const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(payload.sequence || ""));' "$payload_file")"

    node -e '
const fs = require("node:fs");
const payload = fs.readFileSync(process.argv[1], "utf8");
process.stdout.write(`${JSON.stringify({ content: payload, encoding: "utf-8" }, null, 2)}\n`);
' "$payload_file" > "$blob_request"
    blob_sha="$(gh api --method POST "repos/$repo_nwo/git/blobs" --input "$blob_request" --jq '.sha')"

    node -e '
const blobSha = process.argv[1];
process.stdout.write(`${JSON.stringify({ tree: [{ path: "signal.json", mode: "100644", type: "blob", sha: blobSha }] }, null, 2)}\n`);
' "$blob_sha" > "$tree_request"
    tree_sha="$(gh api --method POST "repos/$repo_nwo/git/trees" --input "$tree_request" --jq '.sha')"

    node -e '
const [treeSha, parentSha, kind, sequence] = process.argv.slice(1);
process.stdout.write(`${JSON.stringify({
  message: `buddy-cache-signal: ${kind}#${sequence}`,
  tree: treeSha,
  parents: [parentSha],
}, null, 2)}\n`);
' "$tree_sha" "$parent_sha" "$kind" "$sequence" > "$commit_request"
    commit_sha="$(gh api --method POST "repos/$repo_nwo/git/commits" --input "$commit_request" --jq '.sha')"

    if [[ "$ref_exists" == "1" ]]; then
      if gh api --method PATCH "repos/$repo_nwo/git/refs/$(buddy_signal_short_ref)" -f sha="$commit_sha" -F force=false >/dev/null 2>"$ref_err_file"; then
        :
      elif buddy_signal_ref_update_retryable "$ref_err_file" && [[ "$attempt" -lt 3 ]]; then
        continue
      else
        cat "$ref_err_file" >&2
        return 1
      fi
    else
      if gh api --method POST "repos/$repo_nwo/git/refs" -f ref="$OPENSPEC_BUDDY_CACHE_SIGNAL_REF" -f sha="$commit_sha" >/dev/null 2>"$ref_err_file"; then
        :
      elif buddy_signal_ref_update_retryable "$ref_err_file" && [[ "$attempt" -lt 3 ]]; then
        continue
      else
        cat "$ref_err_file" >&2
        return 1
      fi
    fi

    node "$cache_signal_script_dir/cache-signal-read.mjs" state "$repo_nwo" "$OPENSPEC_BUDDY_CACHE_SIGNAL_REF" "$commit_sha" "$payload_file" > "$state_data_file"
    buddy_cache_set_from_file "$state_file" signal signal-state state "$state_data_file"
    buddy_cache_set_from_file "$payload_cache_file" signal signal-payload payload "$payload_file"
    return 0
  done
  echo "Failed to publish cache signal after retries." >&2
  return 1
}
