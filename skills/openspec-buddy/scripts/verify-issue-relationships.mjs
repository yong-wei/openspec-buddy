#!/usr/bin/env node
import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const issues = input.issues || [];
const errors = [];
const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));

function labelsOf(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels : issue.labels?.nodes || [];
  return labels.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

for (const issue of issues) {
  const labels = labelsOf(issue);
  const isSeriesParent = labels.includes("type:series-parent");

  const parent = issue.parent;
  const series = labels.find((label) => label.startsWith("series:"))?.slice("series:".length);
  if (!isSeriesParent && series && !parent && input.requireParent === true) {
    errors.push(`#${issue.number} belongs to series:${series} but has no parent issue relationship.`);
  }
  if (!isSeriesParent && parent) {
    if (!issueByNumber.has(parent.number)) {
      errors.push(`#${issue.number} has parent #${parent.number}, but #${parent.number} is missing from verification input.`);
    } else {
      const parentIssue = issueByNumber.get(parent.number);
      const subIssues = parentIssue?.subIssues?.nodes || parentIssue?.subIssues || [];
      if (!subIssues.some((entry) => entry.number === issue.number)) {
        errors.push(`#${issue.number} has parent #${parent.number}, but parent subIssues is missing #${issue.number}.`);
      }
    }
  }

  const blockedBy = issue.blockedBy?.nodes || issue.blockedBy || [];
  for (const blocker of blockedBy) {
    const reverse = issueByNumber.get(blocker.number);
    const reverseBlocking = reverse?.blocking?.nodes || reverse?.blocking || [];
    if (!reverse) {
      errors.push(`#${issue.number} is blocked by #${blocker.number}, but #${blocker.number} is missing from verification input.`);
    } else if (!reverseBlocking.some((entry) => entry.number === issue.number)) {
      errors.push(`#${issue.number} is blocked by #${blocker.number}, but reverse blocking edge is missing in input.`);
    }
  }

  const blocking = issue.blocking?.nodes || issue.blocking || [];
  for (const blocked of blocking) {
    const reverse = issueByNumber.get(blocked.number);
    const reverseBlockedBy = reverse?.blockedBy?.nodes || reverse?.blockedBy || [];
    if (!reverse) {
      errors.push(`#${issue.number} blocks #${blocked.number}, but #${blocked.number} is missing from verification input.`);
    } else if (!reverseBlockedBy.some((entry) => entry.number === issue.number)) {
      errors.push(`#${issue.number} blocks #${blocked.number}, but reverse blockedBy edge is missing in input.`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Issue relationships verified.\n");
