#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_LIMIT = 50;
const MAX_SCANNED_FILES = 5000;
const MAX_FILE_BYTES = 256 * 1024;
const CODE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs",
  ".sh", ".sql", ".swift", ".ts", ".tsx", ".vue",
]);
const EXCLUDED_DIRS = new Set([".git", ".buddy", "node_modules", "vendor", "dist", "build", "coverage", "openspec", "docs"]);

function usage(message = "") {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("Usage: collect-triage-evidence.mjs --repo-root <path> --change-id <id> [--issue-json <path>] [--limit <n>] [--scan-limit <n>]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const options = { repoRoot: "", changeId: "", issueJson: "", limit: DEFAULT_LIMIT, scanLimit: MAX_SCANNED_FILES };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--repo-root") options.repoRoot = argv[++index] || "";
    else if (value === "--change-id") options.changeId = argv[++index] || "";
    else if (value === "--issue-json") options.issueJson = argv[++index] || "";
    else if (value === "--limit") options.limit = Number(argv[++index]);
    else if (value === "--scan-limit") options.scanLimit = Number(argv[++index]);
    else if (value.startsWith("--")) usage(`Unknown option: ${value}`);
    else positional.push(value);
  }
  options.repoRoot ||= positional[0] || "";
  options.changeId ||= positional[1] || "";
  options.issueJson ||= positional[2] || "";
  if (!options.repoRoot || !options.changeId) usage();
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 1000) usage("--limit must be an integer from 1 to 1000");
  if (!Number.isSafeInteger(options.scanLimit) || options.scanLimit < 1 || options.scanLimit > MAX_SCANNED_FILES) usage(`--scan-limit must be an integer from 1 to ${MAX_SCANNED_FILES}`);
  return options;
}

function relative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function sortedDirectoryNames(directory, predicate = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && predicate(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function walkFiles(root, start, { exclude = new Set(), cap = Number.POSITIVE_INFINITY } = {}) {
  if (!fs.existsSync(start)) return { files: [], scanTruncated: false };
  const files = [];
  let scanTruncated = false;
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name)) visit(target);
      } else if (entry.isFile()) {
        files.push(target);
        if (files.length > cap) scanTruncated = true;
      }
      if (scanTruncated) return;
    }
  }
  visit(start);
  return { files: files.slice(0, cap), scanTruncated };
}

function bounded(items, limit, sourceTruncated = false) {
  if (sourceTruncated) {
    return {
      items: items.slice(0, limit),
      total: null,
      observed_total: items.length,
      total_is_lower_bound: true,
      limit,
      truncated: true,
    };
  }
  return {
    items: items.slice(0, limit),
    total: items.length,
    limit,
    truncated: sourceTruncated || items.length > limit,
  };
}

function readIssue(issuePath) {
  if (!issuePath) return { number: null, updatedAt: null };
  let issue;
  try {
    issue = JSON.parse(fs.readFileSync(issuePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read issue JSON: ${error.message}`);
  }
  if (Array.isArray(issue)) issue = issue[0] || {};
  return {
    number: Number.isSafeInteger(issue.number) && issue.number > 0 ? issue.number : null,
    updatedAt: issue.updatedAt || issue.updated_at || null,
  };
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(options.repoRoot);
if (!fs.statSync(repoRoot, { throwIfNoEntry: false })?.isDirectory()) usage(`Repository root does not exist: ${repoRoot}`);

const git = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
if (git.status !== 0) {
  process.stderr.write(git.stderr || "Cannot resolve repository HEAD\n");
  process.exit(1);
}

let issue;
try {
  issue = readIssue(options.issueJson ? path.resolve(options.issueJson) : "");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

const specsRoot = path.join(repoRoot, "openspec", "specs");
const specsWalk = walkFiles(repoRoot, specsRoot);
const specs = specsWalk.files.map((file) => relative(repoRoot, file));
const changesRoot = path.join(repoRoot, "openspec", "changes");
const activeChanges = sortedDirectoryNames(changesRoot, (name) => name !== "archive");
const archivedChanges = sortedDirectoryNames(path.join(changesRoot, "archive"));

const codeWalk = walkFiles(repoRoot, repoRoot, { exclude: EXCLUDED_DIRS, cap: options.scanLimit });
const searchTerms = [...new Set([
  options.changeId.toLowerCase(),
  options.changeId.replaceAll("-", " ").toLowerCase(),
  options.changeId.replaceAll("-", "_").toLowerCase(),
])].filter(Boolean);
const matchingCodePaths = codeWalk.files
  .filter((file) => CODE_EXTENSIONS.has(path.extname(file).toLowerCase()))
  .filter((file) => {
    const rel = relative(repoRoot, file).toLowerCase();
    if (searchTerms.some((term) => rel.includes(term))) return true;
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return false;
    const contents = fs.readFileSync(file, "utf8").toLowerCase();
    return searchTerms.some((term) => contents.includes(term));
  })
  .map((file) => relative(repoRoot, file))
  .sort((left, right) => left.localeCompare(right, "en"));

const output = {
  subject: { change_id: options.changeId, issue: issue.number },
  binding: { base_sha: git.stdout.trim(), issue_updated_at: issue.updatedAt },
  facts: {
    specs: bounded(specs, options.limit, specsWalk.scanTruncated),
    active_changes: bounded(activeChanges, options.limit),
    archived_changes: bounded(archivedChanges, options.limit),
    matching_code_paths: {
      ...bounded(matchingCodePaths, options.limit, codeWalk.scanTruncated),
      source_scan_truncated: codeWalk.scanTruncated,
      scan_limit: options.scanLimit,
    },
  },
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
