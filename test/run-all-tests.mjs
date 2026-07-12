import { spawnSync } from 'node:child_process';

const tierOrder = { fast: 0, helpers: 1, full: 2 };
const selectedTier = process.argv[2] || process.env.OPENSPEC_BUDDY_TEST_TIER || 'full';

if (!Object.hasOwn(tierOrder, selectedTier)) {
  console.error(`Usage: node test/run-all-tests.mjs <fast|helpers|full>`);
  process.exit(2);
}

const sh = (label, script, tier = 'helpers') => ({ label, cmd: 'bash', args: ['-lc', script], tier });
const bash = (file, tier = 'helpers') => ({ label: `bash ${file}`, cmd: 'bash', args: [file], tier });
const node = (file, tier = 'fast') => ({ label: `node ${file}`, cmd: 'node', args: [file], tier });

const commands = [
  sh('bash -n skills/openspec-buddy/scripts/*.sh', 'bash -n skills/openspec-buddy/scripts/*.sh', 'fast'),
  { label: 'node --check src/cli.mjs', cmd: 'node', args: ['--check', 'src/cli.mjs'], tier: 'fast' },
  { label: 'node --check bin/openspec-buddy.mjs', cmd: 'node', args: ['--check', 'bin/openspec-buddy.mjs'], tier: 'fast' },
  sh('node --test test/*.test.mjs', 'node --test test/*.test.mjs', 'fast'),

  bash('skills/openspec-buddy/evals/load-config-dotenv.test.sh'),
  node('skills/openspec-buddy/evals/build-pr-development-note.test.mjs'),
  node('skills/openspec-buddy/evals/build-pr-labels.test.mjs'),
  node('skills/openspec-buddy/evals/buddy-driver.test.mjs'),
  node('skills/openspec-buddy/evals/classify-review-response.test.mjs'),
  bash('skills/openspec-buddy/evals/cache-signal.test.sh'),
  bash('skills/openspec-buddy/evals/cache-metrics.test.sh'),
  bash('skills/openspec-buddy/evals/bound-worktree-guard.test.sh'),
  bash('skills/openspec-buddy/evals/claim-race-gate.test.sh'),
  bash('skills/openspec-buddy/evals/claim-worktree-guard.test.sh'),
  bash('skills/openspec-buddy/evals/read-live-claim-truth.test.sh'),
  bash('skills/openspec-buddy/evals/close-completed-series-parent.test.sh'),
  bash('skills/openspec-buddy/evals/github-cli-compat.test.sh'),
  bash('skills/openspec-buddy/evals/github-fetch-graphql-guard.test.sh'),
  bash('skills/openspec-buddy/evals/helper-help.test.sh'),
  bash('skills/openspec-buddy/evals/find-issue-pr.test.sh'),
  bash('skills/openspec-buddy/evals/release-claim.test.sh'),
  bash('skills/openspec-buddy/evals/link-issue-dependencies-budget.test.sh'),
  bash('skills/openspec-buddy/evals/list-ready-change-relationships.test.sh'),
  bash('skills/openspec-buddy/evals/mark-achieved-post-merge.test.sh'),
  bash('skills/openspec-buddy/evals/mark-in-progress.test.sh'),
  bash('skills/openspec-buddy/evals/mark-review.test.sh'),
  bash('skills/openspec-buddy/evals/merge-pr-after-gates.test.sh'),
  node('skills/openspec-buddy/evals/open-issue-claim.test.mjs'),
  node('skills/openspec-buddy/evals/propose-default-artifacts.test.mjs'),
  node('skills/openspec-buddy/evals/propose-acceptance-gates.test.mjs'),
  node('skills/openspec-buddy/evals/propose-issue-body-validation.test.mjs'),
  node('skills/openspec-buddy/evals/no-issue-no-pr.test.mjs'),
  bash('skills/openspec-buddy/evals/project-cache.test.sh'),
  bash('skills/openspec-buddy/evals/relationship-cache-invalidation.test.sh'),
  bash('skills/openspec-buddy/evals/select-next-change-local-only.test.sh'),
  bash('skills/openspec-buddy/evals/set-status-label-cache-invalidation.test.sh'),
  bash('skills/openspec-buddy/evals/status-write-verification.test.sh'),
  node('skills/openspec-buddy/evals/verify-issue-relationships.test.mjs'),
  bash('skills/openspec-buddy/evals/verify-issue-relationships-wrapper.test.sh'),
  node('skills/openspec-buddy/evals/pre-archive-change-validation.test.mjs'),
  bash('skills/openspec-buddy/evals/probe-review-state.test.sh'),
  bash('skills/openspec-buddy/evals/check-review-clear-once.test.sh'),
  bash('skills/openspec-buddy/evals/request-pr-review.test.sh'),
  bash('skills/openspec-buddy/evals/reply-review-thread.test.sh'),
  node('skills/openspec-buddy/evals/review-request-state.test.mjs'),
  bash('skills/openspec-buddy/evals/review-response-gate.test.sh'),
  bash('skills/openspec-buddy/evals/resolve-review-thread.test.sh'),
  bash('skills/openspec-buddy/evals/sync-base-branch.test.sh'),
  bash('skills/openspec-buddy/evals/wait-for-review-clear.test.sh'),
  node('skills/openspec-buddy/evals/verify-achieved-truth.test.mjs'),
  bash('skills/openspec-buddy/evals/verify-review-clear-cache.test.sh'),
  node('skills/openspec-buddy/evals/verify-pr-coordination.test.mjs'),
  node('skills/openspec-buddy/evals/verify-review-clear.test.mjs'),

  node('skills/openspec-buddy-auto/evals/lane-state.test.mjs'),
  node('skills/openspec-buddy-auto/evals/review-truth.test.mjs'),
  node('skills/openspec-buddy-auto/evals/lane-action-runner.test.mjs'),
  node('skills/openspec-buddy-auto/evals/lane-switch-gate.test.mjs'),
  node('skills/openspec-buddy-auto/evals/buddy-auto-controller-fast.test.mjs'),
  node('skills/openspec-buddy-auto/evals/buddy-auto-controller.test.mjs', 'helpers'),
  node('skills/openspec-buddy-auto/evals/buddy-auto-lane-driver-fast.test.mjs'),
  node('skills/openspec-buddy-auto/evals/buddy-auto-driver.test.mjs'),
  node('skills/openspec-buddy-auto/evals/select-next-change.test.mjs'),
  node('skills/openspec-buddy-auto/evals/buddy-auto-lane-driver.test.mjs', 'full'),
];

const selectedLevel = tierOrder[selectedTier];
const selectedCommands = commands.filter((command) => tierOrder[command.tier] <= selectedLevel);

for (const { label, cmd, args } of selectedCommands) {
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

process.stdout.write(`\n${selectedTier} tests passed.\n`);
