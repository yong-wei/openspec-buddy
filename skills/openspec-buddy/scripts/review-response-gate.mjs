#!/usr/bin/env node

import fs from 'node:fs';

const [mode, threadsFile, reviewerArg, actorArg, headArg = '', replyPlanFile = ''] = process.argv.slice(2);

if (!mode || !threadsFile || !reviewerArg) {
  process.stderr.write('Usage: review-response-gate.mjs <check|plan|verify|validate-reply-plan|reply-plan-lines> <review-threads-json> <reviewer-login> [actor-login] [head-sha] [reply-plan-json]\n');
  process.exit(2);
}

const reviewer = normalizeLogin(reviewerArg);
const actor = normalizeLogin(actorArg || '');
const head = String(headArg || '').trim().toLowerCase();
const input = JSON.parse(fs.readFileSync(threadsFile, 'utf8'));

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase().replace(/\[bot\]$/i, '');
}

function authorLogin(entry) {
  const value = entry?.author ?? entry?.user;
  if (typeof value === 'string') return value;
  return value?.login || value?.name || '';
}

function isReviewer(entry) {
  const login = normalizeLogin(authorLogin(entry));
  if (!login || !reviewer) return false;
  if (reviewer.includes('chatgpt-codex-connector')) return login.includes('chatgpt-codex-connector');
  return login === reviewer;
}

function isActor(entry) {
  const login = normalizeLogin(authorLogin(entry));
  return Boolean(actor && login === actor);
}

function normalizeThreads(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.reviewThreads)) return value.reviewThreads;
  if (Array.isArray(value?.reviewThreads?.nodes)) return value.reviewThreads.nodes;
  return value?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
}

function reviewThreadsConnection(value) {
  if (value?.reviewThreads?.nodes) return value.reviewThreads;
  return value?.data?.repository?.pullRequest?.reviewThreads || {};
}

function normalizeComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes || [];
}

function loadReplyPlan() {
  if (!replyPlanFile) {
    process.stderr.write('Reply plan file is required.\n');
    process.exit(2);
  }
  const plan = JSON.parse(fs.readFileSync(replyPlanFile, 'utf8'));
  const threads = Array.isArray(plan.threads) ? plan.threads : [];
  if (threads.length === 0) {
    process.stderr.write('Reply plan must contain at least one thread.\n');
    process.exit(2);
  }
  return threads;
}

function validateReplyPlanEntries() {
  if (!head) {
    process.stderr.write('Reply plan validation requires --head.\n');
    process.exit(2);
  }
  const known = new Set(normalizeThreads(input).map((thread) => thread.id).filter(Boolean));
  const plan = loadReplyPlan();
  const errors = [];
  for (const entry of plan) {
    if (!entry?.id) errors.push('reply plan entry is missing id');
    if (!entry?.bodyFile) errors.push(`reply plan entry ${entry?.id || '<unknown>'} is missing bodyFile`);
    if (String(entry?.head || '').trim().toLowerCase() !== head) {
      errors.push(`reply plan entry ${entry?.id || '<unknown>'} targets head ${entry?.head || '<empty>'}, expected ${head}`);
    }
    if (entry?.id && !known.has(entry.id)) {
      errors.push(`reply plan thread ${entry.id} does not belong to the current PR`);
    }
  }
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exit(1);
  }
  return plan;
}

function paginationErrors(value) {
  const errors = [];
  const connection = reviewThreadsConnection(value);
  if (connection?.pageInfo?.hasNextPage === true) {
    errors.push('reviewThreads has more than the fetched 100 nodes');
  }
  for (const thread of normalizeThreads(value)) {
    if (thread?.comments?.pageInfo?.hasNextPage === true) {
      errors.push(`${threadLabel(thread)} has more than the fetched 50 thread comments`);
    }
  }
  return errors;
}

function priorityMarkers(text) {
  return Array.from(new Set(String(text || '').match(/\bP[0-2]\b/gi) || [])).map((value) => value.toUpperCase());
}

function hasEvidence(text) {
  const body = String(text || '');
  const lower = body.toLowerCase();
  const hasSha = /\b[0-9a-f]{7,40}\b/i.test(body);
  const mentionsHead = Boolean(head && (lower.includes(head) || lower.includes(head.slice(0, 7))));
  const hasRationale = /\b(rationale|reason|not actionable|non-actionable)\b/i.test(body)
    || /(理由|不是行动项|非行动项|无需修改)/.test(body);
  const hasVerification = /\b(verified|verification|test|tests|passed|evidence|validated|validation)\b/i.test(body)
    || /(验证|证据|测试通过|校验通过)/.test(body);
  return (mentionsHead || hasSha || hasRationale) && hasVerification;
}

