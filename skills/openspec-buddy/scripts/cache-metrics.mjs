#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const [, , command, ...args] = process.argv;
const allowedOutcomes = new Set(['hit', 'miss', 'forced_refresh', 'managed_request', 'stale_recovery']);
const metricsFileName = 'cache-metrics.jsonl';

function usage() {
  process.stderr.write('Usage: cache-metrics.mjs event <cache-dir> <kind> <surface> <outcome> [json-context]\n'
    + '       cache-metrics.mjs summary <cache-dir>\n');
}

function metricsFile(cacheDir) {
  return path.join(path.resolve(cacheDir), metricsFileName);
}

function parseContext(raw = '') {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function appendEvent(cacheDir, kind, surface, outcome, context = {}) {
  if (!allowedOutcomes.has(outcome)) throw new Error(`Unknown metric outcome: ${outcome}`);
  const file = metricsFile(cacheDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const event = {
    ...context,
    at: new Date().toISOString(),
    kind,
    surface,
    outcome,
    source: context.source || process.env.OPENSPEC_BUDDY_METRICS_SOURCE || 'openspec-buddy',
  };
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

function summary(cacheDir) {
  const counters = {
    cacheHit: 0,
    cacheMiss: 0,
    forcedRefresh: 0,
    managedGithubRequestBatches: 0,
    staleRecovery: 0,
  };
  const file = metricsFile(cacheDir);
  if (!fs.existsSync(file)) return counters;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.outcome === 'hit') counters.cacheHit += 1;
    else if (event.outcome === 'miss') counters.cacheMiss += 1;
    else if (event.outcome === 'forced_refresh') counters.forcedRefresh += 1;
    else if (event.outcome === 'managed_request') counters.managedGithubRequestBatches += 1;
    else if (event.outcome === 'stale_recovery') counters.staleRecovery += 1;
  }
  return counters;
}

function main() {
  if (command === 'event') {
    const [cacheDir, kind, surface, outcome, context = ''] = args;
    if (!cacheDir || !kind || !surface || !outcome) {
      usage();
      process.exit(2);
    }
    appendEvent(cacheDir, kind, surface, outcome, parseContext(context));
    return;
  }
  if (command === 'summary') {
    const [cacheDir] = args;
    if (!cacheDir) {
      usage();
      process.exit(2);
    }
    process.stdout.write(`${JSON.stringify(summary(cacheDir))}\n`);
    return;
  }
  usage();
  process.exit(2);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
