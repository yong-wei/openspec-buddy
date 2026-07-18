#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const controller = await import(pathToFileURL(path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/full/controller-state.mjs')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-auto-controller-fast-'));

function makeExecutable(file, body) {
  fs.writeFileSync(file, body, { mode: 0o755 });
}

function withEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function makeRepo(name) {
  const root = path.join(tmp, name);
  const binDir = path.join(root, 'bin');
  const repoDir = path.join(root, 'repo');
  const stateDir = path.join(root, 'controller');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  makeExecutable(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "rev-parse" && "\${2:-}" == "--show-toplevel" ]]; then printf '%s\\n' ${JSON.stringify(repoDir)}; exit 0; fi
if [[ "\${1:-}" == "rev-parse" && "\${2:-}" == "--git-common-dir" ]]; then printf '%s\\n' ${JSON.stringify(path.join(root, 'git-common'))}; exit 0; fi
if [[ "\${1:-}" == "config" && "\${2:-}" == "--worktree" ]]; then
  case "\${3:-}" in
    buddy.worktreeAlias) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBranch) printf 'dev1\\n'; exit 0 ;;
    buddy.boundBase) printf 'origin/integration\\n'; exit 0 ;;
  esac
fi
exit 1
`);
  return { binDir, repoDir, stateDir };
}

function runWithRepo(repo, fn) {
  return withEnv({
    PATH: `${repo.binDir}:${process.env.PATH}`,
    OPENSPEC_BUDDY_AUTO_CONTROLLER_STATE_DIR: repo.stateDir,
  }, fn);
}

{
  const repo = makeRepo('single-to-multi');
  runWithRepo(repo, () => {
    let state = controller.initializeControllerState({ mode: 'single' }, { cwd: repo.repoDir });
    assert.equal(state.mode, 'single');
    state = controller.initializeControllerState({ mode: 'multi', goal: true, maxLanes: '2' }, { cwd: repo.repoDir });
    assert.equal(state.mode, 'multi');
    assert.equal(state.goal, true);
    assert.equal(state.maxLanes, 2);
  });
}

{
  const repo = makeRepo('empty-target-seed');
  runWithRepo(repo, () => {
    let state = controller.initializeControllerState({}, { cwd: repo.repoDir });
    assert.equal(state.target.issue, '');
    state = controller.initializeControllerState({ issue: '456', goal: true }, { cwd: repo.repoDir });
    assert.equal(state.target.issue, '456');
    assert.equal(state.goal, true);
  });
}

{
  const repo = makeRepo('empty-change-target-seed');
  runWithRepo(repo, () => {
    let state = controller.initializeControllerState({}, { cwd: repo.repoDir });
    assert.equal(state.target.change, '');
    state = controller.initializeControllerState({ change: 'local-change', goal: true }, { cwd: repo.repoDir });
    assert.equal(state.target.change, 'local-change');
    assert.equal(state.goal, true);
  });
}

{
  const repo = makeRepo('interrupt-not-upgraded');
  runWithRepo(repo, () => {
    let state = controller.initializeControllerState({ mode: 'single', issue: '123' }, { cwd: repo.repoDir });
    state = controller.writeInterrupt(state, {
      type: 'handoff',
      stage: 'implement-or-open-pr',
      issue: '123',
      allowedWork: 'finish current work',
    }, { cwd: repo.repoDir });
    state = controller.initializeControllerState({ mode: 'multi', goal: true, maxLanes: '2' }, { cwd: repo.repoDir });
    assert.equal(state.mode, 'single');
    assert.equal(state.goal, false);
    assert.equal(state.interrupt.stage, 'implement-or-open-pr');
  });
}

console.log('buddy-auto-controller fast tests passed');
