#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const manifestPath = process.argv[2];
const options = new Set(process.argv.slice(3));
const allowedOptions = new Set(["--allow-missing"]);

function fail(errors) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

if (!manifestPath || [...options].some((option) => !allowedOptions.has(option))) {
  fail(["Usage: validate-proposal-shape.mjs <proposal-review.yaml> [--allow-missing]"]);
}

if (!fs.existsSync(manifestPath)) {
  if (options.has("--allow-missing")) {
    process.stdout.write("Proposal shape valid\n");
    process.exit(0);
  }
  fail([`proposal-review.yaml not found: ${manifestPath}`]);
}

function scalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseManifest(source) {
  const result = {};
  let listKey = null;

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (/^\s*(?:#.*)?$/.test(rawLine)) continue;

    const listItem = rawLine.match(/^\s+-\s+(.+?)\s*$/);
    if (listItem && listKey) {
      result[listKey].push(scalar(listItem[1]));
      continue;
    }

    const field = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!field) throw new Error(`line ${index + 1}: unsupported YAML syntax`);

    const [, key, rawValue] = field;
    if (Object.hasOwn(result, key)) throw new Error(`${key}: duplicate field`);
    listKey = null;

    if (rawValue === "") {
      result[key] = [];
      listKey = key;
    } else if (rawValue === "[]") {
      result[key] = [];
    } else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      result[key] = inner ? inner.split(",").map(scalar) : [];
    } else {
      result[key] = scalar(rawValue);
    }
  }
  return result;
}

const schema = {
  split_status: ["single-change", "series-required"],
  vertical_slice_status: ["valid", "invalid"],
  blocking_edges_status: ["valid", "incomplete"],
  wide_refactor_strategy: ["none", "expand-migrate-contract"],
};
const allowedFields = new Set([...Object.keys(schema), "children"]);
const errors = [];
let manifest;

try {
  manifest = parseManifest(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail([error.message]);
}

for (const key of Object.keys(manifest)) {
  if (!allowedFields.has(key)) errors.push(`${key}: unknown field`);
}
for (const [key, allowedValues] of Object.entries(schema)) {
  if (!Object.hasOwn(manifest, key)) {
    errors.push(`${key}: missing required field`);
  } else if (!allowedValues.includes(manifest[key])) {
    errors.push(`${key}: expected ${allowedValues.join(" or ")}`);
  }
}
if (!Object.hasOwn(manifest, "children")) {
  errors.push("children: missing required field");
} else if (!Array.isArray(manifest.children)) {
  errors.push("children: expected a list");
} else if (manifest.children.some((child) => !child)) {
  errors.push("children: entries must be non-empty");
}

if (manifest.split_status === "series-required" && (!Array.isArray(manifest.children) || manifest.children.length === 0)) {
  errors.push("children: series-required requires a non-empty child list");
}
if (manifest.vertical_slice_status === "invalid") {
  errors.push("vertical_slice_status: invalid proposals are not ready");
}
if (manifest.blocking_edges_status === "incomplete") {
  errors.push("blocking_edges_status: incomplete blocking edges are not ready");
}

if (manifest.wide_refactor_strategy === "expand-migrate-contract") {
  const changeDir = path.dirname(path.dirname(path.resolve(manifestPath)));
  const designPath = path.join(changeDir, "design.md");
  const design = fs.existsSync(designPath) ? fs.readFileSync(designPath, "utf8") : "";
  const missingTerms = ["expand", "migrate", "contract"].filter(
    (term) => !new RegExp(`\\b${term}\\b`, "i").test(design),
  );
  if (missingTerms.length > 0) {
    errors.push(`design.md: expand-migrate-contract strategy must name ${missingTerms.join(", ")}`);
  }
}

if (errors.length > 0) fail(errors);
process.stdout.write("Proposal shape valid\n");
