#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_CLAIM_STATUSES,
  buildIdentity,
  branchExistsFromRefResult,
  classifyIssueClaim,
  localDeliveryExists,
  parseChangeMapping,
  summarizeIssueClaim,
} from './contracts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const githubFetch = path.resolve(here, '../../../openspec-buddy/scripts/github-fetch.sh');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function ghJson(args) {
  const output = run('gh', args);
  return output ? JSON.parse(output) : null;
}

function managedGraphql(args) {
  const output = run('bash', [
    '-c',
    'source "$1"; shift; buddy_graphql_api "$@"',
    'buddy-lite-graphql',
    githubFetch,
    ...args,
  ], { env: { ...process.env, OPENSPEC_BUDDY_GRAPHQL_METRICS: '0' } });
  return output ? JSON.parse(output) : null;
}

function fail(message) {
  throw new Error(message);
}

function parseOptions(argv) {
  if (argv.length === 0) return { issue: null, change: '' };
  if (argv.length !== 2) fail('Usage: select-available-issue.mjs [--issue NUMBER | --change CHANGE_ID]');
  if (argv[0] === '--issue') {
    const issue = Number(argv[1]);
    if (!Number.isInteger(issue) || issue < 1) fail('--issue requires a positive integer.');
    return { issue, change: '' };
  }
  if (argv[0] === '--change' && argv[1]) return { issue: null, change: argv[1] };
  fail('Usage: select-available-issue.mjs [--issue NUMBER | --change CHANGE_ID]');
}

function labels(issue) {
  return (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean);
}

function isReady(issue) {
  return String(issue.state || '').toUpperCase() === 'OPEN' && labels(issue).includes('status:ready');
}

function localChangeExists(worktreeRoot, changeId) {
  return fs.statSync(path.join(worktreeRoot, 'openspec', 'changes', changeId), { throwIfNoEntry: false })?.isDirectory() === true;
}

