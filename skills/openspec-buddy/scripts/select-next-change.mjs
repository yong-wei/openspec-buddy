#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const parser = new URL("./parse-issue-metadata.mjs", import.meta.url);
const metadataCache = new Map();

function normalizeLabels(labels) {
  const list = Array.isArray(labels) ? labels : labels?.nodes || [];
  return list
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter(Boolean)
    .map((name) => name.replace(/^(status|type|area|series|risk|mode|coupling):\s+/, "$1:"));
}

function normalizeActiveChanges(activeChanges) {
  const ids = new Set();
  const entries = new Map();
  const localOnly = [];

  for (const entry of activeChanges || []) {
    const normalized = typeof entry === "string"
      ? { change_id: entry }
      : { ...entry, change_id: entry.change_id || entry.name || entry.id };

    if (!normalized.change_id) continue;
    ids.add(normalized.change_id);
    entries.set(normalized.change_id, normalized);

    if (isLocalOnlyChange(normalized)) {
      localOnly.push(normalized);
    }
  }

  return { ids, entries, localOnly };
}

function isLocalOnlyChange(entry) {
  if (!entry || typeof entry === "string") return false;
  if (entry.no_issue === true || entry.noIssue === true) return true;
  if (entry.issue === false) return true;
  const coordination = String(entry.coordination || "").toLowerCase();
  return coordination === "local" || coordination === "no-issue" || coordination === "no_issue";
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

function extractChangeIdHint(issue) {
  if (!issue?.body) return "";

  const metadataSections = [
    issue.body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/),
    issue.body.match(/<!--\s*openspec-buddy\s*\r?\n([\s\S]*?)\r?\n\s*-->/),
  ].filter(Boolean);

  for (const section of metadataSections) {
    const changeIdMatch = section[1].match(/^\s*change_id:\s*(.+)\s*$/m);
    if (changeIdMatch) {
      return String(changeIdMatch[1]).trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return "";
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
  const statusLabels = normalizeLabels(node.labels).filter((label) => label.startsWith("status:"));
  return statusLabels.length === 1
    && (statusLabels[0] === "status:archived" || statusLabels[0] === "status:merged");
}

function normalizeCouplingGroup(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.toLowerCase() !== "none" ? normalized : "";
}

function couplingEvidenceForIssue(issue) {
  const metadataGroup = normalizeCouplingGroup(parseMetadata(issue).metadata?.coupling_group);
  const labelGroups = [...new Set(normalizeLabels(issue.labels)
    .filter((name) => name.startsWith("coupling:"))
    .map((name) => normalizeCouplingGroup(name.slice("coupling:".length)))
    .filter(Boolean))];
  const groups = [...new Set([metadataGroup, ...labelGroups].filter(Boolean))];
  return {
    groups,
    conflict: labelGroups.length > 1
      || (Boolean(metadataGroup) && labelGroups.length > 0 && !labelGroups.includes(metadataGroup)),
    conflictReason: labelGroups.length > 1 && !metadataGroup
      ? "multiple coupling labels"
      : "coupling metadata and labels disagree",
  };
}

function issueCouplingGroups(issue) {
  return couplingEvidenceForIssue(issue).groups;
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

const activeState = normalizeActiveChanges(input.activeChanges);
const activeChanges = activeState.ids;
const issues = input.issues || [];
const excludeIssues = new Set((input.excludeIssues || input.exclude_issues || [])
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value) && value > 0));
const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));
const issuesByChange = new Map();
const issueHintsByChange = new Map();
for (const issue of issues) {
  const hintedChangeId = extractChangeIdHint(issue);
  if (hintedChangeId) {
    issueHintsByChange.set(hintedChangeId, issue);
  }
  const parsed = parseMetadata(issue);
  if (parsed.metadata?.change_id) {
    issuesByChange.set(parsed.metadata.change_id, issue);
  }
}
const candidates = [];
const rejected = [];
const staleClaimCandidates = [];

