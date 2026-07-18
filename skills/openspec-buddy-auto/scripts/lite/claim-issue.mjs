#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseLiteClaimComment } from './contracts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const statusHelper = process.env.OPENSPEC_BUDDY_LITE_STATUS_HELPER || path.join(here, 'set-issue-status.sh');

function command(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function json(file, args) {
  const output = command(file, args);
  return output ? JSON.parse(output) : null;
}

function attempt(file, args) {
  return spawnSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function labels(issue) {
  return (issue.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
}

function assignees(issue) {
  return (issue.assignees || []).map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login).filter(Boolean);
}

function readBranch(repo, branch) {
  const result = attempt('gh', ['api', `repos/${repo}/git/ref/heads/${branch}`]);
  if (result.status === 0) return true;
  const detail = `${result.stderr || ''}\n${result.stdout || ''}`;
  if (/404|not found/i.test(detail)) return false;
  throw new Error(`Could not read claim branch ${branch}: ${detail.trim() || `exit ${result.status}`}`);
}

function classifyTruth(truth, expected) {
  const statuses = labels(truth.issue).filter((label) => label.startsWith('status:'));
  const owners = assignees(truth.issue);
  const claims = truth.comments.map((comment) => parseLiteClaimComment(comment?.body ?? comment)).filter(Boolean);
  const claim = claims.at(-1) || null;
  const commentMatchesTarget = claim
    && claim.issue === expected.issue
    && claim.changeId === expected.changeId
    && claim.branch === expected.changeId;
  const commentIsCurrent = commentMatchesTarget
    && claim.viewer === expected.viewer
    && claim.worktree === expected.worktree;
  const current = truth.branch
    && String(truth.issue?.state || '').toUpperCase() === 'OPEN'
    && statuses.length === 1
    && statuses[0] === 'status:claimed'
    && owners.length === 1
    && owners[0] === expected.viewer
    && commentIsCurrent;
  if (current) return 'current';
  if (commentMatchesTarget && (claim.viewer !== expected.viewer || claim.worktree !== expected.worktree)) return 'foreign';
  const cleanReady = statuses.length === 1
    && String(truth.issue?.state || '').toUpperCase() === 'OPEN'
    && statuses[0] === 'status:ready'
    && owners.length === 0
    && claims.length === 0
    && !truth.branch;
  return cleanReady ? 'unclaimed' : 'partial';
}

function emit(result, expected) {
  process.stdout.write(`${JSON.stringify({
    mode: 'lite',
    result,
    issue: expected.issue,
    change_id: expected.changeId,
    branch: expected.changeId,
  })}\n`);
}

try {
  const issueNumber = Number(process.argv[2]);
  const changeId = String(process.argv[3] || '');
  if (!Number.isInteger(issueNumber) || issueNumber < 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId)) {
    throw new Error('Usage: claim-issue.mjs <issue-number> <change-id>');
  }

  const repo = json('gh', ['repo', 'view', '--json', 'nameWithOwner'])?.nameWithOwner;
  const viewer = json('gh', ['api', 'user'])?.login;
  if (!repo || !viewer) throw new Error('Could not resolve GitHub repository and viewer.');
  let worktree = '';
  try {
    worktree = command('git', ['config', '--worktree', 'buddy.worktreeAlias']);
  } catch {
    const root = fs.realpathSync(command('git', ['rev-parse', '--show-toplevel']));
    worktree = `worktree-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
  }
  let baseBranch = String(process.env.OPENSPEC_BUDDY_BASE_BRANCH || '').trim();
  if (!baseBranch) {
    try {
      baseBranch = command('git', ['config', '--worktree', 'buddy.boundBase'])
        .replace(/^refs\/remotes\/origin\//, '')
        .replace(/^origin\//, '');
    } catch {
      // Report the missing configured base below.
    }
  }
  if (!baseBranch || !/^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/.test(baseBranch) || baseBranch.includes('..')) {
    throw new Error('A valid configured base branch is required for Lite Claim.');
  }
  const expected = { issue: issueNumber, changeId, viewer, worktree };

  function readTruth() {
    const issue = json('gh', ['api', `repos/${repo}/issues/${issueNumber}`]);
    const commentsResponse = json('gh', ['api', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`, '--paginate', '--slurp']) || [];
    const comments = Array.isArray(commentsResponse[0]) ? commentsResponse.flat() : commentsResponse;
    return { issue, comments, branch: readBranch(repo, changeId) };
  }

  const initial = classifyTruth(readTruth(), expected);
  if (initial === 'current') {
    emit('current_claim', expected);
  } else if (initial !== 'unclaimed') {
    throw new Error(`Issue #${issueNumber} has ${initial} Claim truth.`);
  } else {
    const recoverFailedWrite = (result, action) => {
      if (result.status === 0) return;
      const recovered = classifyTruth(readTruth(), expected);
      if (recovered === 'current') {
        emit('current_claim', expected);
        process.exit(0);
      }
      const detail = String(result.stderr || result.stdout || '').trim();
      throw new Error(`${action} failed; complete Claim reread is ${recovered}.${detail ? ` ${detail}` : ''}`);
    };

    const baseRef = json('gh', ['api', `repos/${repo}/git/ref/heads/${baseBranch}`]);
    const baseSha = String(baseRef?.object?.sha || '');
    if (!/^[0-9a-f]{40}$/i.test(baseSha)) throw new Error(`Could not resolve remote base branch ${baseBranch} SHA.`);
    recoverFailedWrite(attempt('gh', [
      'api', '--method', 'POST', `repos/${repo}/git/refs`,
      '-f', `ref=refs/heads/${changeId}`,
      '-f', `sha=${baseSha}`,
    ]), 'Claim branch creation');
    recoverFailedWrite(attempt('gh', ['issue', 'edit', String(issueNumber), '--add-assignee', viewer]), 'Claim assignee write');
    const comment = [
      'OpenSpec Buddy Claim',
      '',
      `issue: ${issueNumber}`,
      `change_id: ${changeId}`,
      `branch: ${changeId}`,
      `agent: codex/${viewer}`,
      `worktree_alias: ${worktree}`,
    ].join('\n');
    recoverFailedWrite(attempt('gh', ['issue', 'comment', String(issueNumber), '--body', comment]), 'Claim comment write');
    recoverFailedWrite(attempt(statusHelper, [String(issueNumber), 'claimed']), 'Claim status write');

    const final = classifyTruth(readTruth(), expected);
    if (final !== 'current') throw new Error(`Claim verification failed: complete Claim truth is ${final}.`);
    emit('claimed', expected);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
