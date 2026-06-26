#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [issueArg, prArg, archiveArg = ''] = process.argv.slice(2);

if (issueArg === '-h' || issueArg === '--help') {
  console.log('Usage: verify-achieved-truth.mjs <issue-number> <pr-number-or-url> [archive-path]');
  process.exit(0);
}
if (!issueArg || !prArg) {
  process.stderr.write('Usage: verify-achieved-truth.mjs <issue-number> <pr-number-or-url> [archive-path]\n');
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    if (options.optional) return '';
    throw new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function status(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function json(command, args, options = {}) {
  const text = run(command, args, options);
  if (!text) return null;
  return JSON.parse(text);
}

function repoNwo() {
  const remote = run('git', ['remote', 'get-url', 'origin'], { optional: true });
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match?.[1] || process.env.OPENSPEC_BUDDY_REPO_NWO || '';
}

function prNumber(ref) {
  const text = String(ref);
  const match = text.match(/\/pull\/([0-9]+)/);
  return match?.[1] || text.replace(/^#/, '');
}

function boundBase() {
  return run('git', ['config', '--worktree', '--get', 'buddy.boundBase'], { optional: true })
    || `origin/${process.env.OPENSPEC_BUDDY_BASE_BRANCH || 'integration'}`;
}

function issueStatus(issue) {
  const repo = repoNwo();
  const args = ['issue', 'view', String(issue), '--json', 'state,labels,projectItems,url,body'];
  if (repo) args.splice(2, 0, '-R', repo);
  return json('gh', args, { optional: true }) || {};
}

function prStatus(pr) {
  const repo = repoNwo();
  if (repo) {
    const rest = json('gh', ['api', `repos/${repo}/pulls/${pr}`], { optional: true });
    if (rest) return rest;
  }
  return json('gh', ['pr', 'view', String(pr), '--json', 'number,mergedAt,state,body,url,files'], { optional: true }) || {};
}

function findArchivePath(pr, supplied) {
  if (supplied) return supplied;
  const repo = repoNwo();
  if (repo) {
    const files = json('gh', ['api', '--paginate', `repos/${repo}/pulls/${pr}/files?per_page=100`], { optional: true });
    const hit = (Array.isArray(files) ? files : []).find((file) => /^openspec\/changes\/archive\/[^/]+\/tasks\.md$/.test(file.filename || ''));
    if (hit?.filename) return hit.filename.replace(/\/tasks\.md$/, '');
  }
  const view = json('gh', ['pr', 'view', String(pr), '--json', 'files'], { optional: true });
  const hit = (view?.files || []).find((file) => /^openspec\/changes\/archive\/[^/]+\/tasks\.md$/.test(file.path || file.filename || ''));
  return hit ? String(hit.path || hit.filename).replace(/\/tasks\.md$/, '') : '';
}

function issueMetadata(issue) {
  const body = String(issue?.body || '');
  if (!body.trim()) {
    throw new Error('Issue body is missing; cannot verify archive change_id.');
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const result = spawnSync('node', [path.join(scriptDir, 'parse-issue-metadata.mjs'), '-'], {
    cwd: process.cwd(),
    env: process.env,
    input: body,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Could not parse OpenSpec Buddy issue metadata.').trim());
  }
  return JSON.parse(result.stdout);
}

function archiveMatchesIssue(issue, archivePath) {
  const metadata = issueMetadata(issue);
  const changeId = String(metadata.change_id || '').trim();
  const basename = archivePath ? path.basename(archivePath) : '';
  const datedArchive = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  if (!changeId) {
    throw new Error('Issue metadata is missing change_id; cannot verify archive path.');
  }
  return {
    ok: basename === changeId || datedArchive.test(basename),
    changeId,
    basename,
  };
}

function pathExistsAt(ref, filePath) {
  if (!filePath) return false;
  return spawnSync('git', ['cat-file', '-e', `${ref}:${filePath}`], { stdio: 'ignore' }).status === 0;
}

function readAt(ref, filePath) {
  return run('git', ['show', `${ref}:${filePath}`], { optional: true });
}

function tasksComplete(ref, archivePath) {
  const text = readAt(ref, `${archivePath}/tasks.md`);
  if (!text) return false;
  return !/^\s*-\s+\[\s\]/m.test(text);
}

function valueText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return String(value.name || value.date || value.text || value.title || value.value || '').trim();
  }
  return '';
}

function fieldValue(item, names) {
  for (const name of names) {
    const direct = item?.[name];
    const directText = valueText(direct);
    if (directText) return directText;
    const fields = item?.fieldValues;
    if (fields && !Array.isArray(fields)) {
      const fieldText = valueText(fields[name]);
      if (fieldText) return fieldText;
      const lowerText = valueText(fields[name.toLowerCase()]);
      if (lowerText) return lowerText;
    }
    if (Array.isArray(fields)) {
      const hit = fields.find((field) => {
        const fieldName = valueText(field?.field?.name || field?.name);
        return fieldName.toLowerCase() === name.toLowerCase();
      });
      const hitText = valueText(hit);
      if (hitText) return hitText;
    }
  }
  return '';
}

function projectMatches(item) {
  const configuredTitle = String(process.env.OPENSPEC_BUDDY_PROJECT_TITLE || '').trim();
  const configuredId = String(process.env.OPENSPEC_BUDDY_PROJECT_ID || '').trim();
  const itemTitle = valueText(item?.project?.title || item?.title || item?.projectTitle);
  const itemId = valueText(item?.project?.id || item?.projectId);
  if (configuredId && itemId && itemId !== configuredId) return false;
  if (configuredTitle && itemTitle && itemTitle !== configuredTitle) return false;
  if (configuredTitle && !itemTitle) return false;
  return true;
}

function projectItems(issue) {
  if (Array.isArray(issue?.projectItems)) return issue.projectItems;
  if (Array.isArray(issue?.projectItems?.nodes)) return issue.projectItems.nodes;
  return [];
}

function projectTerminal(issue) {
  const items = projectItems(issue).filter(projectMatches);
  if (items.length === 0) return false;
  const done = String(process.env.OPENSPEC_BUDDY_PROJECT_STATUS_DONE || 'Done').toLowerCase();
  const statusNames = [
    process.env.OPENSPEC_BUDDY_PROJECT_STATUS_FIELD || 'Status',
    'status',
    'Status',
  ];
  const endNames = [
    process.env.OPENSPEC_BUDDY_PROJECT_END_FIELD || 'End',
    'end',
    'End',
  ];
  return items.some((item) => fieldValue(item, statusNames).toLowerCase() === done && Boolean(fieldValue(item, endNames)));
}

function labelNames(issue) {
  if (Array.isArray(issue?.labels)) return issue.labels.map((label) => label.name || label).filter(Boolean);
  return (issue?.labels?.nodes || []).map((label) => label.name || label).filter(Boolean);
}

function issueTerminal(issue) {
  const labels = labelNames(issue);
  return String(issue?.state || '').toUpperCase() === 'CLOSED'
    && labels.includes('status:archived')
    && projectTerminal(issue);
}

function verifyReviewThreadsResolved(pr) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const helper = process.env.OPENSPEC_BUDDY_VERIFY_REVIEW_THREADS_RESOLVED_HELPER
    || path.join(scriptDir, 'verify-review-threads-resolved.sh');
  const result = status(helper, [String(pr)]);
  return {
    ok: result.status === 0,
    message: (result.stderr || result.stdout || '').trim(),
  };
}

function issueNodeId(issue) {
  const repo = repoNwo();
  const args = ['issue', 'view', String(issue), '--json', 'id', '--jq', '.id'];
  if (repo) args.splice(2, 0, '-R', repo);
  return run('gh', args, { optional: true });
}

function seriesParentState(issueNumber) {
  const id = issueNodeId(issueNumber);
  if (!id) return { ok: false, reason: 'issue id unavailable; cannot verify series parent truth' };
  const query = `
query($id: ID!, $statusField: String!, $endField: String!) {
  node(id: $id) {
    ... on Issue {
      parent {
        number
        state
        labels(first: 50) { nodes { name } }
        projectItems(first: 50) {
          nodes {
            project { id title }
            status: fieldValueByName(name: $statusField) {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            end: fieldValueByName(name: $endField) {
              ... on ProjectV2ItemFieldDateValue { date }
            }
          }
        }
        subIssues(first: 100) {
          nodes {
            number
            state
            labels(first: 50) { nodes { name } }
            projectItems(first: 50) {
              nodes {
                project { id title }
                status: fieldValueByName(name: $statusField) {
                  ... on ProjectV2ItemFieldSingleSelectValue { name }
                }
                end: fieldValueByName(name: $endField) {
                  ... on ProjectV2ItemFieldDateValue { date }
                }
              }
            }
          }
        }
      }
    }
  }
}`;
  const data = json('gh', [
    'api',
    'graphql',
    '-f',
    `id=${id}`,
    '-f',
    `statusField=${process.env.OPENSPEC_BUDDY_PROJECT_STATUS_FIELD || 'Status'}`,
    '-f',
    `endField=${process.env.OPENSPEC_BUDDY_PROJECT_END_FIELD || 'End'}`,
    '-f',
    `query=${query}`,
  ], { optional: true });
  if (!data?.data?.node) {
    return { ok: false, reason: 'series parent relationship query failed; cannot verify parent terminal state' };
  }
  const parent = data?.data?.node?.parent;
  if (!parent) return { ok: true, reason: 'no series parent' };
  if (!labelNames(parent).includes('type:series-parent')) return { ok: true, reason: 'parent is not a series parent' };
  const children = parent.subIssues?.nodes || [];
  if (children.length === 0) return { ok: true, reason: `series parent #${parent.number} has no children` };
  const unfinished = children.filter((child) => !issueTerminal(child));
  if (unfinished.length > 0) {
    return { ok: true, complete: false, reason: `series parent #${parent.number} still has unfinished children` };
  }
  if (!issueTerminal(parent)) {
    return {
      ok: false,
      recoverable: true,
      parentNumber: parent.number,
      reason: `series parent #${parent.number} has all children terminal but is not closed, archived, Project Done, and End set`,
    };
  }
  return { ok: true, complete: true, reason: `series parent #${parent.number} is terminal` };
}

try {
  const issueNumber = String(issueArg).replace(/^#/, '');
  const pr = prNumber(prArg);
  const issue = issueStatus(issueNumber);
  const prData = prStatus(pr);
  const base = boundBase();
  const archivePath = findArchivePath(pr, archiveArg);
  const labels = (issue.labels || []).map((label) => label.name || label).filter(Boolean);
  const statusLabels = labels.filter((label) => /^status:\s*/.test(label));
  const prMerged = Boolean(prData.merged === true || prData.merged_at || prData.mergedAt);
  const archivePresent = archivePath ? pathExistsAt(base, `${archivePath}/tasks.md`) : false;
  const archiveTasksComplete = archivePresent && tasksComplete(base, archivePath);
  const archiveMatch = archivePath ? archiveMatchesIssue(issue, archivePath) : { ok: false };
  const issueArchived = String(issue.state || '').toUpperCase() === 'CLOSED'
    && statusLabels.length === 1
    && statusLabels[0].replace(/^status:\s*/, 'status:') === 'status:archived';
  const projectDone = projectTerminal(issue);
  const reviewThreads = verifyReviewThreadsResolved(pr);

  if (!prMerged) {
    console.log(JSON.stringify({ achieved: false, next: 'merge-pr', reason: 'PR is not merged', archivePath }));
    process.exit(0);
  }
  if (!archivePath || !archivePresent) {
    console.log(JSON.stringify({ achieved: false, next: '', reason: `archive path is missing on ${base}`, archivePath }));
    process.exit(0);
  }
  if (!archiveMatch.ok) {
    console.log(JSON.stringify({
      achieved: false,
      next: '',
      reason: `archive path ${archivePath} does not match issue change_id ${archiveMatch.changeId || '<unknown>'}`,
      archivePath,
      changeId: archiveMatch.changeId,
    }));
    process.exit(0);
  }
  if (!archiveTasksComplete) {
    console.log(JSON.stringify({ achieved: false, next: '', reason: 'archived tasks.md is not complete', archivePath }));
    process.exit(0);
  }
  if (!reviewThreads.ok) {
    console.log(JSON.stringify({ achieved: false, next: '', reason: reviewThreads.message || 'review threads are not resolved', archivePath }));
    process.exit(0);
  }
  const parentState = seriesParentState(issueNumber);
  if (!parentState.ok) {
    console.log(JSON.stringify({
      achieved: false,
      next: parentState.recoverable ? 'mark-achieved-post-merge' : '',
      reason: parentState.reason,
      archivePath,
      parentNumber: parentState.parentNumber,
    }));
    process.exit(0);
  }
  if (issueArchived && projectDone) {
    console.log(JSON.stringify({ achieved: true, reason: 'issue closed, status archived, Project Done, End set, PR merged, archive present', archivePath }));
    process.exit(0);
  }
  console.log(JSON.stringify({ achieved: false, next: 'mark-achieved-post-merge', reason: 'PR merged and archive present, but issue/project terminal state is incomplete', archivePath }));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
