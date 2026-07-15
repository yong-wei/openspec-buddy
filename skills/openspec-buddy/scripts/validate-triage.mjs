#!/usr/bin/env node
import fs from "node:fs";

function fail(errors) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const triagePath = args.shift();
let expectedIssueUpdatedAt;
let expectedBaseSha;
let expectedIssue;
let expectedChangeId;

while (args.length > 0) {
  const option = args.shift();
  const value = args.shift();
  if (!value || !["--issue-updated-at", "--base-sha", "--issue", "--change-id"].includes(option)) {
    fail(["Usage: validate-triage.mjs <triage.json> [--issue <positive-int|local>] [--change-id <id>] [--issue-updated-at <timestamp>] [--base-sha <sha>]"]);
  }
  if (option === "--issue-updated-at") expectedIssueUpdatedAt = value;
  if (option === "--base-sha") expectedBaseSha = value;
  if (option === "--issue") {
    if (value !== "local" && (!/^\d+$/.test(value) || Number(value) <= 0)) fail(["--issue must be a positive integer or local"]);
    expectedIssue = value === "local" ? null : Number(value);
  }
  if (option === "--change-id") expectedChangeId = value;
}

if (!triagePath) {
  fail(["Usage: validate-triage.mjs <triage.json> [--issue-updated-at <timestamp>] [--base-sha <sha>]"]);
}
if (!fs.existsSync(triagePath)) fail([`triage.json not found: ${triagePath}`]);

let triage;
try {
  triage = JSON.parse(fs.readFileSync(triagePath, "utf8"));
} catch (error) {
  fail([`triage.json: invalid JSON: ${error.message}`]);
}

const errors = [];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonBlank = (value) => typeof value === "string" && value.trim().length > 0;
function isRfc3339Timestamp(value) {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return false;

  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const components = [year, month, day, hour, minute, second].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] = components;
  if (hourNumber > 23 || minuteNumber > 59 || secondNumber > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;

  const calendarProbe = new Date(Date.UTC(
    yearNumber,
    monthNumber - 1,
    dayNumber,
    hourNumber,
    minuteNumber,
    secondNumber,
  ));
  return calendarProbe.getUTCFullYear() === yearNumber &&
    calendarProbe.getUTCMonth() === monthNumber - 1 &&
    calendarProbe.getUTCDate() === dayNumber &&
    !Number.isNaN(Date.parse(value));
}

function objectAt(parent, key, path) {
  if (!Object.hasOwn(parent, key)) {
    errors.push(`${path}: missing required field`);
    return {};
  }
  if (!isObject(parent[key])) {
    errors.push(`${path}: expected an object`);
    return {};
  }
  return parent[key];
}

function requireField(object, key, path) {
  if (!Object.hasOwn(object, key)) {
    errors.push(`${path}: missing required field`);
    return undefined;
  }
  return object[key];
}

function rejectUnknown(object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  }
}

function requireEnum(object, key, path, allowed) {
  const value = requireField(object, key, path);
  if (value !== undefined && !allowed.includes(value)) {
    errors.push(`${path}: expected ${allowed.join(" or ")}`);
  }
  return value;
}

function requireString(object, key, path, { allowBlank = false } = {}) {
  const value = requireField(object, key, path);
  if (value !== undefined && (typeof value !== "string" || (!allowBlank && !value.trim()))) {
    errors.push(`${path}: expected ${allowBlank ? "a string" : "a non-blank string"}`);
  }
  return value;
}

function requireStringArray(object, key, path, { nonEmpty = false } = {}) {
  const value = requireField(object, key, path);
  if (!Array.isArray(value)) {
    if (value !== undefined) errors.push(`${path}: expected an array`);
    return [];
  }
  if (nonEmpty && value.length === 0) errors.push(`${path}: requires at least one evidence entry`);
  for (const [index, entry] of value.entries()) {
    if (!isNonBlank(entry)) errors.push(`${path}[${index}]: expected a non-blank string`);
  }
  return value;
}

if (!isObject(triage)) fail(["triage.json: expected a JSON object"]);
rejectUnknown(triage, ["subject", "truth", "duplication", "readiness", "binding"], "triage");

