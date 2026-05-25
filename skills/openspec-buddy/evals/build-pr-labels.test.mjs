import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = path.resolve(__dirname, '../scripts/build-pr-labels.mjs');

function runCase({ issue, pr }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-pr-labels-'));
  const issueFile = path.join(dir, 'issue.json');
  const prFile = path.join(dir, 'pr.json');
  const labelsFile = path.join(dir, 'labels.txt');
  const prLabelsFile = path.join(dir, 'pr-labels.txt');
  fs.writeFileSync(issueFile, JSON.stringify(issue));
  fs.writeFileSync(prFile, JSON.stringify(pr));

  const result = spawnSync(process.execPath, [helper, issueFile, prFile, labelsFile, prLabelsFile], {
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stderr: result.stderr,
    labels: fs.existsSync(labelsFile)
      ? fs.readFileSync(labelsFile, 'utf8').trim().split('\n').filter(Boolean)
      : [],
    prLabels: fs.existsSync(prLabelsFile)
      ? fs.readFileSync(prLabelsFile, 'utf8').trim().split('\n').filter(Boolean)
      : [],
  };
}

{
  const result = runCase({
    issue: {
      labels: [
        { name: 'type: content-pack' },
        { name: 'level: intermediate' },
        { name: 'area: major' },
        { name: 'series: major-content' },
        { name: 'risk: low' },
        { name: 'mode: isolated' },
        { name: 'coupling: majors' },
        { name: 'status: in-progress' },
        { name: 'unrelated-label' },
      ],
    },
    pr: {
      baseRefName: 'integration',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.labels, [
    'pr:openspec-buddy',
    'pr:base-integration',
    'type:content-pack',
    'level:intermediate',
    'area:major',
    'series:major-content',
    'risk:low',
    'mode:isolated',
    'coupling:majors',
  ]);
  assert.deepEqual(result.prLabels, ['pr:openspec-buddy', 'pr:base-integration']);
}

{
  const result = runCase({
    issue: {
      labels: [
        { name: 'area: workflow' },
        { name: 'area:workflow' },
        { name: 'status: ready' },
      ],
    },
    pr: {
      baseRefName: 'feature/Integration QA',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.labels, ['pr:openspec-buddy', 'pr:base-feature-integration-qa', 'area:workflow']);
}

console.log('build-pr-labels tests passed');
