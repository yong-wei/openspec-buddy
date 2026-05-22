---
name: openspec-buddy
description: Use when the user explicitly invokes openspec-buddy propose, openspec-buddy apply, or openspec-buddy achieve for OpenSpec changes coordinated through GitHub Issues across branches, agents, or worktrees.
compatibility: Requires openspec CLI and GitHub CLI.
---

# OpenSpec Buddy

OpenSpec Buddy is the coordination layer for GitHub-tracked OpenSpec work.
GitHub Issues are the cross-worktree task record. OpenSpec remains the local specification and execution package.

Use this skill only when the user explicitly asks for `openspec-buddy propose`, `openspec-buddy apply`, `openspec-buddy achieve`, or asks to coordinate OpenSpec changes through GitHub Issues.

## Required Configuration

Before running Buddy commands in a repository, verify project-local
configuration:

```bash
<openspec-buddy-skill-dir>/scripts/check-config.sh
```

Resolve `<openspec-buddy-skill-dir>` to the directory containing this
`SKILL.md`; do not paste the placeholder literally.

The helper scripts automatically read `.env.openspec-buddy` from the repository
root before checking the process environment. Set `OPENSPEC_BUDDY_ENV_FILE` to
use a different dotenv-style file. Non-empty process environment values override
file values.

Required variables are:

- `OPENSPEC_BUDDY_BASE_BRANCH`
- `OPENSPEC_BUDDY_RELEASE_BRANCH`
- `OPENSPEC_BUDDY_PROJECT_OWNER`
- `OPENSPEC_BUDDY_PROJECT_NUMBER`
- `OPENSPEC_BUDDY_PROJECT_TITLE`

If any required variable is missing after file loading, stop and ask the user
for the value. Do not fall back to another project's branch or GitHub Project.
On first use in a project, ask for these basic values, generate
`.env.openspec-buddy`, then rerun the config check:

- Buddy base branch
- release branch
- GitHub Project owner
- GitHub Project number
- GitHub Project title

Use the npm installer when available:

```bash
openspec-buddy init
```

If the npm command is not available, use the bundled helper:

```bash
<openspec-buddy-skill-dir>/scripts/init-config.sh
```

Optional Development-link policy:

- `OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=auto` by default. Use a real
  PR-to-issue Development link only when the PR base is the repository default
  branch; otherwise record that manual GitHub sidebar linking is required.
- Set `OPENSPEC_BUDDY_PR_DEVELOPMENT_LINK_MODE=keyword` only for projects whose
  Buddy PRs target the repository default branch. The metadata helper then
  writes a closing keyword and verifies `closingIssuesReferences`.
- Use `manual` when PRs intentionally target a non-default Buddy base branch and
  humans will link the PR in GitHub's Development sidebar.

## Core Rule

One coordinated change maps to:

```text
one GitHub Issue = one change_id = one claim branch = one OpenSpec change = one PR
```

The issue front matter must include `claim_branch`, and `claim_branch` must equal `change_id`.

## Execution Retrospective Requirement

After every `propose`, `apply`, or `achieve` run, include a brief execution retrospective in the final report.
The retrospective must state:

- what worked in the Buddy workflow
- what was confusing, fragile, manual, or missing
- whether any reusable rule should be added to `openspec-buddy`, `openspec-buddy-auto`, or their references

If the run reveals a reusable workflow gap and the user asks to persist it, update the relevant skill file in the same branch before closing the task.

## Modes

### propose

Use when the user wants to register a new OpenSpec change in GitHub before implementation.

Steps:

1. Derive or confirm a kebab-case `change_id`.
2. Prepare an issue body from `references/issue-template.md`.
3. In issue front matter, keep empty list fields as `[]`, but write every
   non-empty `depends_on`, `blocked_by`, or `blocking` field as a YAML block
   list. Do not use inline lists such as `[other-change]`; the metadata parser
   rejects those so dependency metadata cannot be misread.
4. Set `claim_branch: <change_id>`.
5. Set `base_branch` to `$OPENSPEC_BUDDY_BASE_BRANCH`. Do not create new Buddy
   issues against `$OPENSPEC_BUDDY_RELEASE_BRANCH`; release from the Buddy base
   branch to the release branch is a manual action unless the project
   explicitly configures otherwise.
6. Validate the prepared body before creating or updating the issue:
   ```bash
   <openspec-buddy-skill-dir>/scripts/parse-issue-metadata.mjs <issue-body-file>
   ```
7. Add labels:
   - `status:ready`
   - `area:<area>`
   - `series:<series>`
   - `risk:<low|medium|high>`
   - `mode:<isolated|fixed-branch|stacked|docs-only>`
