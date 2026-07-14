#!/usr/bin/env node
import fs from "node:fs";

const [designPath, issuePath, ...extraArgs] = process.argv.slice(2);

function fail(errors) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

if (!designPath || !issuePath || extraArgs.length > 0) {
  fail(["Usage: validate-testing-strategy.mjs <design.md> <issue.md>"]);
}

for (const [label, file] of [["design.md", designPath], ["issue.md", issuePath]]) {
  if (!fs.existsSync(file)) fail([`${label} not found: ${file}`]);
}

const design = fs.readFileSync(designPath, "utf8");
const issue = fs.readFileSync(issuePath, "utf8");
const sectionMatches = [...design.matchAll(/^## Testing Strategy[ \t]*\r?$([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/gm)];

if (sectionMatches.length === 0) fail(["Testing Strategy section missing from design.md"]);
if (sectionMatches.length > 1) fail(["Testing Strategy section is ambiguous: duplicate section"]);

const fieldNames = [
  "Change class",
  "Seam status",
  "Public behavior",
  "Public seam",
  "Existing seam reused",
  "AC coverage",
  "Manual-only acceptance",
  "Rationale",
];
const fields = Object.create(null);
const errors = [];

for (const [offset, rawLine] of sectionMatches[0][1].split(/\r?\n/).entries()) {
  if (/^\s*$/.test(rawLine)) continue;
  const match = rawLine.match(/^([^:]+):\s*(.*?)\s*$/);
  if (!match) {
    errors.push(`Testing Strategy line ${offset + 1}: unsupported structure`);
    continue;
  }
  const [, name, value] = match;
  if (!fieldNames.includes(name)) {
    errors.push(`${name}: unknown Testing Strategy field`);
  } else if (Object.hasOwn(fields, name)) {
    errors.push(`${name}: duplicate field`);
  } else {
    fields[name] = value;
  }
}

for (const name of fieldNames) {
  if (!Object.hasOwn(fields, name)) errors.push(`${name}: missing required field`);
  else if (!fields[name]) errors.push(`${name}: must not be blank; use none when intentionally empty`);
}

const placeholder = /\b(?:TBD|TODO)\b|decide\s+during\s+implementation/i;
for (const [name, value] of Object.entries(fields)) {
  if (placeholder.test(value)) errors.push(`${name}: placeholder is not allowed`);
}

const seamRequiredClasses = new Set(["behavioral", "medium-risk", "high-risk"]);
const notApplicableClasses = new Set(["documentation", "mechanical"]);
const allowedClasses = new Set([...seamRequiredClasses, ...notApplicableClasses]);
const changeClass = fields["Change class"];
const seamStatus = fields["Seam status"];

if (changeClass !== undefined && !allowedClasses.has(changeClass)) {
  errors.push(`Change class: unsupported value ${changeClass || "(blank)"}`);
}
if (seamStatus !== undefined && !new Set(["required", "not-applicable"]).has(seamStatus)) {
  errors.push(`Seam status: unsupported value ${seamStatus || "(blank)"}`);
}
if (seamRequiredClasses.has(changeClass) && seamStatus !== "required") {
  errors.push(`Seam status: ${changeClass} changes require a public seam`);
}
if (notApplicableClasses.has(changeClass) && !["required", "not-applicable"].includes(seamStatus)) {
  errors.push(`Seam status: ${changeClass} changes require required or not-applicable`);
}

if (seamStatus === "required") {
  for (const name of ["Public behavior", "Public seam"]) {
    if (fields[name]?.toLowerCase() === "none") errors.push(`${name}: must not be none when Seam status is required`);
  }
}
if (seamStatus === "not-applicable") {
  if (!notApplicableClasses.has(changeClass)) {
    errors.push("Seam status: not-applicable is only valid for documentation or mechanical changes");
  }
  if (!fields["Public seam"] || fields["Public seam"].toLowerCase() === "none") {
    errors.push("Public seam: not-applicable changes require an explicit verification method");
  }
  if (!fields.Rationale || fields.Rationale.toLowerCase() === "none") {
    errors.push("Rationale: not-applicable changes require an explicit rationale");
  }
}

const issueAcIds = [...new Set(issue.match(/\bAC-\d+\b/g) ?? [])];
if (issueAcIds.length === 0) errors.push("issue.md: no AC-N identifiers found");

const issueAcSet = new Set(issueAcIds);
const coverageAcIds = new Set(fields["AC coverage"]?.match(/\bAC-\d+\b/g) ?? []);
const manualAcIds = new Set();
const manualText = fields["Manual-only acceptance"] ?? "";

if (manualText && manualText.toLowerCase() !== "none") {
  for (const entry of manualText.split(";")) {
    const match = entry.trim().match(/^(AC-\d+):\s*(.+)$/);
    if (!match) {
      errors.push(`Manual-only acceptance: invalid entry ${entry.trim() || "(blank)"}; expected AC-N: reason`);
      continue;
    }
    const [, acId, reason] = match;
    if (manualAcIds.has(acId)) errors.push(`${acId}: duplicate manual-only entry`);
    manualAcIds.add(acId);
    if (!issueAcSet.has(acId)) errors.push(`${acId}: unknown manual-only AC`);
    const reasonWithoutAcIds = reason.replace(/\bAC-\d+\b/g, "").replace(/[\s:;,.-]/g, "");
    if (!reasonWithoutAcIds || placeholder.test(reason)) {
      errors.push(`${acId}: manual-only entry requires its own non-placeholder reason`);
    }
  }
}

for (const acId of coverageAcIds) {
  if (!issueAcSet.has(acId)) errors.push(`${acId}: unknown AC in AC coverage`);
}

for (const acId of issueAcIds) {
  if (coverageAcIds.has(acId) && manualAcIds.has(acId)) {
    errors.push(`${acId}: mapped in both AC coverage and Manual-only acceptance`);
  } else if (!coverageAcIds.has(acId) && !manualAcIds.has(acId)) {
    errors.push(`${acId}: not mapped in AC coverage or justified as manual-only`);
  }
}

if (errors.length > 0) fail(errors);
process.stdout.write("Testing strategy valid\n");
