#!/usr/bin/env node
import fs from "node:fs";

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const issues = input.issues || [];
const errors = [];

function labelsOf(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels : issue.labels?.nodes || [];
  return labels.map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
}

for (const issue of issues) {
  const labels = labelsOf(issue);
  if (labels.includes("type:series-parent")) {
    continue;
  }

  const parent = issue.parent;
  const series = labels.find((label) => label.startsWith("series:"))?.slice("series:".length);
  if (series && !parent && input.requireParent === true) {
    errors.push(`#${issue.number} belongs to series:${series} but has no parent issue relationship.`);
  }

  const blockedBy = issue.blockedBy?.nodes || issue.blockedBy || [];
  for (const blocker of blockedBy) {
    const reverse = issues.find((entry) => entry.number === blocker.number);
    const reverseBlocking = reverse?.blocking?.nodes || reverse?.blocking || [];
    if (reverse && !reverseBlocking.some((entry) => entry.number === issue.number)) {
      errors.push(`#${issue.number} is blocked by #${blocker.number}, but reverse blocking edge is missing in input.`);
    }
  }
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Issue relationships verified.\n");
