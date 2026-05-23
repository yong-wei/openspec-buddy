#!/usr/bin/env node
import fs from "node:fs";

const source = process.argv[2] || "-";
const issue = source === "-" ? JSON.parse(fs.readFileSync(0, "utf8")) : JSON.parse(fs.readFileSync(source, "utf8"));

function normalizeLabelName(label) {
  const name = typeof label === "string" ? label : label?.name;
  if (!name) return "";
  return name.replace(/^(status|type|area|series|risk|mode|coupling):\s+/, "$1:");
}

function normalizeLabels(labels) {
  const list = Array.isArray(labels) ? labels : labels?.nodes || [];
  return list.map(normalizeLabelName).filter(Boolean);
}

function labelValue(labels, prefix) {
  const label = labels.find((entry) => entry.startsWith(`${prefix}:`));
  if (!label) return "";
  return label.slice(prefix.length + 1).trim();
}

function cleanMetadataValue(value, fallback) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function slugifyTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 8)
    .join("-");
}

function deriveChangeId(issueNumber, title) {
  const titleSlug = slugifyTitle(title);
  const prefix = `issue-${issueNumber}`;
  const value = titleSlug ? `${prefix}-${titleSlug}` : prefix;
  return value.slice(0, 80).replace(/-+$/g, "");
}

function metadataBlock(metadata) {
  return `<!-- openspec-buddy
change_id: ${metadata.change_id}
claim_branch: ${metadata.claim_branch}
series: ${metadata.series}
coupling_group: ${metadata.coupling_group}
execution_mode: ${metadata.execution_mode}
base_branch: ${metadata.base_branch}
required_branch: ${metadata.required_branch}
depends_on: []
openspec_path: ${metadata.openspec_path}
risk: ${metadata.risk}
area: ${metadata.area}
-->
`;
}

const labels = normalizeLabels(issue.labels);
const issueNumber = Number(issue.number);
if (!issueNumber) {
  throw new Error("Issue number is required to build OpenSpec Buddy metadata.");
}

const changeId = deriveChangeId(issueNumber, issue.title);
const baseBranch = process.env.OPENSPEC_BUDDY_BASE_BRANCH || issue.base_branch || "";
const metadata = {
  change_id: changeId,
  claim_branch: changeId,
  series: cleanMetadataValue(labelValue(labels, "series"), `issue-${issueNumber}`),
  coupling_group: cleanMetadataValue(labelValue(labels, "coupling"), "none"),
  execution_mode: cleanMetadataValue(labelValue(labels, "mode"), "isolated"),
  base_branch: baseBranch,
  required_branch: "",
  depends_on: [],
  openspec_path: `openspec/changes/${changeId}`,
  risk: cleanMetadataValue(labelValue(labels, "risk"), "medium"),
  area: cleanMetadataValue(labelValue(labels, "area"), "general"),
};

const body = issue.body || "";
if (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body) || /<!--\s*openspec-buddy\s*\r?\n/.test(body)) {
  throw new Error("Issue already contains OpenSpec Buddy metadata.");
}

const block = metadataBlock(metadata);
const updatedBody = `${block}\n${body.replace(/^\s+/, "")}`;

process.stdout.write(`${JSON.stringify({ metadata, metadataBlock: block, updatedBody }, null, 2)}\n`);
