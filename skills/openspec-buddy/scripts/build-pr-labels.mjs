#!/usr/bin/env node

import fs from 'node:fs';

const [issueFile, prFile, labelsFile, prLabelsFile] = process.argv.slice(2);

if (!issueFile || !prFile || !labelsFile || !prLabelsFile) {
  process.stderr.write('Usage: build-pr-labels.mjs <issue-json> <pr-json> <labels-file> <pr-labels-file>\n');
  process.exit(2);
}

const issue = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));

const inheritedPrefixes = new Set(['type', 'level', 'area', 'series', 'risk', 'mode', 'coupling']);

function normalizeLabelName(label) {
  const name = typeof label === 'string' ? label : label?.name;
  if (!name) return '';
  return name.replace(/^(status|type|level|area|series|risk|mode|coupling):\s+/, '$1:');
}

function normalizeLabels(labels) {
  if (Array.isArray(labels)) return labels;
  if (Array.isArray(labels?.nodes)) return labels.nodes;
  return [];
}

function baseSlug(baseRefName) {
  return String(baseRefName || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function isInherited(labelName) {
  const separator = labelName.indexOf(':');
  if (separator === -1) return false;
  return inheritedPrefixes.has(labelName.slice(0, separator));
}

const issueLabels = normalizeLabels(issue.labels).map(normalizeLabelName).filter(Boolean);
const inherited = issueLabels.filter(isInherited);
const prLabels = ['pr:openspec-buddy', `pr:base-${baseSlug(pr.baseRefName)}`];
const labels = [...new Set([...prLabels, ...inherited])];

fs.writeFileSync(labelsFile, `${labels.join('\n')}\n`);
fs.writeFileSync(prLabelsFile, `${prLabels.join('\n')}\n`);
