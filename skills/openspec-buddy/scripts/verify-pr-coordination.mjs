#!/usr/bin/env node

import fs from 'node:fs';

const [
  issueFile,
  prFile,
  metadataFile,
  labelsFile,
  baseBranch,
  projectTitle,
  inProgressStatus,
  developmentLinkMode,
  defaultBranch,
  reviewRequest,
] = process.argv.slice(2);

if (
  !issueFile
  || !prFile
  || !metadataFile
  || !labelsFile
  || !baseBranch
  || !projectTitle
  || !inProgressStatus
  || !developmentLinkMode
  || !defaultBranch
) {
  process.stderr.write(
    'Usage: verify-pr-coordination.mjs <issue-json> <pr-json> <metadata-json> <labels-file> <base-branch> <project-title> <in-progress-status> <development-link-mode> <default-branch> [review-request]\n',
  );
  process.exit(2);
}

const issue = JSON.parse(fs.readFileSync(issueFile, 'utf8'));
const pr = JSON.parse(fs.readFileSync(prFile, 'utf8'));
const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
const expectedLabels = fs.readFileSync(labelsFile, 'utf8').split(/\n/).filter(Boolean);
const errors = [];

const prLabels = new Set((pr.labels || []).map((label) => label.name));
const issueAssignees = (issue.assignees || []).map((assignee) => assignee.login).filter(Boolean);
const prAssignees = new Set((pr.assignees || []).map((assignee) => assignee.login));
const prProjectItem = (pr.projectItems || []).find((item) => item.title === projectTitle);
const body = String(pr.body || '');
const comments = (pr.comments || []).map((comment) => String(comment.body || ''));
const issueNumber = String(issue.number);

if (pr.baseRefName !== baseBranch) {
  errors.push(`PR base is ${pr.baseRefName}; expected ${baseBranch}`);
}
if (pr.isDraft) {
  errors.push('PR is draft; Buddy PRs must be ready for review');
}
for (const label of expectedLabels) {
  if (!prLabels.has(label)) {
    errors.push(`PR label missing: ${label}`);
  }
}
if (issueAssignees.length === 0) {
  errors.push('Issue has no assignee to mirror onto the PR');
}
for (const login of issueAssignees) {
  if (!prAssignees.has(login)) {
    errors.push(`PR assignee missing: ${login}`);
  }
}
if (!prProjectItem) {
  errors.push(`PR is not in project ${projectTitle}`);
} else if (prProjectItem.status?.name !== inProgressStatus) {
  errors.push(`PR project status is ${prProjectItem.status?.name || 'none'}; expected ${inProgressStatus}`);
}
if (!body.includes(`openspec-buddy-origin-issue:${issueNumber}`) || !body.includes(`Origin issue: #${issueNumber}`)) {
  errors.push(`PR body does not record origin issue #${issueNumber}`);
}
if (!reviewRequest) {
  errors.push('OPENSPEC_BUDDY_PR_REVIEW_REQUEST is not configured');
} else if (!comments.some((comment) => comment.includes(reviewRequest))) {
  errors.push('PR review request comment is missing');
}

const shouldUseKeyword = developmentLinkMode === 'keyword'
  || (developmentLinkMode === 'auto' && pr.baseRefName === defaultBranch);
const closingIssueNumbers = new Set((pr.closingIssuesReferences || []).map((entry) => String(entry.number)));
if (shouldUseKeyword && !closingIssueNumbers.has(issueNumber)) {
  errors.push(`PR closingIssuesReferences does not include #${issueNumber}`);
}
if (!shouldUseKeyword && ['auto', 'manual'].includes(developmentLinkMode)) {
  if (!body.includes('manual GitHub sidebar link required')) {
    errors.push('PR body does not record the manual Development sidebar link requirement');
  }
}
if (developmentLinkMode === 'off' && !body.includes('Development link: disabled')) {
  errors.push('PR body does not record disabled Development-link mode');
}

const changeId = String(metadata.change_id || '');
if (changeId) {
  const activePrefix = `openspec/changes/${changeId}/`;
  const archivePattern = new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${changeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
  for (const file of pr.files || []) {
    const filePath = file.path || '';
    if (filePath.startsWith('openspec/changes/') && !filePath.startsWith(activePrefix) && !archivePattern.test(filePath)) {
      errors.push(`PR touches another OpenSpec change path: ${filePath}`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`PR coordination verification failed:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
