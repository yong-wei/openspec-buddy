#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const receiptSource = 'buddy-auto-driver/run-next';

export function receiptPayload(state, stage, receipt) {
  const base = [
    state.key || '',
    receipt.repository || state.repository || '',
    state.issue || '',
    state.pr || '',
    state.change || '',
    stage,
    receipt.at || '',
    receipt.head || '',
    receipt.command || '',
    receipt.source || '',
    receipt.requestId || '',
    receipt.responseId || '',
    receipt.responseUrl || '',
    receipt.mergeAttemptId || '',
  ].join('\0');
  const recoveryEvidence = [
    receipt.violationSignature || '',
    receipt.remoteHead || '',
    receipt.mergedAt || '',
  ];
  return recoveryEvidence.some(Boolean)
    ? `${base}\0${recoveryEvidence.join('\0')}`
    : base;
}

function secretPath(stateDir) {
  return path.join(stateDir, '.receipt-secret');
}

function receiptSecret(stateDir, { create = false } = {}) {
  const file = secretPath(stateDir);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  if (!create) return '';
  fs.mkdirSync(stateDir, { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export function signReceipt(state, stage, receipt, { stateDir } = {}) {
  const secret = receiptSecret(stateDir, { create: true });
  return crypto.createHmac('sha256', secret).update(receiptPayload(state, stage, receipt)).digest('hex');
}

export function validSignedReceipt(state, stage, {
  require = [],
  stateDir,
  repository = '',
  issue = '',
  pr = '',
  head = '',
} = {}) {
  const receipt = state?.stages?.[stage];
  if (!receipt?.signature || receipt.source !== receiptSource) return false;
  if (repository && receipt.repository !== repository) return false;
  if (issue && receipt.issue !== issue) return false;
  if (pr && receipt.pr !== pr) return false;
  if (head && receipt.head !== head) return false;
  if (state.repository && receipt.repository !== state.repository) return false;
  if (state.issue && receipt.issue !== state.issue) return false;
  if (state.pr && receipt.pr !== state.pr) return false;
  if (state.head && receipt.head !== state.head) return false;
  if (require.some((field) => !receipt[field])) return false;
  const secret = receiptSecret(stateDir);
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(receiptPayload(state, stage, receipt)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(receipt.signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
