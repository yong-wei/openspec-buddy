import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installSkills, renderConfigFile, writeConfigFile } from "../src/cli.mjs";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");
const sourceRoot = path.join(repoRoot, "skills");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openspec-buddy-cli-"));
}

test("installSkills copies both skills into a target root", () => {
  const root = tmpDir();

  const installed = installSkills({
    mode: "copy",
    sourceRoot,
    targetRoot: root,
    force: false,
  });

  assert.deepEqual(installed.map((entry) => entry.name), [
    "openspec-buddy",
    "openspec-buddy-auto",
  ]);
  assert.equal(fs.existsSync(path.join(root, "openspec-buddy", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(root, "openspec-buddy-auto", "SKILL.md")), true);
  assert.equal(fs.lstatSync(path.join(root, "openspec-buddy")).isSymbolicLink(), false);
});

test("installSkills can install development symlinks", () => {
  const root = tmpDir();

  installSkills({
    mode: "symlink",
    sourceRoot,
    targetRoot: root,
    force: false,
  });

  const linkPath = path.join(root, "openspec-buddy");
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(linkPath), path.join(sourceRoot, "openspec-buddy"));
});

test("writeConfigFile writes full project configuration and refuses overwrite", () => {
  const root = tmpDir();
  const envFile = path.join(root, ".env.openspec-buddy");
  const values = {
    OPENSPEC_BUDDY_BASE_BRANCH: "integration",
    OPENSPEC_BUDDY_RELEASE_BRANCH: "main",
    OPENSPEC_BUDDY_PROJECT_OWNER: "yong-wei",
    OPENSPEC_BUDDY_PROJECT_NUMBER: "7",
    OPENSPEC_BUDDY_PROJECT_TITLE: "OpenSpec Work",
    OPENSPEC_BUDDY_PR_REVIEW_REQUEST: "@codex review",
  };

  writeConfigFile(envFile, values, { force: false, full: true });

  const text = fs.readFileSync(envFile, "utf8");
  assert.match(text, /OPENSPEC_BUDDY_BASE_BRANCH=integration/);
  assert.match(text, /OPENSPEC_BUDDY_PROJECT_TITLE="OpenSpec Work"/);
  assert.match(text, /OPENSPEC_BUDDY_PR_REVIEW_REQUEST="@codex review"/);
  assert.throws(() => writeConfigFile(envFile, values, { force: false, full: true }), /already exists/);
});

test("renderConfigFile omits blank optional values", () => {
  const text = renderConfigFile({
    OPENSPEC_BUDDY_BASE_BRANCH: "dev",
    OPENSPEC_BUDDY_RELEASE_BRANCH: "main",
    OPENSPEC_BUDDY_PROJECT_OWNER: "owner",
    OPENSPEC_BUDDY_PROJECT_NUMBER: "3",
    OPENSPEC_BUDDY_PROJECT_TITLE: "Title",
    OPENSPEC_BUDDY_PR_REVIEW_REQUEST: "",
  });

  assert.match(text, /OPENSPEC_BUDDY_BASE_BRANCH=dev/);
  assert.doesNotMatch(text, /OPENSPEC_BUDDY_PR_REVIEW_REQUEST=/);
});