const subject = objectAt(triage, "subject", "subject");
rejectUnknown(subject, ["issue", "change_id"], "subject");
const issue = requireField(subject, "issue", "subject.issue");
if (issue !== undefined && issue !== null && (!Number.isInteger(issue) || issue <= 0)) {
  errors.push("subject.issue: expected null or a positive integer");
}
const subjectChangeId = requireString(subject, "change_id", "subject.change_id", { allowBlank: true });
if (expectedIssue !== undefined && issue !== expectedIssue) {
  errors.push(`subject.issue: identity mismatch; expected ${expectedIssue === null ? "local" : expectedIssue}`);
}
if (expectedChangeId !== undefined && subjectChangeId !== expectedChangeId) {
  errors.push(`subject.change_id: identity mismatch; expected ${expectedChangeId}`);
}

const truth = objectAt(triage, "truth", "truth");
rejectUnknown(truth, ["problem_reproduced", "evidence"], "truth");
requireEnum(truth, "problem_reproduced", "truth.problem_reproduced", ["yes", "no", "not-applicable"]);
requireStringArray(truth, "evidence", "truth.evidence", { nonEmpty: true });

const duplication = objectAt(triage, "duplication", "duplication");
rejectUnknown(
  duplication,
  ["existing_implementation", "conflicting_specs", "active_changes", "superseded_by"],
  "duplication",
);
requireEnum(
  duplication,
  "existing_implementation",
  "duplication.existing_implementation",
  ["none", "partial", "complete"],
);
requireStringArray(duplication, "conflicting_specs", "duplication.conflicting_specs");
requireStringArray(duplication, "active_changes", "duplication.active_changes");
const supersededBy = requireField(duplication, "superseded_by", "duplication.superseded_by");
if (supersededBy !== undefined && supersededBy !== null && !isNonBlank(supersededBy)) {
  errors.push("duplication.superseded_by: expected null or a non-blank string");
}

const readiness = objectAt(triage, "readiness", "readiness");
rejectUnknown(readiness, ["information", "disposition", "reason"], "readiness");
requireEnum(readiness, "information", "readiness.information", ["sufficient", "insufficient"]);
const disposition = requireEnum(
  readiness,
  "disposition",
  "readiness.disposition",
  ["executable", "series-parent", "needs-human", "blocked", "close"],
);
requireString(readiness, "reason", "readiness.reason");

const binding = objectAt(triage, "binding", "binding");
rejectUnknown(binding, ["issue_updated_at", "base_sha", "generated_at"], "binding");
const issueUpdatedAt = requireField(binding, "issue_updated_at", "binding.issue_updated_at");
if (issueUpdatedAt !== undefined && issueUpdatedAt !== null && !isRfc3339Timestamp(issueUpdatedAt)) {
  errors.push("binding.issue_updated_at: expected null or a valid RFC3339 timestamp with an explicit timezone");
}
if (Number.isInteger(issue) && issue > 0 && issueUpdatedAt === null) {
  errors.push("binding.issue_updated_at: must be non-null when subject.issue identifies an issue");
}
if (issue === null && issueUpdatedAt !== null && issueUpdatedAt !== undefined) {
  errors.push("binding.issue_updated_at: must be null for a local subject without an issue");
}
const boundBaseSha = requireString(binding, "base_sha", "binding.base_sha", { allowBlank: true });
if (boundBaseSha && !/^[0-9a-f]{7,64}$/i.test(boundBaseSha)) {
  errors.push("binding.base_sha: expected an empty string or a hexadecimal Git SHA");
}
const generatedAt = requireField(binding, "generated_at", "binding.generated_at");
if (generatedAt !== undefined && !isRfc3339Timestamp(generatedAt)) {
  errors.push("binding.generated_at: expected a valid RFC3339 timestamp with an explicit timezone");
}

if (expectedIssueUpdatedAt !== undefined && issueUpdatedAt !== expectedIssueUpdatedAt) {
  errors.push(`binding.issue_updated_at: stale; expected ${expectedIssueUpdatedAt}`);
}
if (expectedBaseSha !== undefined && boundBaseSha !== expectedBaseSha) {
  errors.push(`binding.base_sha: stale; expected ${expectedBaseSha}`);
}

if (errors.length > 0) fail(errors);
process.stdout.write(`${JSON.stringify({ disposition })}\n`);
