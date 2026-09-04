import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const claimLock = path.join(root, 'skills/openspec-buddy/scripts/claim-lock.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-claim-refresh-'));
const repo = path.join(tmp, 'repo');
const origin = path.join(tmp, 'origin.git');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
};

try {
  fs.mkdirSync(repo);
  run('git', ['init', '-q'], { cwd: repo });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'seed'), 'seed\n');
  run('git', ['add', 'seed'], { cwd: repo });
  run('git', ['commit', '-qm', 'seed'], { cwd: repo });
  run('git', ['branch', 'integration'], { cwd: repo });
  run('git', ['init', '--bare', '-q', origin]);
  run('git', ['remote', 'add', 'origin', origin], { cwd: repo });
  run('git', ['push', '-q', 'origin', 'integration'], { cwd: repo });
  run('git', ['push', '-q', 'origin', 'HEAD:direct-change'], { cwd: repo });
  const baseBeforeProposal = run('git', ['rev-parse', 'origin/integration'], { cwd: repo });

  fs.mkdirSync(path.join(repo, 'openspec/changes/direct-change'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'openspec/changes/direct-change/proposal.md'), '# Proposal\n');
  run('git', ['add', 'openspec/changes/direct-change/proposal.md'], { cwd: repo });
  run('git', ['commit', '-qm', 'proposal'], { cwd: repo });
  run('git', ['push', '-q', 'origin', 'HEAD:integration'], { cwd: repo });
  const baseAfterProposal = run('git', ['rev-parse', 'HEAD'], { cwd: repo });

  const fixture = path.join(tmp, 'fixture');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'issue.json'), JSON.stringify({
    number: 42,
    state: 'open',
    labels: [{ name: 'status:claimed' }],
    assignees: [{ login: 'alice' }],
    body: '<!-- openspec-buddy\nchange_id: direct-change\nclaim_branch: direct-change\ndirect_claim: true\n-->',
  }));
  fs.writeFileSync(path.join(fixture, 'identity.json'), JSON.stringify({
    alias: 'dev1', path_hash: 'path-1', coordination_branch: 'dev1', run_id: 'run-1',
  }));
  fs.writeFileSync(path.join(fixture, 'comments.json'), JSON.stringify([{
    created_at: '2026-09-04T00:00:00Z',
    user: { login: 'alice' },
    body: `OpenSpec Buddy Claim\n\nclaim_id: claim-42\nstate: active\nagent: codex/gpt-5.6-sol\nchange_id: direct-change\nbranch: direct-change\nbase_branch: integration\nbase_sha: ${baseBeforeProposal}\nlease_until: 2999-01-01T00:00:00.000Z\nworktree_alias: dev1\nworktree_path_hash: path-1\ncoordination_branch: dev1\nrun_id: run-1`,
  }]));

  const script = `
set -euo pipefail
source ${JSON.stringify(claimLock)}
buddy_claim_issue_rest() { cp "$FIXTURE/issue.json" "$3"; }
buddy_claim_comments_rest() { cp "$FIXTURE/comments.json" "$3"; }
buddy_claim_open_prs_rest() { printf '[]' > "$3"; }
buddy_worktree_identity_json() { cat "$FIXTURE/identity.json"; }
buddy_cache_dir() { printf '%s\\n' "$FIXTURE/cache"; }
buddy_claim_development_link_exists() { return 0; }
buddy_write_minimal_claim_lock() {
  node -e 'const fs=require("node:fs"); const [file, sha, claimId, lease]=process.argv.slice(1); const body=["OpenSpec Buddy Claim","","claim_id: "+claimId,"state: active","agent: codex/gpt-5.6-sol","change_id: direct-change","branch: direct-change","base_branch: integration","base_sha: "+sha,"lease_until: "+lease,"worktree_alias: dev1","worktree_path_hash: path-1","coordination_branch: dev1","run_id: run-1"].join("\\n"); fs.writeFileSync(file, JSON.stringify([{created_at:"2026-09-04T01:00:00Z",user:{login:"alice"},body}]))' "$FIXTURE/comments.json" "$5" "$7" "$8"
}
buddy_refresh_direct_claim_after_propose 42 direct-change direct-change integration alice owner/repo "$FIXTURE/check" "$FIXTURE/issue.json"
buddy_verify_active_claim_resume 42 direct-change direct-change integration alice owner/repo "$FIXTURE/final" >/dev/null
git ls-remote --heads origin direct-change | awk '{print $1}'
`;
  const result = spawnSync('bash', ['-c', script], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, FIXTURE: fixture },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), baseAfterProposal, `refreshed=${result.stdout.trim()} expected=${baseAfterProposal} before=${baseBeforeProposal}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'comments.json'), 'utf8'))[0].body.includes(`base_sha: ${baseAfterProposal}`), true);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('direct claim refresh tests passed');
