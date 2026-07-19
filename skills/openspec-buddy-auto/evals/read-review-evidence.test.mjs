#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(skillDir, 'scripts/read-review-evidence.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'review-evidence-'));
const bin = path.join(tmp, 'bin');
const log = path.join(tmp, 'gh.log');
fs.mkdirSync(bin);

fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_LOG"
if [[ "$1 $2" == "repo view" ]]; then
  printf '%s\\n' '{"nameWithOwner":"owner/repo"}'
elif [[ "$1" == "api" && "$2" == repos/*/pulls/* ]]; then
  printf '%s\\n' '{"state":"open","html_url":"https://example.test/pr/27","head":{"sha":"head-27","ref":"change-27"}}'
elif [[ "$1" == "api" && "$2" == repos/*/commits/head-27 ]]; then
  printf '%s\\n' '{"sha":"head-27","commit":{"committer":{"date":"2026-07-19T09:59:00Z"}}}'
elif [[ "$*" == *"/issues/"*"/comments?per_page=100"* ]]; then
  printf '%s\\n' '[[{"id":101,"user":{"login":"owner"},"created_at":"2026-07-19T10:00:00Z","html_url":"https://example.test/request","body":"@codex review","reactions":{"total_count":1,"eyes":1,"+1":0,"-1":0}},{"id":102,"user":{"login":"chatgpt-codex-connector[bot]"},"created_at":"2026-07-19T10:05:00Z","html_url":"https://example.test/clear","body":"Did not find any major issues.","reactions":{"total_count":0}}]]'
elif [[ "$*" == *"/pulls/"*"/reviews?per_page=100"* ]]; then
  printf '%s\\n' '[[{"id":201,"user":{"login":"chatgpt-codex-connector[bot]"},"submitted_at":"2026-07-19T10:04:00Z","state":"COMMENTED","commit_id":"head-27","body":"Review body"}]]'
elif [[ "$*" == *"/pulls/"*"/comments?per_page=100"* ]]; then
  printf '%s\\n' '[[{"id":301,"user":{"login":"chatgpt-codex-connector[bot]"},"created_at":"2026-07-19T10:03:00Z","commit_id":"head-27","path":"src/a.mjs","line":7,"html_url":"https://example.test/inline","body":"P2 finding"}]]'
elif [[ "$1 $2" == "api graphql" ]]; then
  if [[ "\${FAKE_TRUNCATED:-0}" == "1" ]]; then
    printf '%s\\n' '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":true},"nodes":[]}}}}}'
  else
    printf '%s\\n' '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"thread-1","isResolved":true,"path":"src/a.mjs","line":7,"comments":{"pageInfo":{"hasNextPage":false},"nodes":[{"id":"comment-1","body":"P2 finding","createdAt":"2026-07-19T10:03:00Z","url":"https://example.test/inline","author":{"login":"chatgpt-codex-connector"}}]}}]}}}}}'
  fi
else
  printf 'unexpected gh call: %s\\n' "$*" >&2
  exit 1
fi
`);
fs.chmodSync(path.join(bin, 'gh'), 0o755);

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log };
const result = spawnSync(process.execPath, [helper, '--pr', '27'], { encoding: 'utf8', env });
assert.equal(result.status, 0, result.stderr || result.stdout);
const snapshot = JSON.parse(result.stdout);
assert.equal(snapshot.pr.head.sha, 'head-27');
assert.equal(snapshot.pr.head.committedAt, '2026-07-19T09:59:00Z');
assert.equal(snapshot.sources.issueComments[1].source, 'issue_comment');
assert.equal(snapshot.sources.issueComments[1].body, 'Did not find any major issues.');
assert.equal(snapshot.sources.issueComments[0].reactions.eyes, 1);
assert.equal(snapshot.sources.reviews[0].source, 'pull_review');
assert.equal(snapshot.sources.reviews[0].commit, 'head-27');
assert.equal(snapshot.sources.reviewComments[0].source, 'review_comment');
assert.equal(snapshot.sources.reviewThreads[0].source, 'review_thread');
assert.equal(snapshot.sources.reviewThreads[0].isResolved, true);
assert.equal(snapshot.sources.reviewThreads[0].comments[0].body, 'P2 finding');
assert.equal(Object.hasOwn(snapshot, 'clearance'), false);
assert.equal(Object.hasOwn(snapshot, 'reviewOutcome'), false);

const calls = fs.readFileSync(log, 'utf8');
for (const expected of [
  'issues/27/comments?per_page=100',
  'pulls/27/reviews?per_page=100',
  'pulls/27/comments?per_page=100',
  'repos/owner/repo/commits/head-27',
  'api graphql',
]) {
  assert.match(calls, new RegExp(expected.replace(/[?]/g, '\\?')));
}

const truncated = spawnSync(process.execPath, [helper, '--pr', '27'], {
  encoding: 'utf8',
  env: { ...env, FAKE_TRUNCATED: '1' },
});
assert.notEqual(truncated.status, 0);
assert.match(truncated.stderr, /more than 100 review threads/i);

fs.writeFileSync(log, '');
const crossRepo = spawnSync(process.execPath, [helper, '--pr', 'https://github.com/other/project/pull/44'], {
  encoding: 'utf8',
  env,
});
assert.equal(crossRepo.status, 0, crossRepo.stderr || crossRepo.stdout);
assert.equal(JSON.parse(crossRepo.stdout).repository, 'other/project');
const crossRepoCalls = fs.readFileSync(log, 'utf8');
assert.match(crossRepoCalls, /repos\/other\/project\/pulls\/44/);
assert.match(crossRepoCalls, /owner=other/);
assert.match(crossRepoCalls, /repo=project/);
assert.match(crossRepoCalls, /number=44/);
assert.doesNotMatch(crossRepoCalls, /repo view/);

console.log('read review evidence tests passed');
