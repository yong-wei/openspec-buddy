#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildIdentity,
  classifyIssueClaim,
  parseChangeMapping,
} from './contracts.mjs';

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ghJson(args) {
  const output = run('gh', args);
  return output ? JSON.parse(output) : null;
}

function fail(message) {
  throw new Error(message);
}

function parseOptions(argv) {
  const options = { issue: null, change: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--issue') options.issue = Number(argv[++index]);
    else if (argv[index] === '--change') options.change = String(argv[++index] || '');
    else fail(`Unknown argument: ${argv[index]}`);
  }
  if (options.issue !== null && (!Number.isInteger(options.issue) || options.issue < 1)) fail('--issue requires a positive integer.');
  if (options.issue !== null && options.change) fail('--issue and --change are mutually exclusive.');
  if (argv.includes('--change') && !options.change) fail('--change requires a change id.');
  return options;
}

function labels(issue) {
  return (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean);
}

function isReady(issue) {
  return String(issue.state || '').toUpperCase() === 'OPEN' && labels(issue).includes('status:ready');
}

function localChangeExists(changeId) {
  return fs.statSync(path.join(process.cwd(), 'openspec', 'changes', changeId), { throwIfNoEntry: false })?.isDirectory() === true;
}

function commentsFor(repo, number) {
  const response = ghJson(['api', `repos/${repo}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp']) || [];
  return Array.isArray(response[0]) ? response.flat() : response;
}

function blockersFor(repo, number) {
  const [owner, name] = repo.split('/');
  const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){issue(number:$number){blockedBy(first:100,after:$after){nodes{number state}pageInfo{hasNextPage endCursor}}}}}`;
  const blockers = [];
  const seenCursors = new Set();
  let after = '';
  do {
    const args = [
      'api', 'graphql',
      '-F', `owner=${owner}`,
      '-F', `name=${name}`,
      '-F', `number=${number}`,
      '-f', `query=${query}`,
    ];
    if (after) args.splice(-2, 0, '-F', `after=${after}`);
    const response = ghJson(args);
    const connection = response?.data?.repository?.issue?.blockedBy;
    if (!connection) fail(`Could not read blockedBy for issue #${number}.`);
    if (!connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') {
      fail(`Could not safely paginate blockedBy for issue #${number}.`);
    }
    blockers.push(...(connection.nodes || []));
    if (!connection.pageInfo.hasNextPage) break;
    const next = String(connection.pageInfo.endCursor || '');
    if (!next || seenCursors.has(next)) fail(`Could not safely paginate blockedBy for issue #${number}.`);
    seenCursors.add(next);
    after = next;
  } while (true);
  return blockers;
}

function resultFor(issue, changeId) {
  return {
    mode: 'lite',
    result: 'issue',
    issue: Number(issue.number),
    change_id: changeId,
    url: issue.html_url || issue.url || '',
  };
}

function mappingFor(issue) {
  const mapping = parseChangeMapping(issue.body);
  if (mapping.conflict) fail(`Ready issue #${issue.number} has conflicting change mapping.`);
  if (!mapping.changeId) fail(`Ready issue #${issue.number} is missing change mapping.`);
  return mapping.changeId;
}

function validateIssue(issue, context, { excludeOwnedClaims = false } = {}) {
  if (!issue) fail('Target issue was not found.');
  let explicitCurrentClaim = false;
  if (!isReady(issue)) {
    if (String(issue.state || '').toUpperCase() === 'OPEN' && labels(issue).includes('status:claimed')) {
      const claimClass = classifyIssueClaim(issue, commentsFor(context.repo, issue.number), context.identity);
      if (excludeOwnedClaims && (claimClass === 'current' || claimClass === 'foreign')) return { excluded: true };
      if (!excludeOwnedClaims && claimClass === 'current') explicitCurrentClaim = true;
      else fail(`Claimed issue #${issue.number} has ${claimClass} claim state.`);
    }
    if (!explicitCurrentClaim) fail(`Issue #${issue.number} is not an open status:ready issue.`);
  }
  const changeId = mappingFor(issue);
  if (!localChangeExists(changeId)) fail(`Ready issue #${issue.number} maps to missing local change ${changeId}.`);

  const duplicates = context.allMappings.get(changeId) || [];
  if (duplicates.length > 1) fail(`Change ${changeId} has duplicate issue mappings: ${duplicates.map((item) => `#${item.number}`).join(', ')}.`);

  const claimClass = classifyIssueClaim(issue, commentsFor(context.repo, issue.number), context.identity);
  if (excludeOwnedClaims && (claimClass === 'current' || claimClass === 'foreign')) return { excluded: true };
  if (claimClass !== 'unclaimed' && !(explicitCurrentClaim && claimClass === 'current')) {
    fail(`Ready issue #${issue.number} has ${claimClass} claim state.`);
  }

  const openBlockers = blockersFor(context.repo, Number(issue.number))
    .filter((blocker) => String(blocker.state || '').toUpperCase() === 'OPEN');
  if (openBlockers.length > 0) {
    return { blocked: `Issue #${issue.number} is blocked by open issue #${openBlockers[0].number}.` };
  }
  return { result: resultFor(issue, changeId) };
}

try {
  const options = parseOptions(process.argv.slice(2));
  const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
  const viewer = ghJson(['api', 'user']).login;
  let worktree = '';
  try {
    worktree = run('git', ['config', '--worktree', 'buddy.worktreeAlias']);
  } catch {
    worktree = path.basename(run('git', ['rev-parse', '--show-toplevel']));
  }
  const identity = buildIdentity(viewer, worktree);
  const issueResponse = ghJson(['api', `repos/${repo}/issues?state=all&per_page=100`, '--paginate', '--slurp']) || [];
  const issues = (Array.isArray(issueResponse[0]) ? issueResponse.flat() : issueResponse)
    .filter((issue) => !issue.pull_request);
  const openMappings = new Map();
  const closedMappings = new Map();
  const allMappings = new Map();
  const conflictingMappings = [];
  for (const issue of issues) {
    const mapping = parseChangeMapping(issue.body);
    if (mapping.conflict) conflictingMappings.push({ issue, mapping });
    if (!mapping.changeId || mapping.conflict) continue;
    allMappings.set(mapping.changeId, [...(allMappings.get(mapping.changeId) || []), issue]);
    const target = String(issue.state || '').toUpperCase() === 'OPEN' ? openMappings : closedMappings;
    target.set(mapping.changeId, [...(target.get(mapping.changeId) || []), issue]);
  }
  const context = { repo, identity, allMappings };

  if (options.change) {
    const conflict = conflictingMappings.find(({ mapping }) => mapping.sources.some((source) => source.changeId === options.change));
    if (conflict) fail(`Issue #${conflict.issue.number} has conflicting change mapping for ${options.change}.`);
    const allMapped = allMappings.get(options.change) || [];
    if (allMapped.length > 1) fail(`Change ${options.change} has duplicate issue mappings.`);
    const mapped = openMappings.get(options.change) || [];
    if (mapped.length === 1) {
      const checked = validateIssue(mapped[0], context);
      if (checked.blocked) fail(checked.blocked);
      process.stdout.write(`${JSON.stringify(checked.result)}\n`);
    } else {
      if ((closedMappings.get(options.change) || []).length > 0) fail(`Change ${options.change} has only closed issue mapping.`);
      if (!localChangeExists(options.change)) fail(`Local change ${options.change} does not exist.`);
      process.stdout.write(`${JSON.stringify({ mode: 'lite', result: 'local_only', change_id: options.change })}\n`);
    }
  } else if (options.issue !== null) {
    const target = issues.find((issue) => Number(issue.number) === options.issue);
    const checked = validateIssue(target, context);
    if (checked.blocked) fail(checked.blocked);
    process.stdout.write(`${JSON.stringify(checked.result)}\n`);
  } else {
    const ready = issues
      .filter((issue) => isReady(issue) || (String(issue.state || '').toUpperCase() === 'OPEN' && labels(issue).includes('status:claimed')))
      .sort((left, right) => Number(left.number) - Number(right.number));
    let firstBlocked = '';
    let selected = null;
    for (const issue of ready) {
      const checked = validateIssue(issue, context, { excludeOwnedClaims: true });
      if (checked.excluded) continue;
      if (checked.blocked) {
        firstBlocked ||= checked.blocked;
        continue;
      }
      selected = checked.result;
      break;
    }
    if (!selected && firstBlocked) fail(firstBlocked);
    process.stdout.write(`${JSON.stringify(selected || { mode: 'lite', result: 'exhausted' })}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
