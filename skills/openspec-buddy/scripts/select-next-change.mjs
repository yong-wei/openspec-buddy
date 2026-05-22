#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const parser = new URL("./parse-issue-metadata.mjs", import.meta.url);
const metadataCache = new Map();

function normalizeLabels(labels) {
  const list = Array.isArray(labels) ? labels : labels?.nodes || [];
  return list.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

function normalizeActiveChanges(activeChanges) {
  return new Set(
    (activeChanges || []).map((entry) => {
      if (typeof entry === "string") return entry;
      return entry.change_id || entry.name || entry.id;
    }).filter(Boolean),
  );
}

function parseMetadata(issue) {
  if (metadataCache.has(issue.number)) return metadataCache.get(issue.number);

  if (!issue.body) {
    const result = { error: "missing issue body" };
    metadataCache.set(issue.number, result);
    return result;
  }

  const parsed = spawnSync(process.execPath, [parser.pathname, "-"], {
    input: issue.body,
    encoding: "utf8",
  });

  if (parsed.status !== 0) {
    const result = { error: parsed.stderr.trim() || "metadata parse failed" };
    metadataCache.set(issue.number, result);
    return result;
  }

  const result = { metadata: JSON.parse(parsed.stdout) };
  metadataCache.set(issue.number, result);
  return result;
}

function relationshipNodes(issue, field) {
  const value = issue[field];
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.nodes || [];
}

function isCompleteIssue(node) {
  if (!node) return false;
  const state = String(node.state || "").toUpperCase();
  if (state === "CLOSED" || state === "MERGED") return true;
  const labels = normalizeLabels(node.labels);
  return labels.some((label) => label === "status:archived" || label === "status:merged");
}

function statusLabel(issue) {
  return normalizeLabels(issue.labels).find((label) => label.startsWith("status:")) || "";
}

function riskRank(risk) {
  if (risk === "low") return 0;
  if (risk === "medium") return 1;
  if (risk === "high") return 2;
  return 3;
}

function transitiveBlockingCount(candidate, issuesByNumber) {
  const seen = new Set();
  const queue = relationshipNodes(candidate.issue, "blocking")
    .filter((node) => !isCompleteIssue(node))
    .map((node) => node.number)
    .filter(Boolean);

  while (queue.length > 0) {
    const number = queue.shift();
    if (seen.has(number)) continue;
    seen.add(number);
    const downstream = issuesByNumber.get(number);
    if (!downstream) continue;
    for (const node of relationshipNodes(downstream, "blocking")) {
      if (!isCompleteIssue(node) && node.number && !seen.has(node.number)) {
        queue.push(node.number);
      }
    }
  }

  return seen.size;
}

const activeChanges = normalizeActiveChanges(input.activeChanges);
const issues = input.issues || [];
const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
const issuesByChange = new Map();
for (const issue of issues) {
  const parsed = parseMetadata(issue);
  if (parsed.metadata?.change_id) {
    issuesByChange.set(parsed.metadata.change_id, issue);
  }
}
const candidates = [];
const rejected = [];

for (const issue of issues) {
  const labels = normalizeLabels(issue.labels);
  const parsed = parseMetadata(issue);

  if (labels.includes("type:series-parent") || labels.includes("status:tracking")) {
    rejected.push({ number: issue.number, reason: "series parent issue" });
    continue;
  }

  if (!labels.includes("status:ready")) {
    rejected.push({ number: issue.number, reason: "not status:ready" });
    continue;
  }

  if (String(issue.state || "OPEN").toUpperCase() === "CLOSED") {
    rejected.push({ number: issue.number, reason: "issue closed" });
    continue;
  }

  if (parsed.error) {
    rejected.push({ number: issue.number, reason: parsed.error });
    continue;
  }

  const metadata = parsed.metadata;
  if (!activeChanges.has(metadata.change_id)) {
    rejected.push({ number: issue.number, change_id: metadata.change_id, reason: "no active OpenSpec change" });
    continue;
  }

  const openBlockers = relationshipNodes(issue, "blockedBy").filter((node) => !isCompleteIssue(node));
  if (openBlockers.length > 0) {
    rejected.push({
      number: issue.number,
      change_id: metadata.change_id,
      reason: "blocked by open issue relationship",
      blocked_by: openBlockers.map((node) => node.number).filter(Boolean),
    });
    continue;
  }

  const incompleteDependsOn = (metadata.depends_on || []).filter((changeId) => {
    const upstream = issuesByChange.get(changeId);
    if (!upstream) return activeChanges.size === 0 || activeChanges.has(changeId);
    return !["status:archived", "status:merged"].includes(statusLabel(upstream));
  });
  if (incompleteDependsOn.length > 0) {
    rejected.push({
      number: issue.number,
      change_id: metadata.change_id,
      reason: "depends_on includes incomplete change",
      depends_on: incompleteDependsOn,
    });
    continue;
  }

  candidates.push({
    issue,
    metadata,
    labels,
  });
}

const currentSeries = input.currentSeries || input.current_series || "";
const scored = candidates.map((candidate) => {
  const transitiveBlocking = transitiveBlockingCount(candidate, issuesByNumber);
  return {
    ...candidate,
    sameSeriesScore: currentSeries && candidate.metadata.series === currentSeries ? 1 : 0,
    blockingScore: transitiveBlocking,
    riskScore: riskRank(candidate.metadata.risk),
  };
});

scored.sort((left, right) => {
  return (
    right.sameSeriesScore - left.sameSeriesScore ||
    right.blockingScore - left.blockingScore ||
    left.riskScore - right.riskScore ||
    left.issue.number - right.issue.number
  );
});

if (scored.length === 0) {
  process.stdout.write(`${JSON.stringify({ selected: null, reason: "No executable OpenSpec Buddy issue.", rejected }, null, 2)}\n`);
  process.exit(0);
}

const winner = scored[0];
process.stdout.write(`${JSON.stringify({
  selected: {
    number: winner.issue.number,
    title: winner.issue.title,
    url: winner.issue.url,
    change_id: winner.metadata.change_id,
    claim_branch: winner.metadata.claim_branch,
    series: winner.metadata.series,
    risk: winner.metadata.risk,
    blocking_count: winner.blockingScore,
    same_series: Boolean(winner.sameSeriesScore),
  },
  rejected,
}, null, 2)}\n`);