function commentsFor(repo, number) {
  const response = ghJson(['api', `repos/${repo}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp']) || [];
  return Array.isArray(response[0]) ? response.flat() : response;
}

function branchExists(repo, branch) {
  const result = spawnSync('gh', ['api', `repos/${repo}/git/ref/heads/${branch}`], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return branchExistsFromRefResult(result, branch);
}

function blockersByIssue(repo, numbers) {
  const uniqueNumbers = [...new Set(numbers.map(Number))];
  if (uniqueNumbers.length === 0) return new Map();
  if (uniqueNumbers.length > 100) fail('Could not safely read blockedBy for more than 100 candidate issues.');
  const [owner, name] = repo.split('/');
  const fields = uniqueNumbers.map((number, index) => (
    `candidate${index}:issue(number:${number}){number blockedBy(first:100){nodes{number state}pageInfo{hasNextPage}}}`
  )).join(' ');
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`;
  const response = managedGraphql([
    '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${query}`,
  ]);
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    fail('Could not read complete blockedBy data for candidate issues.');
  }
  const repository = response?.data?.repository;
  if (!repository) fail('Could not read blockedBy for candidate issues.');

  const result = new Map();
  for (const [index, number] of uniqueNumbers.entries()) {
    const issue = repository[`candidate${index}`];
    const connection = issue?.blockedBy;
    if (Number(issue?.number) !== number || !Array.isArray(connection?.nodes)
      || typeof connection?.pageInfo?.hasNextPage !== 'boolean') {
      fail(`Could not read complete blockedBy data for issue #${number}.`);
    }
    if (connection.nodes.some((blocker) => !Number.isInteger(Number(blocker?.number))
      || Number(blocker.number) < 1
      || !['OPEN', 'CLOSED'].includes(String(blocker?.state || '').toUpperCase()))) {
      fail(`Could not read complete blockedBy data for issue #${number}.`);
    }
    if (connection.pageInfo.hasNextPage) {
      fail(`Issue #${number} has more than 100 blockers; blockedBy batch is incomplete.`);
    }
    result.set(number, connection.nodes);
  }
  return result;
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

function validateIssue(issue, context, { excludeOwnedClaims = false, classifyOnly = false } = {}) {
  if (!issue) fail('Target issue was not found.');
  const changeId = mappingFor(issue);

  const duplicates = context.allMappings.get(changeId) || [];
  if (duplicates.length > 1) fail(`Change ${changeId} has duplicate issue mappings: ${duplicates.map((item) => `#${item.number}`).join(', ')}.`);

  const comments = commentsFor(context.repo, issue.number);
  const hasBranch = branchExists(context.repo, changeId);
  const claimClass = classifyIssueClaim(
    issue,
    comments,
    context.identity,
    { branchExists: hasBranch, issue: issue.number, changeId, branch: changeId },
  );
  if (claimClass === 'foreign' && excludeOwnedClaims) return { excluded: true };
  if (claimClass === 'current') {
    if (!localDeliveryExists(context.worktreeRoot, changeId)) fail(`Local change ${changeId} does not exist in active or dated archive paths.`);
    return { current: true, result: resultFor(issue, changeId) };
  }
  if (claimClass !== 'unclaimed') {
    fail(`Issue #${issue.number} has ${claimClass} claim state: ${summarizeIssueClaim(issue, comments, hasBranch)}`);
  }
  if (classifyOnly) return { unclaimed: true };
  if (!isReady(issue)) fail(`Issue #${issue.number} is not an open status:ready issue.`);
  if (!localChangeExists(context.worktreeRoot, changeId)) fail(`Ready issue #${issue.number} maps to missing local change ${changeId}.`);

  return { result: resultFor(issue, changeId) };
}

function withBlockers(checked, issue, blockers) {
  const open = (blockers.get(Number(issue.number)) || [])
    .find((blocker) => String(blocker.state || '').toUpperCase() === 'OPEN');
  return open
    ? { blocked: `Issue #${issue.number} is blocked by open issue #${open.number}.` }
    : checked;
}

try {
  const options = parseOptions(process.argv.slice(2));
  const repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
  const viewer = ghJson(['api', 'user']).login;
  let worktree = '';
  try {
    worktree = run('git', ['config', '--worktree', 'buddy.worktreeAlias']);
  } catch {
    // The shared pure identity rule hashes the canonical worktree path when no alias exists.
  }
  const realWorktree = fs.realpathSync(run('git', ['rev-parse', '--show-toplevel']));
  const identity = buildIdentity(viewer, worktree, realWorktree);
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
  const context = { repo, identity, allMappings, worktreeRoot: realWorktree };

  if (options.change) {
    const conflict = conflictingMappings.find(({ mapping }) => mapping.sources.some((source) => source.changeId === options.change));
    if (conflict) fail(`Issue #${conflict.issue.number} has conflicting change mapping for ${options.change}.`);
    const allMapped = allMappings.get(options.change) || [];
    if (allMapped.length > 1) fail(`Change ${options.change} has duplicate issue mappings.`);
    const mapped = openMappings.get(options.change) || [];
    if (mapped.length === 1) {
      const checked = withBlockers(
        validateIssue(mapped[0], context),
        mapped[0],
        blockersByIssue(repo, [mapped[0].number]),
      );
      if (checked.blocked) fail(checked.blocked);
      process.stdout.write(`${JSON.stringify(checked.result)}\n`);
    } else {
      if ((closedMappings.get(options.change) || []).length > 0) fail(`Change ${options.change} has only closed issue mapping.`);
      if (!localChangeExists(realWorktree, options.change)) fail(`Local change ${options.change} does not exist.`);
      process.stdout.write(`${JSON.stringify({ mode: 'lite', result: 'local_only', change_id: options.change })}\n`);
    }
  } else if (options.issue !== null) {
    const target = issues.find((issue) => Number(issue.number) === options.issue);
    const checked = withBlockers(
      validateIssue(target, context),
      target,
      blockersByIssue(repo, target ? [target.number] : []),
    );
    if (checked.blocked) fail(checked.blocked);
    process.stdout.write(`${JSON.stringify(checked.result)}\n`);
  } else {
    const candidates = issues
      .filter((issue) => isReady(issue) || (
        String(issue.state || '').toUpperCase() === 'OPEN'
        && labels(issue).some((label) => ACTIVE_CLAIM_STATUSES.includes(label))
      ))
      .sort((left, right) => Number(left.number) - Number(right.number));
    let selected = null;
    for (const issue of candidates) {
      const checked = validateIssue(issue, context, { excludeOwnedClaims: true, classifyOnly: true });
      if (checked.excluded) continue;
      if (checked.current) {
        selected ||= checked.result;
      }
    }

    let firstBlocked = '';
    const ready = issues
      .filter(isReady)
      .sort((left, right) => Number(left.number) - Number(right.number));
    const blockers = selected ? new Map() : blockersByIssue(repo, ready.map((issue) => issue.number));
    for (const issue of selected ? [] : ready) {
      const checked = withBlockers(validateIssue(issue, context), issue, blockers);
      if (checked.blocked) {
        firstBlocked ||= checked.blocked;
        continue;
      }
      selected ||= checked.result;
    }
    if (!selected && firstBlocked) fail(firstBlocked);
    process.stdout.write(`${JSON.stringify(selected || { mode: 'lite', result: 'exhausted' })}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
