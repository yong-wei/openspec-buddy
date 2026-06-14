#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const issueListPath = process.argv[2];
const currentIssue = Number(process.argv[3]);
const couplingGroup = normalizeCouplingGroup(process.argv[4]);

if (!issueListPath || !currentIssue || process.argv[4] == null) {
  process.stderr.write("Usage: find-coupling-conflicts.mjs <issues-json> <current-issue-number> <coupling-group>\n");
  process.exit(2);
}

function normalizeCouplingGroup(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.toLowerCase() !== "none" ? normalized : "";
}

if (!couplingGroup) {
  process.stdout.write("[]\n");
  process.exit(0);
}

const issues = JSON.parse(fs.readFileSync(issueListPath, "utf8"));
const activeStatuses = new Set(["status:claimed", "status:in-progress"]);
const parser = new URL("./parse-issue-metadata.mjs", import.meta.url);
const conflicts = [];

for (const issue of issues) {
  if (issue.number === currentIssue) continue;
  const labelNames = (issue.labels || []).map((label) => label.name.replace(/^status:\s+/, "status:"));
  if (!labelNames.some((name) => activeStatuses.has(name))) continue;
  if (!issue.body) continue;

  const parsed = spawnSync(process.execPath, [parser.pathname, "-"], {
    input: issue.body,
    encoding: "utf8",
  });

  if (parsed.status !== 0) continue;
  const metadata = JSON.parse(parsed.stdout);
  if (normalizeCouplingGroup(metadata.coupling_group) === couplingGroup) {
    conflicts.push({
      number: issue.number,
      title: issue.title,
      status: labelNames.find((name) => activeStatuses.has(name)),
      change_id: metadata.change_id,
    });
  }
}

if (conflicts.length > 0) {
  process.stderr.write(JSON.stringify(conflicts, null, 2));
  process.stderr.write("\n");
  process.exit(1);
}

process.stdout.write("[]\n");
