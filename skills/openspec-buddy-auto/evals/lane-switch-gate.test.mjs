#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const helper = path.join(repoRoot, 'skills/openspec-buddy-auto/scripts/full/lane-switch-gate.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-lane-switch-'));
const binDir = path.join(tmp, 'bin');
const coreDir = path.join(tmp, 'core');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(coreDir, { recursive: true });

fs.writeFileSync(path.join(binDir, 'git'), `#!/bin/bash
set -euo pipefail
case "\${1:-}" in
  status)
    if [[ "\${DIRTY:-0}" == "1" ]]; then printf ' M file.txt\\n'; fi
    exit 0
    ;;
  branch)
    if [[ "\${2:-}" == "--show-current" ]]; then printf '%s\\n' "\${CURRENT_BRANCH:-change-branch}"; exit 0; fi
    ;;
  rev-parse)
    if [[ "\${2:-}" == "HEAD" ]]; then printf 'head-1\\n'; exit 0; fi
    ;;
  ls-remote)
    if [[ "\${4:-}" == "change-branch" ]]; then printf 'head-1\\trefs/heads/change-branch\\n'; exit 0; fi
    exit 0
    ;;
  switch)
    printf 'switch %s\\n' "\${2:-}" >> "${tmp}/switch.log"
    exit 0
    ;;
esac
echo "unexpected git invocation: $*" >&2
exit 99
`, { mode: 0o755 });

fs.writeFileSync(path.join(binDir, 'gh'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "pr" && "\${2:-}" == "view" ]]; then
  printf '%s\\n' '{"number":707,"state":"OPEN","headRefName":"change-branch","headRefOid":"head-1"}'
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 99
`, { mode: 0o755 });

fs.writeFileSync(path.join(coreDir, 'verify-claim-worktree.sh'), `#!/bin/bash
set -euo pipefail
echo "claim $*" >> "${tmp}/core.log"
`, { mode: 0o755 });
fs.writeFileSync(path.join(coreDir, 'verify-current-head-review-request.sh'), `#!/bin/bash
set -euo pipefail
echo "request $*" >> "${tmp}/core.log"
`, { mode: 0o755 });

function run(extraEnv = {}) {
  return spawnSync(process.execPath, [
    helper,
    '--safe-yield',
    '--issue', '675',
    '--pr', '707',
    '--branch', 'change-branch',
    '--head', 'head-1',
  ], {
    cwd: tmp,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      OPENSPEC_BUDDY_CORE_SCRIPT_DIR: coreDir,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

{
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.match(fs.readFileSync(path.join(tmp, 'core.log'), 'utf8'), /claim --issue 675 --pr 707/);
  assert.match(fs.readFileSync(path.join(tmp, 'core.log'), 'utf8'), /request 707/);
}

{
  const result = run({ DIRTY: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dirty/);
}

{
  const result = run({ CURRENT_BRANCH: 'other-branch' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /wrong branch/);
}

console.log('lane-switch-gate tests passed');
