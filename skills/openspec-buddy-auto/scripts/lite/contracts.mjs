import { createHash } from 'node:crypto';

export const ACTIVE_CLAIM_STATUSES = Object.freeze([
  'status:claimed',
  'status:in-progress',
  'status:in-review',
]);

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
  if (!/^OpenSpec Buddy Claim(?:\s|$)/m.test(text)) return null;
  const agent = field(text, 'agent').replace(/^@/, '');
  const claim = {
    issue: Number(field(text, 'issue')) || null,
    claimId: field(text, 'claim_id'),
    state: field(text, 'state') || 'active',
    agent: agent.startsWith('codex/') ? agent : `codex/${agent}`,
    viewer: agent.replace(/^codex\//, ''),
    changeId: field(text, 'change_id'),
    branch: field(text, 'branch'),
    worktree: field(text, 'worktree_alias'),
  };
  return claim;
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

export function classifyClaim(claim, identity) {
  if (!claim || String(claim.state || 'active').toLowerCase() !== 'active') return 'unclaimed';
  if (!claim.viewer || !claim.changeId || (!claim.claimId && !claim.branch) || !claim.worktree) return 'partial';
  if (claim.agent === identity?.agent && claim.worktree === identity?.worktree) return 'current';
  return 'foreign';
}

export function classifyIssueClaim(issue, comments, identity, expected = {}) {
  const labels = (issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
  const statuses = labels.filter((label) => label.startsWith('status:'));
  const assignees = (issue?.assignees || []).map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login).filter(Boolean);
  const claims = (comments || []).map((comment) => parseLiteClaimComment(comment?.body ?? comment)).filter(Boolean);
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
  const complete = branchExists
    && String(issue?.state || '').toUpperCase() === 'OPEN'
    && statuses.length === 1
    && ACTIVE_CLAIM_STATUSES.includes(statuses[0])
    && assignees.length === 1
    && targetMatches
    && claim.state === 'active'
    && claim.viewer === assignees[0]
    && Boolean(claim.agent && claim.worktree);
  if (complete) {
    return claim.agent === identity?.agent && claim.worktree === identity?.worktree ? 'current' : 'foreign';
  }
  return 'partial';
}

export const parseIssueMapping = parseChangeMapping;
export const parseClaimComment = parseLiteClaimComment;
export const createIdentity = buildIdentity;
export const classifyIssue = classifyIssueClaim;
