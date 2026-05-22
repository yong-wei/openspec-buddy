#!/usr/bin/env node

import fs from 'node:fs';

const [prFile, issueNumber, defaultBranch, mode = 'auto', bodyFile, reportFile] = process.argv.slice(2);

if (!prFile || !issueNumber || !defaultBranch || !bodyFile || !reportFile) {
  process.stderr.write('Usage: build-pr-development-note.mjs <pr-json> <issue-number> <default-branch> <auto|keyword|manual|off> <body-file> <report-file>\n');
  process.exit(2);
}

const allowedModes = new Set(['auto', 'keyword', 'manual', 'off']);
if (!allowedModes.has(mode)) {
  process.stderr.write(`Invalid OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE: ${mode}\n`);
  process.exit(3);
}

const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
const marker = `<!-- openspec-buddy-origin-issue:${issueNumber} -->`;
const current = String(pr.body || '').trimEnd();
const base = String(pr.baseRefName || '');
const canUseKeyword = base === defaultBranch;
const shouldUseKeyword = mode === 'keyword' || (mode === 'auto' && canUseKeyword);
const closing = new RegExp(String.raw`(^|[\s\n])(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+(#${issueNumber}|\w+/\w+#${issueNumber})(?=$|[\s\n.,;:])`, 'i');

if (mode === 'keyword' && !canUseKeyword) {
  process.stderr.write(`Cannot create a verifiable PR Development link for #${issueNumber}: PR base "${base}" is not the repository default branch "${defaultBranch}". Retarget to the default branch or link the PR manually in GitHub.\n`);
  process.exit(4);
}

let linkLine = '';
let modeNote = mode;
if (shouldUseKeyword) {
  linkLine = `Development link: Closes #${issueNumber}`;
  modeNote = 'keyword';
} else if (mode === 'manual' || (mode === 'auto' && !canUseKeyword)) {
  linkLine = `Development link: manual GitHub sidebar link required; PR base "${base}" is not repository default "${defaultBranch}".`;
  modeNote = 'manual';
} else {
  linkLine = 'Development link: disabled by OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=off.';
  modeNote = 'off';
}

const report = { mode: modeNote, base, defaultBranch, keyword: shouldUseKeyword };
fs.writeFileSync(reportFile, JSON.stringify(report));

if (current.includes(marker) && (!shouldUseKeyword || closing.test(current))) {
  fs.writeFileSync(bodyFile, current ? `${current}\n` : '');
  process.exit(2);
}

const note = current.includes(marker)
  ? linkLine
  : `${marker}\n\n## OpenSpec Buddy\n\nOrigin issue: #${issueNumber}\n${linkLine}`;
fs.writeFileSync(bodyFile, current ? `${current}\n\n${note}\n` : `${note}\n`);
