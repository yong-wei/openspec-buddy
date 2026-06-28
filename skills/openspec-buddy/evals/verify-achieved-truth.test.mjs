#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const helper = path.join(repoRoot, 'skills/openspec-buddy/scripts/verify-achieved-truth.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-achieved-truth-'));

function writeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

writeExecutable(path.join(tmp, 'git'), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  remote)
    if [[ "\${2:-}" == "get-url" ]]; then printf 'https://github.com/yong-wei/openspec-buddy.git\\n'; exit 0; fi
    ;;
  config)
    if [[ "\${2:-}" == "--worktree" && "\${3:-}" == "--get" && "\${4:-}" == "buddy.boundBase" ]]; then printf 'origin/integration\\n'; exit 0; fi
    ;;
  cat-file)
    if [[ "\${2:-}" == "-e" && "\${3:-}" == "origin/integration:openspec/changes/archive/2026-06-26-demo/tasks.md" ]]; then exit 0; fi
    ;;
  show)
    if [[ "\${2:-}" == "origin/integration:openspec/changes/archive/2026-06-26-demo/tasks.md" ]]; then printf '%s\\n' '- [x] Done'; exit 0; fi
    ;;
  ls-tree)
    if [[ "\${2:-}" == "-r" && "\${3:-}" == "--name-only" && "\${4:-}" == "origin/integration" && "\${5:-}" == "openspec/changes/archive" ]]; then
      printf '%s\\n' 'openspec/changes/archive/2026-06-26-demo/tasks.md'
      exit 0
    fi
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
`);

writeExecutable(path.join(tmp, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "api" && "\${2:-}" == "repos/yong-wei/openspec-buddy/pulls/123" ]]; then
  cat "\${PR_JSON_FILE:?}"
  exit 0
fi
if [[ "\${1:-}" == "api" && "\${2:-}" == "--paginate" && "\${3:-}" == "repos/yong-wei/openspec-buddy/pulls/123/files?per_page=100" ]]; then
  if [[ "\${PR_FILES_EMPTY:-0}" == "1" ]]; then
    printf '%s\\n' '[]'
    exit 0
  fi
  printf '%s\\n' '[{"filename":"openspec/changes/archive/2026-06-26-demo/tasks.md"}]'
  exit 0
fi
if [[ "\${1:-}" == "issue" && "\${2:-}" == "view" ]]; then
  if [[ "$*" == *"--json id,state,labels,projectItems,url"* ]]; then
    cat "\${ISSUE_JSON_FILE:?}"
    exit 0
  fi
  if [[ "$*" == *"--json id"* ]]; then
    printf 'ISSUE_NODE_ID\\n'
    exit 0
  fi
fi
if [[ "\${1:-}" == "api" && "\${2:-}" == "graphql" ]]; then
  printf 'graphql\\n' >> "\${GRAPHQL_LOG_FILE:?}"
  if [[ "$*" == *"parent {"* ]]; then
    cat "\${PARENT_JSON_FILE:?}"
  else
    cat "\${PROJECT_JSON_FILE:?}"
  fi
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
`);

writeExecutable(path.join(tmp, 'threads-ok'), `#!/usr/bin/env bash
set -euo pipefail
printf 'threads\\n' >> "\${THREAD_LOG_FILE:?}"
printf 'Review threads resolved.\\n'
`);
writeExecutable(path.join(tmp, 'threads-fail'), `#!/usr/bin/env bash
set -euo pipefail
printf 'unresolved review thread THREAD_1\\n' >&2
exit 1
`);

const issueFile = path.join(tmp, 'issue.json');
const mergedPrFile = path.join(tmp, 'merged-pr.json');
const unmergedPrFile = path.join(tmp, 'unmerged-pr.json');
const noParentFile = path.join(tmp, 'no-parent.json');
const parentOpenFile = path.join(tmp, 'parent-open.json');
fs.writeFileSync(mergedPrFile, `${JSON.stringify({ number: 123, merged: true, merged_at: '2026-06-26T00:00:00Z' })}\n`);
fs.writeFileSync(unmergedPrFile, `${JSON.stringify({ number: 123, merged: false, merged_at: null })}\n`);
fs.writeFileSync(issueFile, `${JSON.stringify({
  id: 'ISSUE_NODE_ID',
  state: 'CLOSED',
  body: `<!-- openspec-buddy
change_id: demo
claim_branch: demo
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/demo
risk: low
area: tests
-->`,
  labels: [{ name: 'status:archived' }],
  projectItems: [
    { title: 'OpenSpec Buddy', status: { name: 'Done' }, end: { date: '2026-06-26' } },
  ],
})}\n`);
const issueRestProjectWithoutEndFile = path.join(tmp, 'issue-rest-project-without-end.json');
const projectTerminalFile = path.join(tmp, 'project-terminal.json');
fs.writeFileSync(issueRestProjectWithoutEndFile, `${JSON.stringify({
  id: 'ISSUE_NODE_ID',
  state: 'CLOSED',
  body: `<!-- openspec-buddy
change_id: demo
claim_branch: demo
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/demo
risk: low
area: tests
-->`,
  labels: [{ name: 'status:archived' }],
  projectItems: [
    { title: 'OpenSpec Buddy', status: { name: 'Done' } },
  ],
})}\n`);
fs.writeFileSync(projectTerminalFile, `${JSON.stringify({
  data: {
    node: {
      projectItems: {
        nodes: [
          {
            project: { title: 'OpenSpec Buddy' },
            status: { name: 'Done' },
            end: { date: '2026-06-26' },
          },
        ],
      },
    },
  },
})}\n`);
fs.writeFileSync(noParentFile, `${JSON.stringify({ data: { node: { parent: null } } })}\n`);
fs.writeFileSync(parentOpenFile, `${JSON.stringify({
  data: {
    node: {
      parent: {
        number: 7,
        state: 'OPEN',
        labels: { nodes: [{ name: 'type:series-parent' }, { name: 'status:tracking' }] },
        projectItems: { nodes: [{ project: { title: 'OpenSpec Buddy' }, status: { name: 'In Progress' }, end: null }] },
        subIssues: {
          nodes: [
            {
              number: 42,
              state: 'CLOSED',
              labels: { nodes: [{ name: 'status:archived' }] },
              projectItems: { nodes: [{ project: { title: 'OpenSpec Buddy' }, status: { name: 'Done' }, end: { date: '2026-06-26' } }] },
            },
          ],
        },
      },
    },
  },
})}\n`);

