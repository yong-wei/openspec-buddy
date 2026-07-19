#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function usage(stream = process.stdout) {
  stream.write('Usage: read-review-evidence.mjs --pr <number-or-url>\n');
}

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh ${args.join(' ')} failed with status ${result.status}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON.`);
  }
}

function paginated(endpoint) {
  const pages = runGh(['api', '--paginate', '--slurp', endpoint]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`GitHub REST pagination returned an incomplete shape for ${endpoint}.`);
  }
  return pages.flat();
}

function author(entry) {
  return entry?.user?.login || entry?.author?.login || '';
}

function reactions(entry) {
  const value = entry?.reactions || {};
  return {
    total: value.total_count || 0,
    eyes: value.eyes || 0,
    plusOne: value['+1'] || 0,
    minusOne: value['-1'] || 0,
  };
}

function resolvePrNumber(value) {
  if (/^[0-9]+$/.test(value)) return Number(value);
  const viewed = runGh(['pr', 'view', value, '--json', 'number']);
  if (!viewed.number) throw new Error(`Could not resolve PR from ${value}.`);
  return Number(viewed.number);
}

function ensureCompleteThreads(payload) {
  const connection = payload?.data?.repository?.pullRequest?.reviewThreads;
  if (!connection || !Array.isArray(connection.nodes)) {
    throw new Error('GitHub GraphQL returned no reviewThreads connection.');
  }
  if (connection.pageInfo?.hasNextPage) {
    throw new Error('Review evidence is incomplete: more than 100 review threads exist.');
  }
  for (const thread of connection.nodes) {
    if (thread?.comments?.pageInfo?.hasNextPage) {
      throw new Error(`Review evidence is incomplete: thread ${thread.id || 'unknown'} has more than 100 comments.`);
    }
  }
  return connection.nodes;
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true };
  if (argv.length !== 2 || argv[0] !== '--pr' || !argv[1]) {
    usage(process.stderr);
    process.exit(2);
  }
  return { pr: argv[1] };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

try {
  const urlMatch = args.pr.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  const repoInfo = urlMatch ? null : runGh(['repo', 'view', '--json', 'nameWithOwner']);
  const repoNwo = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : repoInfo?.nameWithOwner;
  if (!repoNwo || !repoNwo.includes('/')) throw new Error('Could not resolve the current GitHub repository.');
  const [owner, repo] = repoNwo.split('/');
  const prNumber = urlMatch ? Number(urlMatch[3]) : resolvePrNumber(args.pr);
  const base = `repos/${repoNwo}`;

  const pr = runGh(['api', `${base}/pulls/${prNumber}`]);
  const headSha = pr?.head?.sha || '';
  if (!headSha) throw new Error(`PR #${prNumber} has no readable head SHA.`);
  const headCommit = runGh(['api', `${base}/commits/${headSha}`]);
  const issueComments = paginated(`${base}/issues/${prNumber}/comments?per_page=100`);
  const reviews = paginated(`${base}/pulls/${prNumber}/reviews?per_page=100`);
  const reviewComments = paginated(`${base}/pulls/${prNumber}/comments?per_page=100`);
  const threadsPayload = runGh([
    'api', 'graphql',
    '-f', `query=query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage}nodes{id isResolved path line startLine comments(first:100){pageInfo{hasNextPage}nodes{id databaseId body createdAt url author{login}}}}}}}}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${prNumber}`,
  ]);
  const threads = ensureCompleteThreads(threadsPayload);

  const output = {
    schemaVersion: 1,
    fetchedAt: new Date().toISOString(),
    repository: repoNwo,
    pr: {
      number: prNumber,
      url: pr.html_url || '',
      state: pr.state || '',
      head: {
        sha: headSha,
        ref: pr?.head?.ref || '',
        committedAt: headCommit?.commit?.committer?.date || headCommit?.commit?.author?.date || '',
      },
    },
    sources: {
      issueComments: issueComments.map((comment) => ({
        source: 'issue_comment',
        id: comment.id || comment.node_id || '',
        author: author(comment),
        createdAt: comment.created_at || '',
        updatedAt: comment.updated_at || '',
        url: comment.html_url || '',
        reactions: reactions(comment),
        body: comment.body || '',
      })),
      reviews: reviews.map((review) => ({
        source: 'pull_review',
        id: review.id || review.node_id || '',
        author: author(review),
        submittedAt: review.submitted_at || '',
        state: review.state || '',
        commit: review.commit_id || '',
        url: review.html_url || '',
        body: review.body || '',
      })),
      reviewComments: reviewComments.map((comment) => ({
        source: 'review_comment',
        id: comment.id || comment.node_id || '',
        author: author(comment),
        createdAt: comment.created_at || '',
        updatedAt: comment.updated_at || '',
        commit: comment.commit_id || '',
        inReplyTo: comment.in_reply_to_id || '',
        path: comment.path || '',
        line: comment.line || comment.original_line || null,
        url: comment.html_url || '',
        body: comment.body || '',
      })),
      reviewThreads: threads.map((thread) => ({
        source: 'review_thread',
        id: thread.id || '',
        isResolved: thread.isResolved === true,
        path: thread.path || '',
        line: thread.line || thread.startLine || null,
        comments: (thread.comments?.nodes || []).map((comment) => ({
          id: comment.id || comment.databaseId || '',
          author: comment.author?.login || '',
          createdAt: comment.createdAt || '',
          url: comment.url || '',
          body: comment.body || '',
        })),
      })),
    },
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
