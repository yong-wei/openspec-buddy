import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const buddySkill = read("skills/openspec-buddy/SKILL.md");
const autoSkill = read("skills/openspec-buddy-auto/SKILL.md");
const executionLoop = read("skills/openspec-buddy-auto/references/execution-loop.md");
const buddyEvals = read("skills/openspec-buddy/evals/evals.json");
const autoEvals = read("skills/openspec-buddy-auto/evals/evals.json");

function assertValidateBeforeArchive(text, label) {
  const validateIndex = text.indexOf("openspec validate <change_id> --strict");
  const archiveIndex = text.indexOf("openspec archive <change_id> --yes");

  assert.notEqual(
    validateIndex,
    -1,
    `${label} must require strict active change validation before archive`,
  );
  assert.notEqual(archiveIndex, -1, `${label} must mention openspec archive`);
  assert.ok(
    validateIndex < archiveIndex,
    `${label} must validate active change specs before archiving`,
  );
}

assertValidateBeforeArchive(buddySkill, "openspec-buddy apply workflow");
assertValidateBeforeArchive(autoSkill, "openspec-buddy-auto workflow");
assertValidateBeforeArchive(executionLoop, "openspec-buddy-auto execution loop");

for (const [label, text] of [
  ["openspec-buddy evals", buddyEvals],
  ["openspec-buddy-auto evals", autoEvals],
]) {
  assert.match(
    text,
    /openspec validate <change_id> --strict/,
    `${label} must describe the pre-archive active change validation gate`,
  );
}
