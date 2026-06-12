#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , command, ...args] = process.argv;

function readJsonFile(file) {
  if (!file || file === '-' || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function uniqueScopes(scopes) {
  return [...new Set((scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean))];
}

function usage() {
  process.stderr.write(
    'Usage:\n' +
    '  cache-signal-commit.mjs next <repo> <kind> <scopes-file> <previous-payload-file|- > [viewer]\n',
  );
}

if (command !== 'next') {
  usage();
  process.exit(2);
}

const [repo, kind, scopesFile, previousFile = '-', viewer = 'unknown'] = args;
if (!repo || !kind || !scopesFile) {
  usage();
  process.exit(2);
}

const previous = readJsonFile(previousFile) || {};
const scopes = uniqueScopes(readJsonFile(scopesFile) || []);
const nextSequence = Number(previous.sequence || 0) + 1;
const event = { sequence: nextSequence, kind, scopes };
const previousEvents = Array.isArray(previous.recentEvents) ? previous.recentEvents : [];
const recentEvents = [...previousEvents, event].slice(-32);
const now = new Date().toISOString();

const payload = {
  version: 2,
  sequence: nextSequence,
  generation: nextSequence,
  repo,
  updatedAt: now,
  writer: {
    viewer,
    host: process.env.OPENSPEC_BUDDY_SIGNAL_HOST || os.hostname() || 'unknown',
    worktree: process.env.OPENSPEC_BUDDY_SIGNAL_WORKTREE || path.basename(process.cwd()),
    pid: process.pid,
  },
  event,
  recentEvents,
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
