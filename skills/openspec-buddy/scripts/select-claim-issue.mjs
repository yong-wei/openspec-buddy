#!/usr/bin/env node
import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const issues = Array.isArray(input) ? input : input.issues || [];
const viewer = Array.isArray(input) ? "" : input.viewer || "";

const activeStatuses = new Set([
  "status:claimed",
  "status:in-progress",
  "status:in-review",
  "status:merged",
  "status:archived",
  "status:blocked",
  "status:tracking",
  "status:stale-claim",
  "status:needs-human",
  "status:failed",
]);
const claimableStatuses = new Set(["", "status:backlog", "status:ready"]);

function normalizeLabelName(label) {
  const name = typeof label === "string" ? label : label?.name;
  if (!name) return "";
  return name.replace(/^(status|type|area|series|risk|mode):\s+/, "$1:");
}

function normalizeLabels(labels) {
  const list = Array.isArray(labels) ? labels : labels?.nodes || [];
  return list.map(normalizeLabelName).filter(Boolean);
}

function normalizeAssignees(assignees) {
  const list = Array.isArray(assignees) ? assignees : assignees?.nodes || [];
  return list.map((assignee) => (typeof assignee === "string" ? assignee : assignee?.login)).filter(Boolean);
}

function statusLabel(labels) {
  return labels.find((label) => label.startsWith("status:")) || "";
}

const candidates = [];
const staleCandidates = [];
const rejected = [];

for (const issue of issues) {
  const number = Number(issue.number);
  const labels = normalizeLabels(issue.labels);
  const status = statusLabel(labels);
  const assignees = normalizeAssignees(issue.assignees);

  if (!number) {
    rejected.push({ number: issue.number ?? null, reason: "missing issue number" });
    continue;
  }

  if (String(issue.state || "OPEN").toUpperCase() !== "OPEN") {
    rejected.push({ number, reason: "issue not open" });
    continue;
  }

  if (labels.includes("type:series-parent") || status === "status:tracking") {
    rejected.push({ number, reason: "series parent issue" });
    continue;
  }

  if (status === "status:claimed") {
    staleCandidates.push({
      number,
      title: issue.title,
      url: issue.url,
    });
    rejected.push({ number, reason: "already claimed; skipped until stale-claim fallback" });
    continue;
  }

  if (activeStatuses.has(status)) {
    rejected.push({ number, reason: "already claimed or active" });
    continue;
  }

  if (!claimableStatuses.has(status)) {
    rejected.push({ number, reason: `status is not claimable: ${status}` });
    continue;
  }

  if (assignees.length > 0 && !assignees.includes(viewer)) {
    rejected.push({ number, reason: "already assigned", assignees });
    continue;
  }

  candidates.push({
    number,
    title: issue.title,
    url: issue.url,
  });
}

candidates.sort((left, right) => left.number - right.number);

if (candidates.length === 0) {
  staleCandidates.sort((left, right) => left.number - right.number);
  if (staleCandidates.length > 0) {
    process.stdout.write(`${JSON.stringify({
      selected: {
        ...staleCandidates[0],
        stale_claim: true,
        reason: "no normal claimable issue; stale-claim recovery verification required",
      },
      rejected,
    }, null, 2)}\n`);
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify({ selected: null, reason: "No claimable open issue.", rejected }, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({
  selected: {
    ...candidates[0],
    reason: "lowest claimable issue number",
  },
  rejected,
}, null, 2)}\n`);
