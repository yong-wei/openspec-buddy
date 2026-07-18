#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIdentity, classifyIssueClaim, parseChangeMapping } from './contracts.mjs';

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

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.length >= 2 && (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  )) {
    return value.slice(1, -1);
  }
  return value;
}

function readProjectBaseBranch(worktreeRoot) {
  const configuredPath = String(process.env.OPENSPEC_BUDDY_ENV_FILE || '').trim();
  const envFile = configuredPath
    ? path.resolve(configuredPath)
    : path.join(worktreeRoot, '.env.openspec-buddy');
  if (!fs.statSync(envFile, { throwIfNoEntry: false })?.isFile()) return '';

  const lines = fs.readFileSync(envFile, 'utf8').split(/\n/);
  let baseBranch = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) {
      throw new Error(`Invalid OpenSpec Buddy env file line: ${envFile}:${index + 1}`);
    }
    if (assignment[1] === 'OPENSPEC_BUDDY_BASE_BRANCH' && !baseBranch) {
      baseBranch = decodeEnvValue(assignment[2]).trim();
    }
  }
  return baseBranch;
}

function readBranch(repo, branch) {
  const result = attempt('gh', ['api', `repos/${repo}/git/ref/heads/${branch}`]);
  if (result.status === 0) return true;
  const detail = `${result.stderr || ''}\n${result.stdout || ''}`;
  if (/404|not found/i.test(detail)) return false;
  throw new Error(`Could not read claim branch ${branch}: ${detail.trim() || `exit ${result.status}`}`);
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
    // The shared identity contract supplies the canonical-path fallback.
  }
  const worktreeRoot = fs.realpathSync(command('git', ['rev-parse', '--show-toplevel']));
  const identity = buildIdentity(viewer, worktree, worktreeRoot);
  let baseBranch = String(process.env.OPENSPEC_BUDDY_BASE_BRANCH || '').trim();
  if (!baseBranch) {
    baseBranch = readProjectBaseBranch(worktreeRoot);
  }
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
  const expected = { issue: issueNumber, changeId, ...identity };

  function readTruth() {
    const issue = json('gh', ['api', `repos/${repo}/issues/${issueNumber}`]);
    const commentsResponse = json('gh', ['api', `repos/${repo}/issues/${issueNumber}/comments?per_page=100`, '--paginate', '--slurp']) || [];
    const comments = Array.isArray(commentsResponse[0]) ? commentsResponse.flat() : commentsResponse;
    return { issue, comments, branch: readBranch(repo, changeId) };
  }

  function classifyTruth(truth) {
    if (String(truth.issue?.state || '').toUpperCase() !== 'OPEN') {
      throw new Error(`Issue #${issueNumber} must remain open throughout Claim.`);
    }
    const mapping = parseChangeMapping(truth.issue?.body || '');
    if (mapping.conflict || mapping.changeId !== changeId || mapping.sources.length !== 1) {
      throw new Error(`Issue #${issueNumber} mapping must uniquely remain ${changeId}; observed ${mapping.changeId || 'none'}.`);
    }
    const claimClass = classifyIssueClaim(truth.issue, truth.comments, identity, {
      branchExists: truth.branch,
      issue: issueNumber,
      changeId,
      branch: changeId,
    });
    if (claimClass === 'unclaimed'
      && !fs.statSync(path.join(worktreeRoot, 'openspec', 'changes', changeId), { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Local change ${changeId} does not exist.`);
    }
    return claimClass;
  }

  const initial = classifyTruth(readTruth());
  if (initial === 'current') {
    emit('current_claim', expected);
  } else if (initial !== 'unclaimed') {
    throw new Error(`Issue #${issueNumber} has ${initial} Claim truth.`);
  } else {
    const recoverFailedWrite = (result, action) => {
      if (result.status === 0) return;
      const recovered = classifyTruth(readTruth());
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
      `agent: ${identity.agent}`,
      `worktree_alias: ${identity.worktree}`,
    ].join('\n');
    recoverFailedWrite(attempt('gh', ['issue', 'comment', String(issueNumber), '--body', comment]), 'Claim comment write');
    recoverFailedWrite(attempt(statusHelper, [String(issueNumber), 'claimed']), 'Claim status write');

    const final = classifyTruth(readTruth());
    if (final !== 'current') throw new Error(`Claim verification failed: complete Claim truth is ${final}.`);
    emit('claimed', expected);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
