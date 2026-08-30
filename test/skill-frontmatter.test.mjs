import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publishedSkills = [
  {
    name: 'openspec-buddy',
    compatibility: 'Requires openspec CLI and GitHub CLI.',
  },
  {
    name: 'openspec-buddy-auto',
    compatibility: 'Requires openspec CLI, GitHub CLI, OpenSpec Buddy, and foreground access to live PR review facts.',
  },
];

function readFrontmatter(skillName) {
  const skillPath = path.join(repoRoot, 'skills', skillName, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, `${skillName} must have parseable frontmatter`);
  return match[1];
}

for (const { name, compatibility } of publishedSkills) {
  const frontmatter = readFrontmatter(name);
  assert.doesNotMatch(
    frontmatter,
    /^compatibility\s*:/m,
    `${name} must not use the disallowed top-level compatibility property`,
  );
  const metadataCompatibility = frontmatter.match(/^  compatibility:\s*(.+)$/m);
  assert.ok(metadataCompatibility, `${name} must retain compatibility under metadata`);
  assert.equal(metadataCompatibility[1], compatibility, `${name} compatibility metadata changed`);
}

console.log('skill frontmatter compatibility tests passed');