function run(extraEnv = {}) {
  const graphqlLogFile = extraEnv.GRAPHQL_LOG_FILE || path.join(tmp, `graphql-${Math.random().toString(36).slice(2)}.log`);
  const threadLogFile = extraEnv.THREAD_LOG_FILE || path.join(tmp, `threads-${Math.random().toString(36).slice(2)}.log`);
  const result = spawnSync('node', [helper, '42', '123'], {
    cwd: tmp,
    env: {
      ...process.env,
      PATH: `${tmp}:${process.env.PATH}`,
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_RELEASE_BRANCH: 'main',
      OPENSPEC_BUDDY_PROJECT_OWNER: 'yong-wei',
      OPENSPEC_BUDDY_PROJECT_NUMBER: '1',
      OPENSPEC_BUDDY_PROJECT_TITLE: 'OpenSpec Buddy',
      OPENSPEC_BUDDY_PROJECT_STATUS_DONE: 'Done',
      OPENSPEC_BUDDY_VERIFY_REVIEW_THREADS_RESOLVED_HELPER: path.join(tmp, 'threads-ok'),
      PR_JSON_FILE: mergedPrFile,
      ISSUE_JSON_FILE: issueFile,
      PARENT_JSON_FILE: noParentFile,
      PROJECT_JSON_FILE: projectTerminalFile,
      GRAPHQL_LOG_FILE: graphqlLogFile,
      THREAD_LOG_FILE: threadLogFile,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.equal(run().achieved, true);

const preMergeGraphqlLog = path.join(tmp, 'pre-merge-graphql.log');
const preMergeThreadLog = path.join(tmp, 'pre-merge-threads.log');
const preMerge = run({
  PR_JSON_FILE: unmergedPrFile,
  GRAPHQL_LOG_FILE: preMergeGraphqlLog,
  THREAD_LOG_FILE: preMergeThreadLog,
});
assert.equal(preMerge.achieved, false);
assert.equal(preMerge.next, 'merge-pr');
assert.equal(fs.existsSync(preMergeGraphqlLog), false);
assert.equal(fs.existsSync(preMergeThreadLog), false);

const graphqlProjectEnd = run({ ISSUE_JSON_FILE: issueRestProjectWithoutEndFile });
assert.equal(graphqlProjectEnd.achieved, true);

const archiveFromBase = run({ PR_FILES_EMPTY: '1' });
assert.equal(archiveFromBase.achieved, true);
assert.equal(archiveFromBase.archivePath, 'openspec/changes/archive/2026-06-26-demo');

const unresolved = run({ OPENSPEC_BUDDY_VERIFY_REVIEW_THREADS_RESOLVED_HELPER: path.join(tmp, 'threads-fail') });
assert.equal(unresolved.achieved, false);
assert.match(unresolved.reason, /unresolved review thread/);

const parentOpen = run({ PARENT_JSON_FILE: parentOpenFile });
assert.equal(parentOpen.achieved, false);
assert.equal(parentOpen.next, 'mark-achieved-post-merge');
assert.equal(parentOpen.parentNumber, 7);

fs.writeFileSync(path.join(tmp, 'graphql-failed.json'), `${JSON.stringify({})}\n`);
const parentUnknown = run({ PARENT_JSON_FILE: path.join(tmp, 'graphql-failed.json') });
assert.equal(parentUnknown.achieved, false);
assert.equal(parentUnknown.next, '');
assert.match(parentUnknown.reason, /cannot verify parent terminal state/);

const wrongIssueFile = path.join(tmp, 'wrong-issue.json');
fs.writeFileSync(wrongIssueFile, `${JSON.stringify({
  id: 'ISSUE_NODE_ID',
  state: 'CLOSED',
  body: `<!-- openspec-buddy
change_id: other-change
claim_branch: other-change
series: none
coupling_group: none
execution_mode: isolated
base_branch: integration
depends_on: []
openspec_path: openspec/changes/other-change
risk: low
area: tests
-->`,
  labels: [{ name: 'status:archived' }],
  projectItems: [
    { title: 'OpenSpec Buddy', status: { name: 'Done' }, end: { date: '2026-06-26' } },
  ],
})}\n`);
const archiveMismatch = run({ ISSUE_JSON_FILE: wrongIssueFile });
assert.equal(archiveMismatch.achieved, false);
assert.match(archiveMismatch.reason, /does not match issue change_id/);

console.log('verify-achieved-truth tests passed');
