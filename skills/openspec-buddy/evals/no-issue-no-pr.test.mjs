import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const buddySkill = read("skills/openspec-buddy/SKILL.md");
const coreLifecycle = read("skills/openspec-buddy/references/core-lifecycle.md");
assert.match(
  buddySkill,
  /openspec-buddy propose --no-issue/,
  "openspec-buddy skill must document the --no-issue local-only propose path",
);
assert.match(
  coreLifecycle,
  /Use `--no-issue` only for intentionally local-only changes[\s\S]*no GitHub issue/i,
  "openspec-buddy --no-issue flow must explicitly skip GitHub issue creation",
);
assert.match(
  buddySkill,
  /`propose --no-issue` only requires `OPENSPEC_BUDDY_BASE_BRANCH`/i,
  "openspec-buddy --no-issue flow must exempt GitHub Project config requirements",
);

const autoSkill = read("skills/openspec-buddy-auto/SKILL.md");
assert.match(
  autoSkill,
  /no-issue/i,
  "openspec-buddy-auto skill must document no-issue local execution",
);
assert.match(
  autoSkill,
  /--no-pr/,
  "openspec-buddy-auto skill must document the --no-pr mode",
);
assert.match(
  autoSkill,
  /do not create GitHub issue,\s+PR, Project, review, or achievement state/i,
  "openspec-buddy-auto --no-pr flow must explicitly skip PR creation",
);
assert.match(
  autoSkill,
  /`--no-pr` is valid only for a selected local-only change created through\s+`openspec-buddy propose --no-issue`/i,
  "openspec-buddy-auto local-only mode must exempt GitHub review/project prerequisites",
);
assert.match(
  autoSkill,
  /EVERY OPENSPEC-BUDDY-AUTO STEP MUST START BY RUNNING THE AUTO CONTROLLER/i,
  "openspec-buddy-auto must select local-only changes before any claim step",
);
assert.match(
  autoSkill,
  /Forbidden Manual Substitutes[\s\S]*direct deterministic helper invocation during normal auto flow/i,
  "openspec-buddy-auto --no-pr mode must explicitly skip PR and issue helpers",
);
assert.match(
  autoSkill,
  /`--no-pr` is valid only for a selected local-only change created through\s+`openspec-buddy propose --no-issue`/i,
  "openspec-buddy-auto must limit --no-pr to local-only changes",
);

const buddyEvals = JSON.parse(read("skills/openspec-buddy/evals/evals.json"));
const noIssueEval = buddyEvals.evals.find((item) => item.prompt.includes("--no-issue"));
assert.ok(noIssueEval, "openspec-buddy evals must include a --no-issue propose case");
assert.match(
  noIssueEval.expected_output,
  /不创建 GitHub Issue|不包含 GitHub Issue/,
  "openspec-buddy --no-issue eval must require local-only behavior",
);

const autoEvals = JSON.parse(read("skills/openspec-buddy-auto/evals/evals.json"));
const noPrEval = autoEvals.evals.find((item) => item.prompt.includes("--no-pr"));
assert.ok(noPrEval, "openspec-buddy-auto evals must include a --no-pr case");
assert.match(
  noPrEval.expected_output,
  /不开 PR|不打开 PR|不创建 PR/,
  "openspec-buddy-auto --no-pr eval must require local review-and-merge behavior",
);

const readme = read("README.md");
assert.match(
  readme,
  /--no-issue/,
  "README must mention the propose --no-issue mode",
);
assert.match(
  readme,
  /--no-pr/,
  "README must mention the auto --no-pr mode",
);
assert.match(
  readme,
  /check-config\.sh local[\s\S]*不要求 GitHub Project 字段[\s\S]*不要求[\s\S]*`OPENSPEC_BUDDY_PR_REVIEW_REQUEST`/i,
  "README must document the local-only minimal configuration path",
);

console.log("no-issue/no-pr eval passed");
