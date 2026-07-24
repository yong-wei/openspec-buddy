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
  isValidChangeId,
  localDeliveryExists,
  parseChangeMapping,
  summarizeIssueClaim,
} from './contracts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const githubFetch = path.resolve(here, '../../../openspec-buddy/scripts/github-fetch.sh');
const ISSUE_BATCH_SIZE = 50;
const ISSUE_MAX_BUFFER = 16 * 1024 * 1024;
const ACTIVE_SELECTION_STATUSES = Object.freeze(['status:ready', ...ACTIVE_CLAIM_STATUSES]);
const ISSUE_PROJECTION = '[.[] | {number,title,state,html_url,url,body,labels,assignees,pull_request}]';
const SINGLE_ISSUE_PROJECTION = '{number,title,state,html_url,url,body,labels,assignees,pull_request}';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: ISSUE_MAX_BUFFER,
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
  if (argv[0] === '--change') {
    if (!isValidChangeId(argv[1])) fail('--change requires a valid change id.');
    return { issue: null, change: argv[1] };
  }
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

function issuePage(repo, { state = 'all', label = '', page = 1 } = {}) {
  const params = new URLSearchParams({
    state,
    sort: 'created',
    direction: 'asc',
    per_page: String(ISSUE_BATCH_SIZE),
    page: String(page),
  });
  if (label) params.set('labels', label);
  return ghJson([
    'api',
    `repos/${repo}/issues?${params}`,
    '--jq',
    ISSUE_PROJECTION,
  ]) || [];
}

function activeSelectionIssues(repo) {
  const byNumber = new Map();
  for (const status of ACTIVE_SELECTION_STATUSES) {
    const firstPage = issuePage(repo, { state: 'open', label: status });
    if (firstPage.length === ISSUE_BATCH_SIZE
      && issuePage(repo, { state: 'open', label: status, page: 2 }).length > 0) {
      fail(`Could not safely select from more than ${ISSUE_BATCH_SIZE} open Buddy issues.`);
    }
    for (const issue of firstPage) {
      if (!issue.pull_request) byNumber.set(Number(issue.number), issue);
    }
  }
  if (byNumber.size > ISSUE_BATCH_SIZE) {
    fail(`Could not safely select from more than ${ISSUE_BATCH_SIZE} open Buddy issues.`);
  }
  return [...byNumber.values()].sort((left, right) => Number(left.number) - Number(right.number));
}

function targetIssue(repo, number) {
  const issue = ghJson([
    'api',
    `repos/${repo}/issues/${number}`,
    '--jq',
    SINGLE_ISSUE_PROJECTION,
  ]);
  return issue?.pull_request ? null : issue;
}

function issuesForChange(repo, changeId) {
  const matching = [];
  for (let page = 1; ; page += 1) {
    const response = issuePage(repo, { page });
    for (const issue of response) {
      if (issue.pull_request) continue;
      const mapping = parseChangeMapping(issue.body);
      if (mapping.changeId === changeId
        || mapping.sources.some((source) => source.changeId === changeId)) {
        matching.push(issue);
      }
    }
    if (response.length < ISSUE_BATCH_SIZE) return matching;
  }
}

function issuesForTarget(repo, number) {
  const issue = targetIssue(repo, number);
  if (!issue) return [];
  const mapping = parseChangeMapping(issue.body);
  if (!mapping.changeId || mapping.invalid || mapping.duplicate || mapping.conflict) return [issue];
  return issuesForChange(repo, mapping.changeId);
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
  if (mapping.invalid) fail(`Ready issue #${issue.number} has invalid change mapping.`);
  if (mapping.duplicate) fail(`Ready issue #${issue.number} has duplicate change mapping.`);
  if (mapping.conflict) fail(`Ready issue #${issue.number} has conflicting change mapping.`);
  if (!mapping.changeId) fail(`Ready issue #${issue.number} is missing change mapping.`);
  return mapping.changeId;
}

function validateIssue(issue, context, {
  excludeOwnedClaims = false,
  classifyOnly = false,
  deferCurrentLocalError = false,
} = {}) {
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
    const localMissing = !localDeliveryExists(context.worktreeRoot, changeId);
    if (localMissing && !deferCurrentLocalError) fail(`Local change ${changeId} does not exist in active or dated archive paths.`);
    return { current: true, localMissing, result: resultFor(issue, changeId) };
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
  const issues = options.change
    ? issuesForChange(repo, options.change)
    : options.issue !== null
      ? issuesForTarget(repo, options.issue)
      : activeSelectionIssues(repo);
  const openMappings = new Map();
  const closedMappings = new Map();
  const allMappings = new Map();
  const problemMappings = [];
  for (const issue of issues) {
    const mapping = parseChangeMapping(issue.body);
    if (mapping.conflict || mapping.duplicate || mapping.invalid) problemMappings.push({ issue, mapping });
    if (!mapping.changeId || mapping.conflict || mapping.duplicate || mapping.invalid) continue;
    allMappings.set(mapping.changeId, [...(allMappings.get(mapping.changeId) || []), issue]);
    const target = String(issue.state || '').toUpperCase() === 'OPEN' ? openMappings : closedMappings;
    target.set(mapping.changeId, [...(target.get(mapping.changeId) || []), issue]);
  }
  const context = { repo, identity, allMappings, worktreeRoot: realWorktree };

  if (options.change) {
    const problem = problemMappings.find(({ mapping }) => mapping.sources.some((source) => source.changeId === options.change));
    if (problem?.mapping.invalid) fail(`Issue #${problem.issue.number} has invalid change mapping for ${options.change}.`);
    if (problem?.mapping.duplicate) fail(`Issue #${problem.issue.number} has duplicate change mapping for ${options.change}.`);
    if (problem?.mapping.conflict) fail(`Issue #${problem.issue.number} has conflicting change mapping for ${options.change}.`);
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
    let selectedLocalMissing = false;
    for (const issue of candidates) {
      const checked = validateIssue(issue, context, {
        excludeOwnedClaims: true,
        classifyOnly: true,
        deferCurrentLocalError: true,
      });
      if (checked.excluded) continue;
      if (checked.current) {
        if (!selected) {
          selected = checked.result;
          selectedLocalMissing = checked.localMissing;
        }
      }
    }
    if (selectedLocalMissing) {
      fail(`Local change ${selected.change_id} does not exist in active or dated archive paths.`);
    }
    if (selected) {
      const checked = withBlockers(
        { result: selected },
        { number: selected.issue },
        blockersByIssue(repo, [selected.issue]),
      );
      if (checked.blocked) fail(checked.blocked);
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
