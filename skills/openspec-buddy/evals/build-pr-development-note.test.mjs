import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(__dirname, '../scripts/build-pr-development-note.mjs');

function runCase({ pr, issue = '123', defaultBranch = 'main', mode = 'auto' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-pr-link-'));
  const prFile = path.join(dir, 'pr.json');
  const bodyFile = path.join(dir, 'body.md');
  const reportFile = path.join(dir, 'report.json');
  fs.writeFileSync(prFile, JSON.stringify(pr));
  const result = spawnSync(process.execPath, [helper, prFile, issue, defaultBranch, mode, bodyFile, reportFile], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stderr: result.stderr,
    body: fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '',
    report: fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : null,
  };
}

{
  const result = runCase({ pr: { baseRefName: 'main', body: 'Summary' } });
  assert.equal(result.status, 0);
  assert.match(result.body, /Origin issue: #123/);
  assert.match(result.body, /Development link: Closes #123/);
  assert.equal(result.report.mode, 'keyword');
  assert.equal(result.report.keyword, true);
}

{
  const result = runCase({ pr: { baseRefName: 'develop', body: 'Summary' } });
  assert.equal(result.status, 0);
  assert.match(result.body, /manual GitHub sidebar link required/);
  assert.doesNotMatch(result.body, /Closes #123/);
  assert.equal(result.report.mode, 'manual');
}

{
  const result = runCase({ pr: { baseRefName: 'develop', body: 'Summary' }, mode: 'keyword' });
  assert.equal(result.status, 4);
  assert.match(result.stderr, /not the repository default branch/);
  assert.equal(result.report, null);
}

{
  const oldBody = '<!-- openspec-buddy-origin-issue:123 -->\n\n## OpenSpec Buddy\n\nOrigin issue: #123\nDevelopment link: manual GitHub sidebar link required.';
  const result = runCase({ pr: { baseRefName: 'main', body: oldBody }, mode: 'keyword' });
  assert.equal(result.status, 0);
  assert.match(result.body, /Development link: Closes #123/);
  assert.equal(result.report.mode, 'keyword');
}

console.log('build-pr-development-note tests passed');
