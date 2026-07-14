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
  for (const name of ["Public behavior", "Public seam", "AC coverage"]) {
    if (!fields[name]) errors.push(`${name}: required when Seam status is required`);
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

for (const acId of issueAcIds) {
  const coverageHasAc = new RegExp(`\\b${acId}\\b`).test(fields["AC coverage"] ?? "");
  const manualText = fields["Manual-only acceptance"] ?? "";
  const manualHasAc = new RegExp(`\\b${acId}\\b`).test(manualText);
  const manualJustified = manualHasAc && manualText.replace(new RegExp(`\\b${acId}\\b`, "g"), "").replace(/[\s:;,.-]/g, "").length > 0;
  if (!coverageHasAc && !manualJustified) {
    errors.push(`${acId}: not mapped in AC coverage or justified as manual-only`);
  }
}

if (errors.length > 0) fail(errors);
process.stdout.write("Testing strategy valid\n");
