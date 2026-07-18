import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ACTIVE_CLAIM_STATUSES = Object.freeze([
  'status:claimed',
  'status:in-progress',
  'status:in-review',
]);

export function localDeliveryExists(worktreeRoot, changeId) {
  if (fs.statSync(path.join(worktreeRoot, 'openspec', 'changes', changeId), { throwIfNoEntry: false })?.isDirectory()) {
    return true;
  }
  const archiveRoot = path.join(worktreeRoot, 'openspec', 'changes', 'archive');
  if (!fs.statSync(archiveRoot, { throwIfNoEntry: false })?.isDirectory()) return false;
  const escaped = changeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const archivePattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`);
  return fs.readdirSync(archiveRoot, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && archivePattern.test(entry.name));
}

function scalar(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function field(block, name) {
  const match = String(block || '').match(new RegExp(`^\\s*${name}\\s*:\\s*(.*?)\\s*$`, 'm'));
  return match ? scalar(match[1]) : '';
}

export function parseChangeMapping(markdown) {
  const body = String(markdown || '');
  const found = [];
  for (const marker of body.matchAll(/<!--\s*openspec-buddy\s+change_id\s*:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->/gi)) {
    found.push({ source: 'marker', changeId: marker[1] });
  }

  for (const hidden of body.matchAll(/<!--\s*openspec-buddy\s*\r?\n([\s\S]*?)\r?\n\s*-->/gi)) {
    const hiddenChange = field(hidden[1], 'change_id');
    if (hiddenChange) found.push({ source: 'hidden', changeId: hiddenChange });
  }

  const frontMatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const frontChange = frontMatter ? field(frontMatter[1], 'change_id') : '';
  if (frontChange) found.push({ source: 'front-matter', changeId: frontChange });

  const changeIds = [...new Set(found.map((entry) => entry.changeId))];
  return {
    changeId: changeIds.length === 1 ? changeIds[0] : null,
    conflict: changeIds.length > 1,
    sources: found,
  };
}

export function parseLiteClaimComment(body) {
  const text = String(body || '');
  if (!/^OpenSpec Buddy Claim\s*$/m.test(text)) return null;
  const agent = field(text, 'agent').replace(/^@/, '');
  return {
    issue: Number(field(text, 'issue')) || null,
    agent: agent.startsWith('codex/') ? agent : `codex/${agent}`,
    viewer: agent.replace(/^codex\//, ''),
    changeId: field(text, 'change_id'),
    branch: field(text, 'branch'),
    worktree: field(text, 'worktree_alias'),
  };
}

export function buildIdentity(viewer, worktreeAlias = '', realWorktree = '') {
  const normalizedViewer = String(viewer || '').trim().replace(/^@/, '').replace(/^codex\//, '');
  const alias = String(worktreeAlias || '').trim();
  const real = String(realWorktree || '').trim();
  return {
    agent: `codex/${normalizedViewer}`,
    viewer: normalizedViewer,
    worktree: alias || (real ? `worktree-${createHash('sha256').update(real).digest('hex').slice(0, 12)}` : ''),
  };
}

export function branchExistsFromRefResult(result, branch) {
  const detail = `${result?.stderr || ''}\n${result?.stdout || ''}`.trim();
  if (result?.status !== 0) {
    if (/\b(?:HTTP\s+)?404\b/i.test(detail)) return false;
    throw new Error(`Could not read claim branch ${branch}: ${detail || `exit ${result?.status}`}`);
  }

  let response;
  try {
    response = JSON.parse(String(result.stdout || ''));
  } catch (error) {
    throw new Error(`Could not read claim branch ${branch}: invalid GitHub ref response (${error.message})`);
  }
  return !Array.isArray(response) && response?.ref === `refs/heads/${branch}`;
}

function activeClaimsFrom(comments) {
  const active = [];
  for (const comment of comments || []) {
    const body = comment?.body ?? comment;
    const claim = parseLiteClaimComment(body);
    if (claim) active.push(claim);
  }
  return active;
}

export function classifyIssueClaim(issue, comments, identity, expected = {}) {
  const labels = (issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
  const statuses = labels.filter((label) => label.startsWith('status:'));
  const assignees = (issue?.assignees || []).map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login).filter(Boolean);
  const claims = activeClaimsFrom(comments);
  const claim = claims.at(-1) || null;
  const branchExists = expected.branchExists === true;
  const cleanReady = String(issue?.state || '').toUpperCase() === 'OPEN'
    && statuses.length === 1
    && statuses[0] === 'status:ready'
    && assignees.length === 0
    && claims.length === 0
    && !branchExists;
  if (cleanReady) return 'unclaimed';

  const targetMatches = claim
    && (!expected.issue || claim.issue === Number(expected.issue))
    && (!expected.changeId || claim.changeId === expected.changeId)
    && (!expected.branch || claim.branch === expected.branch);
  const complete = Boolean(claim)
    && branchExists
    && String(issue?.state || '').toUpperCase() === 'OPEN'
    && statuses.length === 1
    && ACTIVE_CLAIM_STATUSES.includes(statuses[0])
    && assignees.length === 1
    && targetMatches
    && claim.viewer === assignees[0]
    && Boolean(claim.agent && claim.worktree);
  if (complete) {
    return claim.agent === identity?.agent && claim.worktree === identity?.worktree ? 'current' : 'foreign';
  }
  return 'partial';
}

export function summarizeIssueClaim(issue, comments, branchExists) {
  const statuses = (issue?.labels || [])
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter((label) => label?.startsWith('status:'));
  const assignees = (issue?.assignees || [])
    .map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login)
    .filter(Boolean);
  const claim = activeClaimsFrom(comments).at(-1) || null;
  return JSON.stringify({
    issue_state: String(issue?.state || '').toUpperCase() || null,
    statuses,
    assignees,
    branch_exists: branchExists === true,
    latest_claim: claim ? {
      issue: claim.issue,
      change_id: claim.changeId,
      branch: claim.branch,
      agent: claim.agent,
      worktree: claim.worktree,
    } : null,
  });
}
