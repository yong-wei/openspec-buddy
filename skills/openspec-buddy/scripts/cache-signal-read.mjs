#!/usr/bin/env node

import fs from 'node:fs';

const [, , command, ...args] = process.argv;

function readJsonFile(file) {
  if (!file || file === '-' || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function unwrapCacheEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if ('data' in value && value.data && typeof value.data === 'object' && !Array.isArray(value.data)) {
    return value.data;
  }
  return value;
}

function uniqueScopes(scopes) {
  return [...new Set((scopes || []).map((scope) => String(scope || '').trim()).filter(Boolean))];
}

function usage() {
  process.stderr.write(
    'Usage:\n' +
    '  cache-signal-read.mjs scopes <state-file|- > <payload-file>\n' +
    '  cache-signal-read.mjs state <repo> <ref> <tip-sha> <payload-file>\n',
  );
}

if (command === 'scopes') {
  const [stateFile = '-', payloadFile] = args;
  if (!payloadFile) {
    usage();
    process.exit(2);
  }

  const state = unwrapCacheEntry(readJsonFile(stateFile)) || {};
  const payload = unwrapCacheEntry(readJsonFile(payloadFile)) || {};
  const previousSequence = Number(state.sequence || 0);
  const latestSequence = Number(payload.sequence || 0);
  const recentEvents = Array.isArray(payload.recentEvents) ? payload.recentEvents : [];
  const event = payload.event && typeof payload.event === 'object' ? payload.event : null;
  if (event && !recentEvents.some((entry) => Number(entry.sequence) === Number(event.sequence))) {
    recentEvents.push(event);
  }

  let conservative = false;
  let scopes = [];
  const earliestSequence = recentEvents.length > 0 ? Math.min(...recentEvents.map((entry) => Number(entry.sequence || 0)).filter(Number.isFinite)) : latestSequence;

  if (previousSequence > 0 && recentEvents.length > 0 && previousSequence < earliestSequence - 1) {
    conservative = true;
  } else {
    scopes = uniqueScopes(
      recentEvents
        .filter((entry) => Number(entry.sequence || 0) > previousSequence)
        .flatMap((entry) => entry.scopes || []),
    );
  }

  if (conservative) {
    scopes = uniqueScopes(['ready-scan', ...recentEvents.flatMap((entry) => entry.scopes || [])]);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        sequence: latestSequence,
        generation: Number(payload.generation || latestSequence || 0),
        scopes,
        conservative,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (command === 'state') {
  const [repo, ref, tipSha, payloadFile] = args;
  if (!repo || !ref || !tipSha || !payloadFile) {
    usage();
    process.exit(2);
  }
  const payload = unwrapCacheEntry(readJsonFile(payloadFile)) || {};
  process.stdout.write(
    `${JSON.stringify(
      {
        repo,
        ref,
        tipSha,
        sequence: Number(payload.sequence || 0),
        generation: Number(payload.generation || payload.sequence || 0),
        appliedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

usage();
process.exit(2);
