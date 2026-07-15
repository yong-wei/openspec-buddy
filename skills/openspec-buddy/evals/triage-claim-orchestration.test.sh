#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
scripts="$tmp/skills/openspec-buddy/scripts"
mkdir -p "$scripts" "$tmp/bin" "$tmp/openspec/changes/issue-31-test/.buddy"
cp "$skill_dir/scripts/claim-issue.sh" "$scripts/claim-issue.sh"
cp "$skill_dir/scripts/parse-issue-metadata.mjs" "$scripts/parse-issue-metadata.mjs"
cp "$skill_dir/scripts/build-open-issue-metadata.mjs" "$scripts/build-open-issue-metadata.mjs"
cp "$skill_dir/scripts/select-claim-issue.mjs" "$scripts/select-claim-issue.mjs"
cp "$skill_dir/scripts/validate-triage.mjs" "$scripts/validate-triage.mjs"

cat > "$scripts/load-config.sh" <<'EOF'
export OPENSPEC_BUDDY_CLAIM_TTL_HOURS=2
export OPENSPEC_BUDDY_BASE_BRANCH=integration
openspec_buddy_require_core_config() { :; }
EOF
cat > "$scripts/github-fetch.sh" <<'EOF'
buddy_cache_dir() { printf '%s\n' "$TEST_ROOT/cache"; }
buddy_signal_apply() { :; }
buddy_signal_publish() { :; }
buddy_invalidate_issue_cache() { :; }
buddy_invalidate_ready_scan_cache() { :; }
buddy_open_issues_rest() { printf '[]\n'; }
buddy_issue_relationships_graphql() {
  if [[ "${OPEN_BLOCKER:-0}" == 1 ]]; then
    printf '[{"blockedBy":{"nodes":[{"number":30,"title":"Open blocker","state":"OPEN","labels":{"nodes":[]}}]}}]\n'
  else
    printf '[]\n'
  fi
}
EOF
cat > "$scripts/worktree-identity.sh" <<'EOF'
buddy_worktree_record_claim() { printf 'record-claim\n' >> "$CALL_LOG"; }
EOF
cat > "$scripts/cache-signal.sh" <<'EOF'
:
EOF
cat > "$scripts/claim-lock.sh" <<'EOF'
buddy_repo_nwo() { printf 'owner/repo\n'; }
buddy_resolve_coupling_group() { printf 'none\n'; }
buddy_preflight_claim_truth_check() { printf 'preflight\n' >> "$CALL_LOG"; }
buddy_write_minimal_claim_lock() { printf 'minimal-lock\n' >> "$CALL_LOG"; printf claimed > "$TEST_ROOT/mode"; }
buddy_verify_claim_lock_rest() { printf 'verify-lock\n' >> "$CALL_LOG"; }
buddy_verify_active_claim_resume() {
  printf 'active-verify%s\n' "${8:+-bound}" >> "$CALL_LOG"
  [[ "${FAIL_ACTIVE_VERIFY:-0}" != 1 ]]
  printf '{"claim_id":"claim-31","lease_until":"2026-07-15T12:00:00Z","base_sha":"%s"}\n' "$(git rev-parse origin/integration)"
}
buddy_release_claim_lock() { printf 'release-lock\n' >> "$CALL_LOG"; }
buddy_claim_branch_exists() { return 0; }
EOF

for helper in verify-bound-worktree.sh sync-base-branch.sh verify-claim-worktree.sh; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$scripts/$helper"
  chmod +x "$scripts/$helper"
done
cat > "$scripts/find-coupling-conflicts.mjs" <<'EOF'
process.stdout.write("[]\n");
EOF
for helper in set-project-status.sh set-project-date.sh; do
  cat > "$scripts/$helper" <<'EOF'
#!/usr/bin/env bash
printf 'project-mutation %s\n' "$*" >> "$CALL_LOG"
EOF
  chmod +x "$scripts/$helper"
