#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const capabilities = ['grilling', 'research', 'prototype'];
const configuredRoots = (process.env.OPENSPEC_BUDDY_SKILL_ROOTS ?? '')
  .split(path.delimiter)
  .filter(Boolean);
const roots = [
  ...configuredRoots,
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), '.codex', 'skills'),
];

function hasSkill(root, capability) {
  try {
    fs.accessSync(root, fs.constants.R_OK);
    const skillDirectory = path.basename(root) === capability
      ? root
      : path.join(root, capability);
    fs.accessSync(path.join(skillDirectory, 'SKILL.md'), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const result = Object.fromEntries(
  capabilities.map((capability) => [
    capability,
    roots.some((root) => hasSkill(root, capability)) ? 'available' : 'unavailable',
  ]),
);

process.stdout.write(`${JSON.stringify(result)}\n`);
