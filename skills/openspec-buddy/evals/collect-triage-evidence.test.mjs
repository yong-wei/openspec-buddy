import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const collector = path.join(projectRoot, "skills/openspec-buddy/scripts/collect-triage-evidence.mjs");
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-triage-evidence-"));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-triage-bin-"));
const ghMarker = path.join(fakeBin, "gh-called");
fs.writeFileSync(path.join(fakeBin, "gh"), `#!/bin/sh\ntouch '${ghMarker}'\nexit 99\n`, { mode: 0o755 });
const collectorEnv = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };

function write(relativePath, contents) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

write("openspec/specs/zeta/spec.md", "# Zeta\n");
write("openspec/specs/alpha/spec.md", "# Alpha\n");
write("openspec/specs/middle/spec.md", "# Middle\n");
write("openspec/changes/z-active/proposal.md", "# z active\n");
write("openspec/changes/a-active/proposal.md", "# a active\n");
write("openspec/changes/archive/2026-01-z-old/proposal.md", "# old z\n");
write("openspec/changes/archive/2026-01-a-old/proposal.md", "# old a\n");
write("src/z-demo.js", "export const text = 'demo change';\n");
write("src/a-demo.js", "export const text = 'demo-change';\n");
write("lib/demo-change-helper.ts", "export const helper = true;\n");
write("docs/demo-change.md", "This is documentation, not a code path.\n");
write("issue.json", JSON.stringify({ number: 42, updatedAt: "2026-07-14T09:30:00Z" }));

for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"], ["add", "."], ["commit", "-qm", "fixture"]]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

const beforeStatus = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repo, encoding: "utf8" }).stdout;
const result = spawnSync(process.execPath, [
  collector,
  "--repo-root", repo,
  "--change-id", "demo-change",
  "--issue-json", path.join(repo, "issue.json"),
  "--limit", "2",
], { encoding: "utf8", env: collectorEnv });

assert.equal(result.status, 0, result.stderr);
const evidence = JSON.parse(result.stdout);
const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
assert.deepEqual(evidence.subject, { change_id: "demo-change", issue: 42 });
assert.deepEqual(evidence.binding, {
  base_sha: baseSha,
  issue_updated_at: "2026-07-14T09:30:00Z",
});
assert.deepEqual(evidence.facts.specs, {
  items: ["openspec/specs/alpha/spec.md", "openspec/specs/middle/spec.md"],
  total: 3,
  limit: 2,
  truncated: true,
});
assert.deepEqual(evidence.facts.active_changes, {
  items: ["a-active", "z-active"], total: 2, limit: 2, truncated: false,
});
assert.deepEqual(evidence.facts.archived_changes, {
  items: ["2026-01-a-old", "2026-01-z-old"], total: 2, limit: 2, truncated: false,
});
assert.deepEqual(evidence.facts.matching_code_paths, {
  items: ["lib/demo-change-helper.ts", "src/a-demo.js"],
  total: 3,
  limit: 2,
  truncated: true,
  source_scan_truncated: false,
  scan_limit: 5000,
});

const repeated = spawnSync(process.execPath, [collector, repo, "demo-change", path.join(repo, "issue.json"), "--limit", "2"], { encoding: "utf8", env: collectorEnv });
assert.equal(repeated.status, 0, repeated.stderr);
assert.deepEqual(JSON.parse(repeated.stdout), evidence, "collection must be deterministic");
const afterStatus = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repo, encoding: "utf8" }).stdout;
assert.equal(afterStatus, beforeStatus, "collector must not mutate the repository");
assert.equal(fs.existsSync(ghMarker), false, "collector must not invoke GitHub CLI");

const local = spawnSync(process.execPath, [collector, "--repo-root", repo, "--change-id", "demo-change"], { encoding: "utf8", env: collectorEnv });
assert.equal(local.status, 0, local.stderr);
assert.equal(JSON.parse(local.stdout).subject.issue, null);
assert.equal(JSON.parse(local.stdout).binding.issue_updated_at, null);

const cappedRepo = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-triage-capped-"));
for (const [relativePath, contents] of [
  ["src/a-unrelated.js", "export const a = true;\n"],
  ["src/b-unrelated.js", "export const b = true;\n"],
  ["src/z-demo-change.js", "export const match = true;\n"],
]) {
  const target = path.join(cappedRepo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
for (const args of [["init", "-q"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"], ["add", "."], ["commit", "-qm", "fixture"]]) {
  const git = spawnSync("git", args, { cwd: cappedRepo, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
}
const capped = spawnSync(process.execPath, [
  collector, "--repo-root", cappedRepo, "--change-id", "demo-change",
  "--limit", "10", "--scan-limit", "2",
], { encoding: "utf8", env: collectorEnv });
assert.equal(capped.status, 0, capped.stderr);
assert.deepEqual(JSON.parse(capped.stdout).facts.matching_code_paths, {
  items: [],
  total: null,
  observed_total: 0,
  total_is_lower_bound: true,
  limit: 10,
  truncated: true,
  source_scan_truncated: true,
  scan_limit: 2,
});

console.log("collect triage evidence tests passed");