8. Create the issue with `gh issue create`.
9. If this is a planned series, create or identify the series parent issue, then link the child issue:
   ```bash
   <openspec-buddy-skill-dir>/scripts/create-series-parent.sh <series>
   <openspec-buddy-skill-dir>/scripts/link-issue-parent.sh <parent-issue> <child-issue>
   ```
10. If this issue depends on another change issue, link the native relationship:
   ```bash
   <openspec-buddy-skill-dir>/scripts/link-issue-dependencies.sh <blocked-issue> <blocking-issue>
   ```
11. Add the created issue to the default GitHub Project:
   ```bash
   <openspec-buddy-skill-dir>/scripts/add-issue-to-project.sh <issue-url>
   ```
   The script also sets the Project `Status` to `Todo`.
12. If the user also asked to create local OpenSpec artifacts, invoke `openspec-propose` after issue creation.

Do not claim the issue or implement in `propose`.

### apply

Use when the user wants to implement a GitHub-tracked OpenSpec change.

Steps:

1. Locate the issue by number, URL, or `change_id`.
2. Read the issue body and labels.
3. Validate metadata:
   ```bash
   <openspec-buddy-skill-dir>/scripts/parse-issue-metadata.mjs <issue-body-file>
   ```
4. Verify:
   - issue has `status:ready`
   - issue is not labeled `type:series-parent`
   - native `blockedBy` has no open, unarchived issue
   - front matter `depends_on` entries are not active unfinished changes
   - no open issue in the same `coupling_group` has `status:claimed` or `status:in-progress`
   - `claim_branch` equals `change_id`
   - `base_branch` equals `$OPENSPEC_BUDDY_BASE_BRANCH`
   - execution mode and branch constraints are satisfiable
5. Claim the issue with a linked Development branch and remote branch lock:
   ```bash
   <openspec-buddy-skill-dir>/scripts/claim-change.sh <issue-number>
   ```
   The claim creates `origin/<change_id>` from the declared `base_branch` using
   `gh issue develop`, verifies that the issue Development branch list contains
   the claim branch, writes a structured claim comment, and sets a lease.
   It also mirrors the issue status to the Project `Status` field and sets Project `Start` to the current date.
6. Re-read the issue and confirm the claim id, assignee, status label, and branch lock.
7. Use branch `<change_id>` for the implementation. For isolated work, create it from `base_branch`. For fixed-branch work, stop if the required branch is not the same as the declared claim branch.
8. After entering the claim branch, mark the issue in progress:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-in-progress.sh <issue-number>
   ```
   This must leave the Project `Status` as `In Progress`.
9. Invoke `openspec-apply-change` for the matching local OpenSpec change.
10. Before opening the PR, require
    `openspec instructions apply --change <change_id> --json` to report
    `remaining: 0`, then pre-archive the change on the claim branch:
    - create a main spec skeleton first when a delta introduces a new capability
      and `openspec/specs/<capability>/spec.md` does not exist
    - run `openspec archive <change_id> --yes`
    - validate each affected main spec with `openspec validate <capability> --strict`
    The issue must remain `status:in-progress`; file-level pre-archive is not
    the same as GitHub issue archive.
11. Commit code, tests, synced main specs, and the archived change directory
    together.
12. Open a ready PR against `$OPENSPEC_BUDDY_BASE_BRANCH`, never a draft PR.
    Do not hand-write the issue Development link; let the metadata helper apply
    the configured PR Development-link policy.
13. After opening the ready PR, configure PR metadata before review:
   ```bash
   <openspec-buddy-skill-dir>/scripts/configure-pr-metadata.sh <issue-number> <pr-url>
   ```
   This must add PR-scoped labels such as `pr:openspec-buddy` and
   `pr:base-<base-branch>`, copy the issue's `area:*`, `series:*`, and `risk:*`
   labels to the PR, add the PR to the same Project as the issue, set the PR
   Project `Status` to `In Progress`, and record the origin issue in the PR
   body. When the PR base is the repository default branch and the policy is
   `auto` or `keyword`, the helper writes a closing keyword such as `Closes
   #123` and verifies GitHub reports the issue through `closingIssuesReferences`.
   When the PR base is not the default branch, GitHub CLI cannot create a
   verifiable PR Development link; the helper records a manual sidebar-link
   requirement instead of pretending the link is complete.