for (const issue of issues) {
  const labels = normalizeLabels(issue.labels);
  const statusLabels = labels.filter((label) => label.startsWith("status:"));
  const parsed = parseMetadata(issue);

  if (excludeIssues.has(Number(issue.number))) {
    rejected.push({ number: issue.number, reason: "excluded by active lane" });
    continue;
  }

  if (labels.includes("type:series-parent") || statusLabels.includes("status:tracking")) {
    rejected.push({ number: issue.number, reason: "series parent issue" });
    continue;
  }

  if (statusLabels.length > 1) {
    rejected.push({ number: issue.number, reason: "multiple status labels", statuses: statusLabels });
    continue;
  }

  if (statusLabels[0] === "status:claimed") {
    if (parsed.metadata?.change_id && activeChanges.has(parsed.metadata.change_id)) {
      staleClaimCandidates.push({
        number: issue.number,
        title: issue.title,
        url: issue.url,
        change_id: parsed.metadata.change_id,
        claim_branch: parsed.metadata.claim_branch,
      });
    }
    rejected.push({ number: issue.number, reason: "already claimed; skipped until stale-claim fallback" });
    continue;
  }

  if (statusLabels[0] !== "status:ready") {
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

  const couplingEvidence = couplingEvidenceForIssue(issue);
  const couplingGroups = couplingEvidence.groups;
  if (couplingEvidence.conflict) {
    rejected.push({
      number: issue.number,
      change_id: metadata.change_id,
      reason: couplingEvidence.conflictReason,
      coupling_groups: couplingGroups,
    });
    continue;
  }
  if (couplingGroups.length > 1) {
    rejected.push({
      number: issue.number,
      change_id: metadata.change_id,
      reason: "multiple coupling labels",
      coupling_groups: couplingGroups,
    });
    continue;
  }
  const couplingGroup = couplingGroups[0] || "";
  const couplingConflicts = couplingGroup
    ? issues.filter((candidate) => {
      if (candidate.number === issue.number) return false;
      const candidateLabels = normalizeLabels(candidate.labels);
      if (!candidateLabels.some((name) => name === "status:claimed" || name === "status:in-progress")) return false;
      return issueCouplingGroups(candidate).includes(couplingGroup);
    })
    : [];
  if (couplingConflicts.length > 0) {
    rejected.push({
      number: issue.number,
      change_id: metadata.change_id,
      reason: "coupling group has active issue",
      coupling_group: couplingGroup,
      coupling_conflicts: couplingConflicts.map((candidate) => candidate.number),
    });
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
    return !isCompleteIssue(upstream);
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
  return left.issue.number - right.issue.number;
});

if (scored.length === 0) {
  const localOnlyCandidates = activeState.localOnly.filter((entry) => !issueHintsByChange.has(entry.change_id));
  if (localOnlyCandidates.length > 0) {
    const localScored = localOnlyCandidates.map((entry) => ({
      entry,
      sameSeriesScore: currentSeries && entry.series === currentSeries ? 1 : 0,
      riskScore: riskRank(entry.risk),
    }));

    localScored.sort((left, right) => (
      right.sameSeriesScore - left.sameSeriesScore ||
      left.riskScore - right.riskScore ||
      String(left.entry.change_id).localeCompare(String(right.entry.change_id))
    ));

    const winner = localScored[0];
    process.stdout.write(`${JSON.stringify({
      selected: {
        number: null,
        title: winner.entry.title || winner.entry.change_id,
        url: null,
        change_id: winner.entry.change_id,
        claim_branch: null,
        series: winner.entry.series || "",
        risk: winner.entry.risk || "medium",
        blocking_count: 0,
        same_series: Boolean(winner.sameSeriesScore),
        local_only: true,
        no_issue: true,
      },
      rejected,
    }, null, 2)}\n`);
    process.exit(0);
  }

  process.stdout.write(`${JSON.stringify({
    selected: null,
    reason: staleClaimCandidates.length > 0
      ? "No executable OpenSpec Buddy issue; stale-claim recovery candidates require verification."
      : "No executable OpenSpec Buddy issue.",
    stale_claim_candidates: staleClaimCandidates,
    rejected,
  }, null, 2)}\n`);
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
