import { spawnSync } from 'node:child_process';

const commands = [
  { label: 'bash -n skills/openspec-buddy/scripts/*.sh', cmd: 'bash', args: ['-lc', 'bash -n skills/openspec-buddy/scripts/*.sh'] },
  { label: 'node --check src/cli.mjs', cmd: 'node', args: ['--check', 'src/cli.mjs'] },
  { label: 'node --check bin/openspec-buddy.mjs', cmd: 'node', args: ['--check', 'bin/openspec-buddy.mjs'] },
  { label: 'node --test test/*.test.mjs', cmd: 'bash', args: ['-lc', 'node --test test/*.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/load-config-dotenv.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/load-config-dotenv.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/build-pr-development-note.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/build-pr-development-note.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/build-pr-labels.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/build-pr-labels.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/buddy-driver.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/buddy-driver.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/cache-signal.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/cache-signal.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/bound-worktree-guard.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/bound-worktree-guard.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/claim-race-gate.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/claim-race-gate.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/claim-worktree-guard.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/claim-worktree-guard.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/close-completed-series-parent.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/close-completed-series-parent.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/github-cli-compat.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/github-cli-compat.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/github-fetch-graphql-guard.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/github-fetch-graphql-guard.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/helper-help.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/helper-help.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/find-issue-pr.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/find-issue-pr.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/release-claim.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/release-claim.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/link-issue-dependencies-budget.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/link-issue-dependencies-budget.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/list-ready-change-relationships.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/list-ready-change-relationships.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/mark-achieved-post-merge.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/mark-achieved-post-merge.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/mark-in-progress.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/mark-in-progress.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/mark-review.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/mark-review.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/open-issue-claim.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/open-issue-claim.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/propose-default-artifacts.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/propose-default-artifacts.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/propose-issue-body-validation.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/propose-issue-body-validation.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/no-issue-no-pr.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/no-issue-no-pr.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/project-cache.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/project-cache.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/relationship-cache-invalidation.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/relationship-cache-invalidation.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/select-next-change-local-only.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/select-next-change-local-only.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/set-status-label-cache-invalidation.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/set-status-label-cache-invalidation.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/verify-issue-relationships.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/verify-issue-relationships.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/verify-issue-relationships-wrapper.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/verify-issue-relationships-wrapper.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/pre-archive-change-validation.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/pre-archive-change-validation.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/probe-review-state.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/probe-review-state.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/check-review-clear-once.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/check-review-clear-once.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/request-pr-review.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/request-pr-review.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/reply-review-thread.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/reply-review-thread.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/review-request-state.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/review-request-state.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/review-response-gate.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/review-response-gate.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/resolve-review-thread.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/resolve-review-thread.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/sync-base-branch.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/sync-base-branch.test.sh'] },
  { label: 'bash skills/openspec-buddy/evals/wait-for-review-clear.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/wait-for-review-clear.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/verify-achieved-truth.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/verify-achieved-truth.test.mjs'] },
  { label: 'bash skills/openspec-buddy/evals/verify-review-clear-cache.test.sh', cmd: 'bash', args: ['skills/openspec-buddy/evals/verify-review-clear-cache.test.sh'] },
  { label: 'node skills/openspec-buddy/evals/verify-pr-coordination.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/verify-pr-coordination.test.mjs'] },
  { label: 'node skills/openspec-buddy/evals/verify-review-clear.test.mjs', cmd: 'node', args: ['skills/openspec-buddy/evals/verify-review-clear.test.mjs'] },
  { label: 'node skills/openspec-buddy-auto/evals/lane-state.test.mjs', cmd: 'node', args: ['skills/openspec-buddy-auto/evals/lane-state.test.mjs'] },
  { label: 'node skills/openspec-buddy-auto/evals/lane-switch-gate.test.mjs', cmd: 'node', args: ['skills/openspec-buddy-auto/evals/lane-switch-gate.test.mjs'] },
  { label: 'node skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs', cmd: 'node', args: ['skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs'] },
  { label: 'node skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs', cmd: 'node', args: ['skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs'] },
  { label: 'node skills/openspec-buddy-auto/evals/select-next-change.test.mjs', cmd: 'node', args: ['skills/openspec-buddy-auto/evals/select-next-change.test.mjs'] },
];

for (const { label, cmd, args } of commands) {
  process.stdout.write(`\n> ${label}\n`);
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nAll tests passed.\n');