function threadLabel(thread) {
  const path = thread?.path || 'unknown path';
  const line = thread?.line || thread?.startLine || thread?.originalLine || '';
  return line ? `${path}:${line}` : path;
}

function latestActionableIndex(comments) {
  let index = -1;
  for (let i = 0; i < comments.length; i += 1) {
    const comment = comments[i];
    if (isReviewer(comment) && priorityMarkers(comment?.body || '').length > 0) index = i;
  }
  return index;
}

function actionableThreads() {
  return normalizeThreads(input)
    .filter((thread) => thread?.isResolved === false)
    .map((thread) => {
      const comments = normalizeComments(thread);
      const actionableIndex = latestActionableIndex(comments);
      const actionableComment = actionableIndex >= 0 ? comments[actionableIndex] : null;
      const replies = actionableIndex >= 0 ? comments.slice(actionableIndex + 1).filter((comment) => isActor(comment)) : [];
      const evidenceReply = replies.find((comment) => hasEvidence(comment?.body || '')) || null;
      return {
        id: thread.id || '',
        label: threadLabel(thread),
        url: actionableComment?.url || comments.at(-1)?.url || '',
        markers: actionableComment ? priorityMarkers(actionableComment.body || '') : [],
        hasActionable: actionableIndex >= 0,
        hasEvidenceReply: Boolean(evidenceReply),
      };
    })
    .filter((thread) => thread.hasActionable);
}

const unresolved = actionableThreads();
const truncated = paginationErrors(input);

if (truncated.length > 0) {
  process.stderr.write('Review response gate cannot prove thread state because GraphQL pagination was truncated:\n');
  for (const message of truncated) {
    process.stderr.write(`- ${message}\n`);
  }
  process.exit(1);
}

if (mode === 'check') {
  if (unresolved.length > 0) {
    process.stderr.write('Unresolved actionable Codex review threads exist; run review-response-gate.sh before requesting another review or waiting.\n');
    for (const thread of unresolved) {
      process.stderr.write(`- ${thread.id || 'unknown thread'} ${thread.label}${thread.markers.length ? ` (${thread.markers.join('/')})` : ''}${thread.url ? ` ${thread.url}` : ''}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('No unresolved actionable Codex review threads found.\n');
  process.exit(0);
}

if (mode === 'verify') {
  if (unresolved.length > 0) {
    process.stderr.write('Review response gate still has unresolved actionable Codex review threads after resolve attempt:\n');
    for (const thread of unresolved) {
      process.stderr.write(`- ${thread.id || 'unknown thread'} ${thread.label}${thread.url ? ` ${thread.url}` : ''}\n`);
    }
    process.exit(1);
  }
  process.stdout.write('All actionable Codex review threads are resolved.\n');
  process.exit(0);
}

if (mode === 'validate-reply-plan') {
  validateReplyPlanEntries();
  process.stdout.write('Reply plan matches current PR review threads and head.\n');
  process.exit(0);
}

if (mode === 'reply-plan-lines') {
  const plan = validateReplyPlanEntries();
  for (const entry of plan) {
    process.stdout.write(`${entry.id}\t${entry.bodyFile}\n`);
  }
  process.exit(0);
}

if (mode !== 'plan') {
  process.stderr.write(`Unknown mode: ${mode}\n`);
  process.exit(2);
}

if (!actor) {
  process.stderr.write('Could not determine the current GitHub actor; set OPENSPEC_BUDDY_REVIEW_RESPONSE_AUTHOR.\n');
  process.exit(2);
}

const missing = unresolved.filter((thread) => !thread.hasEvidenceReply);
if (missing.length > 0) {
  process.stderr.write('Review response gate failed: unresolved actionable Codex review threads are missing an agent reply with commit or verification evidence.\n');
  for (const thread of missing) {
    process.stderr.write(`- ${thread.id || 'unknown thread'} ${thread.label}${thread.url ? ` ${thread.url}` : ''}\n`);
  }
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ threadIds: unresolved.map((thread) => thread.id).filter(Boolean) })}\n`);