done
cat > "$scripts/claim-change.sh" <<'EOF'
#!/usr/bin/env bash
printf 'claim-change %s\n' "$*" >> "$CALL_LOG"
EOF
cat > "$scripts/set-status-label.sh" <<'EOF'
#!/usr/bin/env bash
printf 'status-mutation %s\n' "$2" >> "$CALL_LOG"
printf "$2" > "$TEST_ROOT/post-status"
EOF
chmod +x "$scripts/claim-change.sh" "$scripts/set-status-label.sh" "$scripts/claim-issue.sh"

cat > "$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$CALL_LOG"
if [[ "$1 $2" == "api user" ]]; then printf 'alice\n'; exit 0; fi
if [[ "$1 $2" == "issue view" ]]; then
  status="status:ready"
  [[ -f "$TEST_ROOT/mode" ]] && status="status:$(cat "$TEST_ROOT/mode")"
  [[ -f "$TEST_ROOT/post-status" ]] && status="$(cat "$TEST_ROOT/post-status")"
  state=OPEN
  if [[ "$*" == *"state,labels"* ]]; then
    printf '{"state":"%s","labels":[{"name":"%s"}]}\n' "$state" "$status"
  else
    body='# Test'
    if [[ "$status" == status:claimed ]]; then
      body='---
change_id: issue-31-test
claim_branch: issue-31-test
series: test
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/issue-31-test
risk: low
area: workflow
---'
    fi
    node -e 'console.log(JSON.stringify({id:"I",number:31,title:"Test",labels:[{name:process.argv[1]}],assignees:[{login:"alice"}],body:process.argv[2],url:"https://example/31",state:"OPEN",updatedAt:"2026-07-14T10:00:00Z"}))' "$status" "$body"
  fi
  exit 0
fi
if [[ "$1 $2 $3" == "issue develop --help" ]]; then exit 0; fi
if [[ "$1 $2 $3" == "issue develop --list" ]]; then printf 'issue-31-test\n'; exit 0; fi
printf 'unexpected gh call: %s\n' "$*" >&2
exit 1
EOF
chmod +x "$tmp/bin/gh"

export TEST_ROOT="$tmp" CALL_LOG="$tmp/calls.log" PATH="$tmp/bin:$PATH"
cd "$tmp"
git init -q
git config user.email test@example.com
git config user.name Test
touch seed && git add seed && git commit -qm seed
git branch integration
git init --bare -q "$tmp/origin.git"
git remote add origin "$tmp/origin.git"
git push -q origin integration
git push -q origin HEAD:issue-31-test

# Fresh ordinary issue: lock and verify precede triage; missing triage preserves lock.
: > "$CALL_LOG"
rm -f "$tmp/mode" "$tmp/post-status" "$tmp/openspec/changes/issue-31-test/.buddy/triage.json"
"$scripts/claim-issue.sh" 31 > "$tmp/out"
grep -q '^HANDOFF$' "$tmp/out"
node -e '
const fs=require("fs"); const calls=fs.readFileSync(process.argv[1],"utf8");
for (const item of ["minimal-lock","verify-lock","active-verify"]) if (!calls.includes(item)) throw new Error(`missing ${item}`);
if (!(calls.indexOf("minimal-lock") < calls.indexOf("verify-lock") && calls.indexOf("verify-lock") < calls.indexOf("active-verify"))) throw new Error("unsafe order");
if (calls.includes("claim-change") || calls.includes("release-lock") || calls.includes("status-mutation")) throw new Error("unexpected post-lock mutation");
' "$CALL_LOG"

