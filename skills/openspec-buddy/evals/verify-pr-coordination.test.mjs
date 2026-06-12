import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(__dirname, '../scripts/verify-pr-coordination.sh');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-pr-verify-'));

function writeJson(name, value) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

const reviewRequest = '@codex review 中文回复，即使没有重大问题也必须给出显式回复';
const issueFile = writeJson('issue.json', {
  number: 123,
  url: 'https://github.com/opt-de/major/issues/123',
  labels: [
    { name: 'status:in-review' },
    { name: 'type:content-pack' },
    { name: 'level:intermediate' },
    { name: 'area:major' },
    { name: 'series:major-content' },
    { name: 'risk:low' },
    { name: 'mode:isolated' },
    { name: 'coupling:majors' },
  ],
  assignees: [{ login: 'student-a' }],
  body: `<!-- openspec-buddy
change_id: issue-123-major-content
claim_branch: issue-123-major-content
series: major-content
coupling_group: majors
execution_mode: isolated
base_branch: integration
required_branch:
depends_on: []
openspec_path: openspec/changes/issue-123-major-content
risk: low
area: major
-->

Original issue body.`,
  projectItems: [],
});

const completePr = {
  number: 45,
  url: 'https://github.com/opt-de/major/pull/45',
  body: 'Summary\n\nOrigin issue: #123\n<!-- openspec-buddy-origin-issue:123 -->\nmanual GitHub sidebar link required',
  baseRefName: 'integration',
  labels: [
    { name: 'pr:openspec-buddy' },
    { name: 'pr:base-integration' },
    { name: 'type:content-pack' },
    { name: 'level:intermediate' },
    { name: 'area:major' },
    { name: 'series:major-content' },
    { name: 'risk:low' },
    { name: 'mode:isolated' },
    { name: 'coupling:majors' },
  ],
  isDraft: false,
  assignees: [{ login: 'student-a' }],
  projectItems: [{ title: 'Major LTE', status: { name: 'In Progress' } }],
  closingIssuesReferences: [],
  files: [
    { path: 'openspec/changes/archive/2026-05-25-issue-123-major-content/tasks.md' },
    { path: 'src/app/page.tsx' },
  ],
  comments: [{ body: reviewRequest }],
};
const completePrFile = writeJson('pr-complete.json', completePr);
const missingReviewPrFile = writeJson('pr-missing-review.json', {
  ...completePr,
  comments: [],
});

const ghFile = path.join(tmpDir, 'gh');
fs.writeFileSync(
  ghFile,
  `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "issue" && "$2" == "view" ]]; then
  cat "\${GH_ISSUE_JSON:?}"
  exit 0
fi
if [[ "$1" == "pr" && "$2" == "view" ]]; then
  cat "\${GH_PR_JSON:?}"
  exit 0
fi
if [[ "$1" == "repo" && "$2" == "view" ]]; then
  cat <<'JSON'
{"nameWithOwner":"owner/repo","defaultBranchRef":{"name":"main"}}
JSON
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
`,
);
fs.chmodSync(ghFile, 0o755);

function runVerify(prFile) {
  return spawnSync(helper, ['123', '45'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH}`,
      GH_ISSUE_JSON: issueFile,
      GH_PR_JSON: prFile,
      OPENSPEC_BUDDY_GH_CACHE_DIR: path.join(tmpDir, `cache-${path.basename(prFile, '.json')}`),
      OPENSPEC_BUDDY_BASE_BRANCH: 'integration',
      OPENSPEC_BUDDY_RELEASE_BRANCH: 'main',
      OPENSPEC_BUDDY_PROJECT_OWNER: 'opt-de',
      OPENSPEC_BUDDY_PROJECT_NUMBER: '1',
      OPENSPEC_BUDDY_PROJECT_TITLE: 'Major LTE',
      OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE: 'manual',
      OPENSPEC_BUDDY_PR_REVIEW_REQUEST: reviewRequest,
    },
  });
}

try {
  const complete = runVerify(completePrFile);
  assert.equal(complete.status, 0, complete.stderr || complete.stdout);

  const missingReview = runVerify(missingReviewPrFile);
  assert.notEqual(missingReview.status, 0);
  assert.match(missingReview.stderr, /PR review request comment is missing/);

  console.log('verify-pr-coordination tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
