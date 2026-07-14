import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const detector = path.join(repoRoot, 'skills/openspec-buddy/scripts/detect-method-skills.mjs');
const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function addSkill(root, name) {
  const skillDirectory = path.join(root, name);
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), `# ${name}\n`);
}

function detect({ roots = [], home = temporaryDirectory('buddy-method-home-') } = {}) {
  const result = spawnSync(process.execPath, [detector], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      OPENSPEC_BUDDY_SKILL_ROOTS: roots.join(path.delimiter),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

try {
  const allRoot = temporaryDirectory('buddy-method-all-');
  addSkill(allRoot, 'grilling');
  addSkill(allRoot, 'research');
  addSkill(allRoot, 'prototype');
  assert.deepEqual(detect({ roots: [allRoot] }), {
    grilling: 'available',
    research: 'available',
    prototype: 'available',
  });

  const partialRoot = temporaryDirectory('buddy-method-partial-');
  addSkill(partialRoot, 'research');
  assert.deepEqual(detect({ roots: [partialRoot] }), {
    grilling: 'unavailable',
    research: 'available',
    prototype: 'unavailable',
  });

  assert.deepEqual(detect(), {
    grilling: 'unavailable',
    research: 'unavailable',
    prototype: 'unavailable',
  });

  const unreadableRoot = temporaryDirectory('buddy-method-unreadable-');
  addSkill(unreadableRoot, 'prototype');
  fs.chmodSync(unreadableRoot, 0o000);
  try {
    assert.deepEqual(detect({ roots: [unreadableRoot] }), {
      grilling: 'unavailable',
      research: 'unavailable',
      prototype: 'unavailable',
    });
  } finally {
    fs.chmodSync(unreadableRoot, 0o700);
  }

  console.log('method skill detector eval passed');
} finally {
  for (const directory of temporaryDirectories.reverse()) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
