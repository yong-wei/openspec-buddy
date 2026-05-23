#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const source = process.argv[2] || "-";
const body = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
const listKeys = new Set(["depends_on", "blocked_by", "blocking"]);

function decodeEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadOpenSpecBuddyEnv() {
  const defaultEnvFile = path.join(resolveRepoRoot(), ".env.openspec-buddy");
  const envFile = process.env.OPENSPEC_BUDDY_ENV_FILE || defaultEnvFile;

  if (!fs.existsSync(envFile)) return;

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid OpenSpec Buddy env file line: ${envFile}:${index + 1}`);
    }

    const [, name, rawValue] = match;
    if (!name.startsWith("OPENSPEC_BUDDY_")) return;
    if (!process.env[name]) {
      process.env[name] = decodeEnvValue(rawValue);
    }
  });
}

function resolveRepoRoot() {
  if (process.env.OPENSPEC_BUDDY_REPO_ROOT) {
    return process.env.OPENSPEC_BUDDY_REPO_ROOT;
  }

  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

loadOpenSpecBuddyEnv();

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "[]") return [];
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseMetadataBlock(rawMetadata, sourceName) {
  const lines = rawMetadata.split(/\r?\n/);
  const data = {};
  let currentListKey = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentListKey) {
      data[currentListKey].push(parseScalar(listItem[1]));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!pair) {
      throw new Error(`Unsupported ${sourceName} metadata line: ${line}`);
    }

    const key = pair[1];
    const value = pair[2] ?? "";
    if (value.trim() === "") {
      if (listKeys.has(key)) {
        data[key] = [];
        currentListKey = key;
        continue;
      }
      data[key] = "";
      currentListKey = null;
      continue;
    }

    if (listKeys.has(key)) {
      if (value.trim() === "[]") {
        data[key] = [];
        currentListKey = null;
        continue;
      }
      throw new Error(`List field ${key} must use [] when empty or YAML block list items when non-empty.`);
    }

    data[key] = parseScalar(value);
    currentListKey = Array.isArray(data[key]) ? key : null;
  }

  return data;
}

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  return parseMetadataBlock(match[1], "YAML front matter");
}

function parseHiddenMetadata(markdown) {
  const match = markdown.match(/<!--\s*openspec-buddy\s*\r?\n([\s\S]*?)\r?\n\s*-->/);
  if (!match) return null;
  return parseMetadataBlock(match[1], "openspec-buddy hidden");
}

function parseIssueMetadata(markdown) {
  const frontMatter = parseFrontMatter(markdown);
  if (frontMatter) return frontMatter;

  const hiddenMetadata = parseHiddenMetadata(markdown);
  if (hiddenMetadata) return hiddenMetadata;

  throw new Error("Missing OpenSpec Buddy metadata. Expected YAML front matter or <!-- openspec-buddy ... --> block.");
}

function validate(data) {
  const errors = [];
  const required = [
    "change_id",
    "claim_branch",
    "series",
    "coupling_group",
    "execution_mode",
    "base_branch",
    "depends_on",
    "openspec_path",
    "risk",
    "area",
  ];

  for (const field of required) {
    if (!(field in data) || data[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof data.change_id === "string" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.change_id)) {
    errors.push("change_id must be kebab-case.");
  }

  if (data.claim_branch !== data.change_id) {
    errors.push("claim_branch must equal change_id.");
  }

  const expectedBaseBranch = process.env.OPENSPEC_BUDDY_BASE_BRANCH;
  if (!expectedBaseBranch) {
    errors.push("Missing required environment variable: OPENSPEC_BUDDY_BASE_BRANCH.");
  } else if (data.base_branch !== expectedBaseBranch) {
    errors.push(`base_branch must be ${expectedBaseBranch}.`);
  }

  const expectedPath = `openspec/changes/${data.change_id}`;
  if (data.openspec_path && data.openspec_path !== expectedPath) {
    errors.push(`openspec_path should be ${expectedPath}.`);
  }

  const modes = new Set(["isolated", "fixed-branch", "stacked", "docs-only"]);
  if (data.execution_mode && !modes.has(data.execution_mode)) {
    errors.push("execution_mode must be isolated, fixed-branch, stacked, or docs-only.");
  }

  const risks = new Set(["low", "medium", "high"]);
  if (data.risk && !risks.has(data.risk)) {
    errors.push("risk must be low, medium, or high.");
  }

  if (!Array.isArray(data.depends_on)) {
    data.depends_on = data.depends_on === "" ? [] : [data.depends_on];
  }

  if (data.execution_mode === "fixed-branch" && data.required_branch !== data.claim_branch) {
    errors.push("fixed-branch changes require required_branch to equal claim_branch.");
  }

  if (data.execution_mode === "stacked" && data.depends_on.length === 0) {
    errors.push("stacked changes require at least one dependency.");
  }

  if (errors.length > 0) {
    const err = new Error(errors.join("\n"));
    err.errors = errors;
    throw err;
  }
}

try {
  const data = parseIssueMetadata(body);
  validate(data);
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