# Non-executable disposition: validate owner twice, mutate, then confirm state.
cat > "$tmp/openspec/changes/issue-31-test/.buddy/triage.json" <<'EOF'
{"subject":{"issue":31,"change_id":"issue-31-test"},"truth":{"problem_reproduced":"yes","evidence":["observed"]},"duplication":{"existing_implementation":"none","conflicting_specs":[],"active_changes":[],"superseded_by":null},"readiness":{"information":"insufficient","disposition":"needs-human","reason":"More detail required"},"binding":{"issue_updated_at":"2026-07-14T10:00:00Z","base_sha":"abc1234","generated_at":"2026-07-14T10:01:00Z"}}
EOF
sed -i.bak "s/abc1234/$(git rev-parse origin\/integration)/" "$tmp/openspec/changes/issue-31-test/.buddy/triage.json"
: > "$CALL_LOG"
"$scripts/claim-issue.sh" 31 > "$tmp/out"
[[ "$(grep -c '^active-verify' "$CALL_LOG")" -eq 2 ]]
grep -q '^active-verify-bound$' "$CALL_LOG"
grep -q '^status-mutation status:needs-human$' "$CALL_LOG"
grep -q 'gh issue view 31 --json state,labels' "$CALL_LOG"

# Subject identity mismatches stop before every disposition or Development
# mutation, even though the active claim itself is valid.
for mismatch in issue change; do
  node -e '
const fs=require("fs"); const [file, kind]=process.argv.slice(1);
const value=JSON.parse(fs.readFileSync(file,"utf8"));
if (kind === "issue") value.subject.issue = 99;
else value.subject.change_id = "other-change";
fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
' "$tmp/openspec/changes/issue-31-test/.buddy/triage.json" "$mismatch"
  printf claimed > "$tmp/mode"; rm -f "$tmp/post-status"; : > "$CALL_LOG"
  if "$scripts/claim-issue.sh" 31 >/dev/null 2>&1; then exit 1; fi
  ! grep -Eq 'status-mutation|issue close|issue develop 31 --name|claim-change' "$CALL_LOG"
  # Restore the known-good artifact for the next mismatch case.
  if [[ "$mismatch" == issue ]]; then
    node -e 'const fs=require("fs"); const f=process.argv[1]; const v=JSON.parse(fs.readFileSync(f,"utf8")); v.subject.issue=31; fs.writeFileSync(f, `${JSON.stringify(v)}\n`);' "$tmp/openspec/changes/issue-31-test/.buddy/triage.json"
  fi
done

# A failed claimed re-entry verifier performs no disposition or Development mutation.
printf claimed > "$tmp/mode"; rm -f "$tmp/post-status"; : > "$CALL_LOG"
if FAIL_ACTIVE_VERIFY=1 "$scripts/claim-issue.sh" 31 >/dev/null 2>&1; then exit 1; fi
! grep -Eq 'status-mutation|issue develop 31 --name|claim-change' "$CALL_LOG"

# The real claim-change resume entry rejects before relationship or Development
# mutation when the shared active verifier fails.
cp "$skill_dir/scripts/claim-change.sh" "$scripts/claim-change.sh"
chmod +x "$scripts/claim-change.sh"
printf claimed > "$tmp/mode"; : > "$CALL_LOG"
if FAIL_ACTIVE_VERIFY=1 "$scripts/claim-change.sh" 31 --resume-active >/dev/null 2>&1; then exit 1; fi
! grep -Eq 'issue develop 31 --name|status-mutation' "$CALL_LOG"
! grep -q '^release-lock$' "$CALL_LOG"

# Once resume ownership has been verified, failures in downstream blocker
# checks release the active lock inherited from claim-issue.
printf claimed > "$tmp/mode"; : > "$CALL_LOG"
if OPEN_BLOCKER=1 "$scripts/claim-change.sh" 31 --resume-active >/dev/null 2>&1; then exit 1; fi
[[ "$(grep -c '^release-lock$' "$CALL_LOG")" -eq 1 ]]

# A successful resume keeps the claim active for implementation.
printf claimed > "$tmp/mode"; : > "$CALL_LOG"
"$scripts/claim-change.sh" 31 --resume-active >/dev/null
! grep -q '^release-lock$' "$CALL_LOG"

printf 'triage claim orchestration tests passed\n'
