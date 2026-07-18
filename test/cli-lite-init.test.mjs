#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderConfigFile } from '../src/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../bin/openspec-buddy.mjs');

function tempFile(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-buddy-lite-init-'));
  return path.join(root, name);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: path.dirname(tempFile('cwd-marker')),
    encoding: 'utf8',
    env: { ...process.env },
  });
}

const liteFile = tempFile('.env.openspec-buddy');
const lite = run(['init', '--yes', '--base-branch', 'integration', '--file', liteFile]);
assert.equal(lite.status, 0, lite.stderr);
const liteText = fs.readFileSync(liteFile, 'utf8');
assert.match(liteText, /^OPENSPEC_BUDDY_BASE_BRANCH=integration$/m);
assert.doesNotMatch(liteText, /OPENSPEC_BUDDY_RELEASE_BRANCH=/);
assert.doesNotMatch(liteText, /OPENSPEC_BUDDY_PROJECT_/);
assert.doesNotMatch(liteText, /OPENSPEC_BUDDY_PR_REVIEW_REQUEST=/);

const fullFile = tempFile('.env.openspec-buddy');
const full = run([
  'init', '--full', '--yes', '--base-branch', 'integration', '--release-branch', 'main',
  '--project-owner', 'acme', '--project-number', '7', '--project-title', 'OpenSpec Work',
  '--review-request', '@codex review', '--file', fullFile,
]);
assert.equal(full.status, 0, full.stderr);
const fullText = fs.readFileSync(fullFile, 'utf8');
for (const key of [
  'OPENSPEC_BUDDY_BASE_BRANCH', 'OPENSPEC_BUDDY_RELEASE_BRANCH',
  'OPENSPEC_BUDDY_PROJECT_OWNER', 'OPENSPEC_BUDDY_PROJECT_NUMBER',
  'OPENSPEC_BUDDY_PROJECT_TITLE', 'OPENSPEC_BUDDY_PR_REVIEW_REQUEST',
]) {
  assert.match(fullText, new RegExp(`^${key}=`,'m'), `full init must write ${key}`);
}

assert.match(fullText, /^OPENSPEC_BUDDY_BASE_BRANCH=integration$/m,
  'a real full init artifact contains the only lite-required key');
assert.match(fullText, /^OPENSPEC_BUDDY_PROJECT_NUMBER=7$/m,
  'the full init artifact also retains its full-only keys');

const renderedLite = renderConfigFile({ OPENSPEC_BUDDY_BASE_BRANCH: 'dev' });
assert.equal(renderedLite.includes('OPENSPEC_BUDDY_BASE_BRANCH=dev'), true);

const help = run(['--help']);
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /openspec-buddy init \[--full\]/);

console.log('lite init tests passed');
