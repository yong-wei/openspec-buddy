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
  const marker = body.match(/<!--\s*openspec-buddy\s+change_id\s*:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->/i);
  if (marker) found.push({ source: 'marker', changeId: marker[1] });

  const hidden = body.match(/<!--\s*openspec-buddy\s*\r?\n([\s\S]*?)\r?\n\s*-->/i);
  const hiddenChange = hidden ? field(hidden[1], 'change_id') : '';
  if (hiddenChange) found.push({ source: 'hidden', changeId: hiddenChange });

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
  const claim = {
    claimId: field(text, 'claim_id'),
    state: field(text, 'state') || 'active',
    viewer: field(text, 'agent').replace(/^@/, ''),
    changeId: field(text, 'change_id'),
    branch: field(text, 'branch'),
    worktree: field(text, 'worktree_alias'),
  };
  return claim;
}

export function buildIdentity(viewer, worktree) {
  return {
    viewer: String(viewer || '').trim().replace(/^@/, ''),
    worktree: String(worktree || '').trim(),
  };
}

export function classifyClaim(claim, identity) {
  if (!claim || String(claim.state || 'active').toLowerCase() !== 'active') return 'unclaimed';
  if (!claim.claimId || !claim.viewer || !claim.changeId || !claim.worktree) return 'partial';
  if (claim.viewer === identity?.viewer && claim.worktree === identity?.worktree) return 'current';
  return 'foreign';
}

export function classifyIssueClaim(issue, comments, identity) {
  const labels = (issue?.labels || []).map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
  const assignees = (issue?.assignees || []).map((assignee) => typeof assignee === 'string' ? assignee : assignee?.login).filter(Boolean);
  const claim = (comments || []).map((comment) => parseLiteClaimComment(comment?.body ?? comment)).filter(Boolean).at(-1) || null;
  const claimClass = classifyClaim(claim, identity);

  if (claimClass === 'foreign' || claimClass === 'partial') return claimClass;
  if (claimClass === 'current') {
    return labels.includes('status:claimed') && assignees.includes(identity?.viewer) ? 'current' : 'partial';
  }
  if (labels.includes('status:claimed') || assignees.length > 0) return 'partial';
  return 'unclaimed';
}

export const parseIssueMapping = parseChangeMapping;
export const parseClaimComment = parseLiteClaimComment;
export const createIdentity = buildIdentity;
export const classifyIssue = classifyIssueClaim;