14. Mark the issue in review:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-review.sh <issue-number> <pr-url>
   ```
   This first verifies the PR targets `$OPENSPEC_BUDDY_BASE_BRANCH`. If the PR
   targets `$OPENSPEC_BUDDY_RELEASE_BRANCH`, the script attempts to retarget it
   to the Buddy base branch; if retargeting fails, stop before review/merge.
   The script also rejects draft PRs and runs the PR metadata configuration
   helper. This must leave the issue Project `Status` as `In Progress`.

If claim verification fails, stop before editing files.

### achieve / archive

Use after the PR for a GitHub-tracked OpenSpec change has been merged and the user wants to finish the change record. Treat `archive` as an alias for `achieve`.

Default Buddy PRs are pre-archived before review, so `achieve` normally syncs
GitHub issue state rather than creating a new archive commit. Keep the legacy
archive path only for older PRs that merged before this rule existed.

Steps:

1. Confirm the PR is merged.
2. Confirm the target branch `$OPENSPEC_BUDDY_BASE_BRANCH` contains the merge.
3. Prefer the pre-archived path:
   - confirm the merged branch contains
     `openspec/changes/archive/YYYY-MM-DD-<change_id>/`
   - read the archived `tasks.md` and require no unchecked tasks
   - confirm synced main specs exist and validate affected specs
4. If the merged PR does not contain an archive path, use the legacy recovery
   path: confirm `openspec instructions apply --change <change_id> --json`
   reports `remaining: 0`, run `openspec-archive-change`, and commit/push the
   archive update before marking the issue archived.
5. Mark the issue archived:
   ```bash
   <openspec-buddy-skill-dir>/scripts/mark-achieved.sh <issue-number> <archive-path> [pr-url]
   ```
   This must leave the Project `Status` as `Done`, set Project `End` to the current date, and close the issue if it is still open.
   The script also checks the linked series parent and closes it when all child changes are already archived.
6. Report dependent blocked issues and any finalized series parent issue, if any.

`achieve` means the GitHub issue, PR, and OpenSpec archive all agree that the change is complete.

## Required References

Read only the reference needed for the current mode:

- `references/issue-template.md`: body template for `propose`
- `references/claim-locking.md`: branch lock, claim lease, and stale-claim rules for `apply`
- `references/metadata-schema.md`: field definitions and validation rules
- `references/issue-relationships.md`: parent issue, blocked-by, blocking, and Project date rules
- `references/project-coordination.md`: default GitHub Project target and status sync
- `references/status-flow.md`: labels and transitions

## Guardrails

- Do not implement unclaimed GitHub-tracked changes.
- Do not execute adjacent OpenSpec changes found in the worktree.
- Do not claim `type:series-parent` issues.
- Do not claim an issue while GitHub `blockedBy` contains any open, unarchived issue.
- Do not treat GitHub Projects as the agent execution source of truth; use issue front matter, labels, assignee, and comments.
- Do not update `status:*` labels without the Buddy wrapper scripts; Project `Status` must stay synchronized for human-visible coordination.
- Do not open, review, or merge Buddy PRs against `$OPENSPEC_BUDDY_RELEASE_BRANCH`. Retarget them to `$OPENSPEC_BUDDY_BASE_BRANCH` or stop.
- Do not create or submit draft PRs for Buddy changes; PRs must be ready for review when they are handed to the review loop.
- Do not leave Buddy PRs without PR-scoped labels, copied area/series/risk labels, the same Project as the originating issue, and an origin issue record.
- Do not hand-write PR Development links. Use `configure-pr-metadata.sh` so closing keywords are used only when GitHub can verify them through `closingIssuesReferences`.
- Do not claim a PR Development link is complete when the PR targets a non-default base branch; use the manual GitHub sidebar link or report it as a remaining coordination step.
- Do not set `status:archived`, Project `Done`, or Project `End` merely because files were pre-archived in a PR. Those GitHub states are set only after the PR merges and `mark-achieved.sh` runs.
- Do not use a branch whose name differs from `change_id` unless the user explicitly cancels OpenSpec Buddy coordination for this change.
- Do not bypass the remote branch lock in `claim-change.sh`; label changes alone are not a reliable lock.
- Do not reclaim `status:claimed` or `status:in-progress` work unless the lease is stale and the branch/PR recovery checks prove it is safe.
- Do not continue after a failed claim or unresolved coupling conflict.
- GitHub is the task-state source of truth; Git is still the code source of truth.

## Output

For `propose`, report the issue URL, `change_id`, labels, OpenSpec path, parent issue link, and dependency relationship links.
Also report the GitHub Project item id or state that the issue was already present in the Project, plus the Project `Status`.

For `apply`, report the issue, claim branch, blockedBy status, downstream blocking count when known, coupling-group result, Project `Start`, PR metadata labels, PR Project membership, and the OpenSpec change being applied.

For `achieve`, report the PR, merge state, archive path, Project `End`, final labels, issue close state, any finalized series parent issue, and any follow-up issues that were unblocked.

For every mode, include the execution retrospective required above.
