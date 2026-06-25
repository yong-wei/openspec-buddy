#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = process.argv[2] || "-";
const body = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const metadataParser = path.join(scriptDir, "parse-issue-metadata.mjs");

function runMetadataValidation() {
  const result = spawnSync(process.execPath, [metadataParser, source], {
    encoding: "utf8",
    input: source === "-" ? body : undefined,
    env: process.env,
  });
  if (result.status !== 0) {
    const err = new Error((result.stderr || result.stdout || "Issue metadata validation failed.").trim());
    err.errors = [err.message];
    throw err;
  }
}

function sectionLines(markdown, headingName) {
  const lines = markdown.split(/\r?\n/);
  const wanted = headingName.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^##\s+(.+?)\s*$/);
    if (match && match[1].trim().toLowerCase() === wanted) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  const result = [];
  for (let i = start; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) break;
    result.push(lines[i]);
  }
  return result;
}

function collectBlocks(lines, itemPattern) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(itemPattern);
    if (match) {
      current = { match, lines: [line] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  return blocks;
}

function validateAcceptanceChecklist(lines, errors) {
  if (!lines) {
    errors.push("Missing required section: Acceptance Checklist.");
    return [];
  }

  const acBlocks = collectBlocks(lines, /^-\s+\[([ xX])\]\s+(AC-\d+)\s*:/);
  if (acBlocks.length === 0) {
    errors.push("Acceptance Checklist must contain at least one unchecked AC-n item.");
    return [];
  }

  const acIds = [];
  const seen = new Set();
  acBlocks.forEach((block, index) => {
    const [, checked, acId] = block.match;
    acIds.push(acId);
    if (seen.has(acId)) {
      errors.push(`Duplicate AC id: ${acId}.`);
    }
    seen.add(acId);

    const expected = `AC-${index + 1}`;
    if (acId !== expected) {
      errors.push(`Expected ${expected} but found ${acId}.`);
    }

    if (checked.toLowerCase() === "x") {
      errors.push(`${acId} must remain unchecked during propose.`);
    }
    if (!block.lines.some((line) => /^\s*Evidence:\s+\S/.test(line))) {
      errors.push(`${acId} missing Evidence.`);
    }
  });

  return acIds;
}

function validateTasks(lines, acIds, errors) {
  const acSet = new Set(acIds);
  const coveredAcIds = new Set();

  if (!lines) {
    errors.push("Missing required section: Tasks.");
    return coveredAcIds;
  }

  const taskBlocks = collectBlocks(lines, /^-\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (taskBlocks.length === 0) {
    errors.push("Tasks must contain at least one unchecked task.");
    return coveredAcIds;
  }

  taskBlocks.forEach((block, index) => {
    const taskName = `Task ${index + 1}`;
    const checked = block.match[1];
    if (checked.toLowerCase() === "x") {
      errors.push(`${taskName} must remain unchecked during propose.`);
    }

    const coversLine = block.lines.find((line) => /^\s*Covers:\s+\S/.test(line));
    if (!coversLine) {
      errors.push(`${taskName} missing Covers.`);
    } else {
      const covers = [...coversLine.matchAll(/AC-\d+/g)].map((match) => match[0]);
      if (covers.length === 0) {
        errors.push(`${taskName} missing Covers.`);
      }
      for (const acId of covers) {
        if (!acSet.has(acId)) {
          errors.push(`${taskName} references unknown ${acId}.`);
        } else {
          coveredAcIds.add(acId);
        }
      }
    }

    for (const field of ["Acceptance", "Evidence", "Reviewer Check"]) {
      const pattern = new RegExp(`^\\s*${field}:\\s+\\S`);
      if (!block.lines.some((line) => pattern.test(line))) {
        errors.push(`${taskName} missing ${field}.`);
      }
    }
  });

  return coveredAcIds;
}

function validateIssueBody(markdown) {
  const errors = [];
  const acIds = validateAcceptanceChecklist(sectionLines(markdown, "Acceptance Checklist"), errors);
  const coveredAcIds = validateTasks(sectionLines(markdown, "Tasks"), acIds, errors);

  for (const acId of acIds) {
    if (!coveredAcIds.has(acId)) {
      errors.push(`${acId} is not covered by any task.`);
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join("\n"));
    err.errors = errors;
    throw err;
  }
}

try {
  runMetadataValidation();
  validateIssueBody(body);
  process.stdout.write("Buddy issue body validation passed.\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
